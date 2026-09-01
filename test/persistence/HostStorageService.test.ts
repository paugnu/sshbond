import { HostStorageService } from '../../src/services/persistence/HostStorageService';
import { SSHHost, SSHIdentity } from '../../src/domain/models/sshConfig';

const FileSystemMock = jest.requireMock('expo-file-system/legacy') as {
  __reset: () => void;
  writeAsStringAsync: jest.Mock;
};
const SecureStoreMock = jest.requireMock('expo-secure-store') as {
  setItemAsync: jest.Mock;
  getItemAsync: jest.Mock;
  deleteItemAsync: jest.Mock;
};

function makeHost(overrides: Partial<SSHHost> = {}): SSHHost {
  return {
    id: 'host_1',
    alias: 'web-prod',
    hostname: 'server.example.com',
    port: 22,
    username: 'ubuntu',
    tags: [],
    favorite: false,
    authenticationType: 'password',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeIdentity(overrides: Partial<SSHIdentity> = {}): SSHIdentity {
  return {
    id: 'id_1',
    name: 'id_ed25519',
    algorithm: 'ed25519',
    publicKey: 'ssh-ed25519 AAAA test',
    privateKeySecureReference: 'ssh_key_id_1',
    fingerprint: 'SHA256:test',
    hasPassphrase: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('HostStorageService', () => {
  beforeEach(async () => {
    FileSystemMock.__reset();
    jest.clearAllMocks();
    await HostStorageService.reset();
  });

  it('persists hosts and reads them back after a cold start', async () => {
    await HostStorageService.saveHost(makeHost());

    await HostStorageService.reset();
    const hosts = await HostStorageService.getHosts();

    expect(hosts).toHaveLength(1);
    expect(hosts[0].alias).toBe('web-prod');
  });

  it('keeps bulk metadata out of the keychain', async () => {
    await HostStorageService.saveHost(makeHost());
    await HostStorageService.addHistoryEntry({
      id: 'hist_1',
      hostAlias: 'web-prod',
      hostname: 'server.example.com',
      port: 22,
      username: 'ubuntu',
      timestamp: '2024-01-01T00:00:00.000Z',
      durationSeconds: 5,
      status: 'success',
    });

    // SecureStore is for secrets only; Android's backing store is unreliable
    // above ~2 KB, which a real host list exceeds quickly.
    expect(SecureStoreMock.setItemAsync).not.toHaveBeenCalled();
    expect(FileSystemMock.writeAsStringAsync).toHaveBeenCalled();
  });

  it('writes private keys to the keychain, never to a file', async () => {
    const identity = makeIdentity({ requiresBiometrics: true });
    await HostStorageService.saveIdentity(identity, 'PRIVATE-KEY-MATERIAL');

    expect(SecureStoreMock.setItemAsync).toHaveBeenCalledWith(
      'ssh_key_id_1',
      'PRIVATE-KEY-MATERIAL',
      expect.objectContaining({ requireAuthentication: true })
    );

    const writtenToDisk = FileSystemMock.writeAsStringAsync.mock.calls
      .map(call => String(call[1]))
      .join('');
    expect(writtenToDisk).not.toContain('PRIVATE-KEY-MATERIAL');
  });

  it('detaches hosts from a key when that key is deleted', async () => {
    await HostStorageService.saveIdentity(makeIdentity(), 'key');
    await HostStorageService.saveHost(makeHost({ identityId: 'id_1', authenticationType: 'key' }));

    await HostStorageService.deleteIdentity('id_1');

    expect(SecureStoreMock.deleteItemAsync).toHaveBeenCalledWith('ssh_key_id_1');

    const [host] = await HostStorageService.getHosts();
    expect(host.identityId).toBeUndefined();
  });

  it('migrates metadata written by older builds out of the keychain', async () => {
    const legacyHosts = [makeHost({ id: 'legacy_1', alias: 'legacy-host' })];
    SecureStoreMock.getItemAsync.mockImplementation(async (key: string) =>
      key === 'sshbond_hosts' ? JSON.stringify(legacyHosts) : null
    );

    const hosts = await HostStorageService.getHosts();

    expect(hosts).toHaveLength(1);
    expect(hosts[0].alias).toBe('legacy-host');
    // The keychain copy must not linger once it has been moved.
    expect(SecureStoreMock.deleteItemAsync).toHaveBeenCalledWith('sshbond_hosts');
  });

  it('initialises only once under concurrent access', async () => {
    await Promise.all([
      HostStorageService.getHosts(),
      HostStorageService.getIdentities(),
      HostStorageService.getSettings(),
      HostStorageService.getKnownHosts(),
    ]);

    // Seeding the default groups is the only write init should perform, and it
    // must happen once no matter how many callers race to initialise.
    const groupWrites = FileSystemMock.writeAsStringAsync.mock.calls.filter(call =>
      String(call[0]).includes('groups.json')
    );
    expect(groupWrites).toHaveLength(1);
  });

  it('caps connection history so it cannot grow without bound', async () => {
    for (let i = 0; i < 60; i++) {
      await HostStorageService.addHistoryEntry({
        id: `hist_${i}`,
        hostAlias: 'web-prod',
        hostname: 'server.example.com',
        port: 22,
        username: 'ubuntu',
        timestamp: new Date(2024, 0, 1, 0, i).toISOString(),
        durationSeconds: 1,
        status: 'success',
      });
    }

    const history = await HostStorageService.getHistory();
    expect(history).toHaveLength(50);
    expect(history[0].id).toBe('hist_59');
  });

  it('merges stored settings over the defaults so new keys are never undefined', async () => {
    await HostStorageService.updateSettings({ terminalFontSize: 18 });
    await HostStorageService.reset();

    const settings = await HostStorageService.getSettings();
    expect(settings.terminalFontSize).toBe(18);
    expect(settings.cursorStyle).toBe('block');
  });
});
