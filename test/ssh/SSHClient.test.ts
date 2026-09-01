import { SSHClient } from '../../src/services/ssh/SSHClient';
import { SSHTunnelManager } from '../../src/services/ssh/SSHTunnelManager';
import { SSHKnownHosts } from '../../src/services/ssh/hosts/SSHKnownHosts';
import { HostStorageService } from '../../src/services/persistence/HostStorageService';
import { ISSHConnection } from '../../src/services/ssh/SSHConnection';
import { ResolvedSSHConfig, ConnectionStatus, SSHHost } from '../../src/domain/models/sshConfig';

const FileSystemMock = jest.requireMock('expo-file-system/legacy') as { __reset: () => void };

function makeConfig(overrides: Partial<ResolvedSSHConfig> = {}): ResolvedSSHConfig {
  return {
    alias: 'web-prod',
    hostname: 'server.example.com',
    port: 22,
    username: 'ubuntu',
    authenticationType: 'none',
    serverAliveInterval: 60,
    serverAliveCountMax: 3,
    connectTimeout: 30,
    compression: false,
    forwardAgent: false,
    requestTTY: 'auto',
    tcpKeepAlive: true,
    strictHostKeyChecking: 'ask',
    localForwards: [],
    remoteForwards: [],
    dynamicForwards: [],
    customDirectives: {},
    ...overrides,
  };
}

/** Resolves once the session reports the given status (or immediately if already there). */
function waitForStatus(connection: ISSHConnection, target: ConnectionStatus): Promise<void> {
  if (connection.status === target) return Promise.resolve();
  return new Promise(resolve => {
    const unsubscribe = connection.onStatusChange(status => {
      if (status === target) {
        unsubscribe();
        resolve();
      }
    });
  });
}

describe('SSHClient host key verification', () => {
  beforeEach(async () => {
    FileSystemMock.__reset();
    await HostStorageService.reset();
  });

  it('asks before trusting an unknown host and records the key once accepted', async () => {
    const onHostKeyChallenge = jest.fn().mockResolvedValue(true);

    const connection = await SSHClient.connect(makeConfig(), { onHostKeyChallenge });

    expect(onHostKeyChallenge).toHaveBeenCalledTimes(1);
    expect(onHostKeyChallenge.mock.calls[0][0]).toMatchObject({
      hostname: 'server.example.com',
      port: 22,
      isMismatch: false,
    });

    const knownHosts = await HostStorageService.getKnownHosts();
    expect(knownHosts).toHaveLength(1);
    expect(knownHosts[0].hostname).toBe('server.example.com');

    await connection.disconnect();
  });

  it('aborts the connection when the user rejects the host key', async () => {
    const onHostKeyChallenge = jest.fn().mockResolvedValue(false);

    await expect(SSHClient.connect(makeConfig(), { onHostKeyChallenge })).rejects.toThrow(
      /rejected by the user/i
    );

    // Nothing must be trusted as a side effect of a refusal.
    expect(await HostStorageService.getKnownHosts()).toHaveLength(0);
  });

  it('refuses to connect at all when there is no way to ask', async () => {
    await expect(SSHClient.connect(makeConfig())).rejects.toThrow(/could not be verified/i);
  });

  it('does not prompt again for an already trusted key', async () => {
    const onHostKeyChallenge = jest.fn().mockResolvedValue(true);

    const first = await SSHClient.connect(makeConfig(), { onHostKeyChallenge });
    await first.disconnect();

    const second = await SSHClient.connect(makeConfig(), { onHostKeyChallenge });
    await second.disconnect();

    expect(onHostKeyChallenge).toHaveBeenCalledTimes(1);
  });

  it('trusts an unknown host without prompting under accept-new', async () => {
    const onHostKeyChallenge = jest.fn();

    const connection = await SSHClient.connect(makeConfig({ strictHostKeyChecking: 'accept-new' }), {
      onHostKeyChallenge,
    });

    expect(onHostKeyChallenge).not.toHaveBeenCalled();
    expect(await HostStorageService.getKnownHosts()).toHaveLength(1);

    await connection.disconnect();
  });

  it('refuses an unknown host under StrictHostKeyChecking=yes', async () => {
    await expect(
      SSHClient.connect(makeConfig({ strictHostKeyChecking: 'yes' }), {
        onHostKeyChallenge: jest.fn().mockResolvedValue(true),
      })
    ).rejects.toThrow(/not in known hosts/i);
  });

  it('never silently accepts a changed host key, even under StrictHostKeyChecking=no', async () => {
    // Pre-trust a *different* key for this host.
    await SSHKnownHosts.trustHost(
      'server.example.com',
      22,
      'ssh-ed25519',
      'SHA256:thisIsNotTheKeyTheSimulatorPresents',
      'ssh-ed25519 AAAA old'
    );

    await expect(
      SSHClient.connect(makeConfig({ strictHostKeyChecking: 'no' }), {
        onHostKeyChallenge: jest.fn(),
      })
    ).rejects.toThrow(/REMOTE HOST IDENTIFICATION HAS CHANGED/);
  });

  it('surfaces a changed key as a mismatch when the policy is ask', async () => {
    await SSHKnownHosts.trustHost(
      'server.example.com',
      22,
      'ssh-ed25519',
      'SHA256:somethingElseEntirely',
      'ssh-ed25519 AAAA old'
    );

    const onHostKeyChallenge = jest.fn().mockResolvedValue(false);

    await expect(SSHClient.connect(makeConfig(), { onHostKeyChallenge })).rejects.toThrow();

    expect(onHostKeyChallenge.mock.calls[0][0]).toMatchObject({
      isMismatch: true,
      storedFingerprint: 'SHA256:somethingElseEntirely',
    });
  });
});

describe('SSHClient credential resolution', () => {
  beforeEach(async () => {
    FileSystemMock.__reset();
    await HostStorageService.reset();
  });

  it('fails clearly when key auth is configured without an identity', async () => {
    await expect(
      SSHClient.connect(makeConfig({ authenticationType: 'key' }), {
        onHostKeyChallenge: jest.fn().mockResolvedValue(true),
      })
    ).rejects.toThrow(/no identity is selected/i);
  });

  it('fails clearly when the configured identity has been deleted', async () => {
    await expect(
      SSHClient.connect(makeConfig({ authenticationType: 'key', identityId: 'gone' }), {
        onHostKeyChallenge: jest.fn().mockResolvedValue(true),
      })
    ).rejects.toThrow(/no longer exists/i);
  });

  it('prompts for a password and aborts if the prompt is cancelled', async () => {
    const onPasswordRequired = jest.fn().mockResolvedValue(null);

    await expect(
      SSHClient.connect(makeConfig({ authenticationType: 'password' }), {
        onHostKeyChallenge: jest.fn().mockResolvedValue(true),
        onPasswordRequired,
      })
    ).rejects.toThrow(/cancelled/i);

    expect(onPasswordRequired).toHaveBeenCalled();
  });
});

describe('SSHClient connection history', () => {
  beforeEach(async () => {
    FileSystemMock.__reset();
    await HostStorageService.reset();
  });

  it('records a failed attempt when the handshake is refused', async () => {
    await expect(
      SSHClient.connect(makeConfig(), { onHostKeyChallenge: jest.fn().mockResolvedValue(false) })
    ).rejects.toThrow();

    const history = await HostStorageService.getHistory();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ status: 'failed', hostAlias: 'web-prod' });
    expect(history[0].errorMessage).toMatch(/rejected by the user/i);
  });

  it('records exactly one successful entry per session, attributed to the host', async () => {
    const connection = await SSHClient.connect(makeConfig(), {
      onHostKeyChallenge: jest.fn().mockResolvedValue(true),
      hostId: 'host_42',
    });

    await waitForStatus(connection, 'connected');

    await connection.disconnect();
    // A second disconnect must not duplicate the entry.
    await connection.disconnect();

    const history = await HostStorageService.getHistory();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ status: 'success', hostId: 'host_42' });
  });
});

describe('SSHClient port forwarding', () => {
  beforeEach(async () => {
    FileSystemMock.__reset();
    await HostStorageService.reset();
  });

  it('registers the declared forwards for the session it is opening', async () => {
    const connection = await SSHClient.connect(
      makeConfig({
        localForwards: [{ bindPort: 8080, targetHost: 'db.internal', targetPort: 5432 }],
        dynamicForwards: [{ port: 1080 }],
      }),
      { onHostKeyChallenge: jest.fn().mockResolvedValue(true) }
    );

    const tunnels = SSHTunnelManager.getTunnelsForSession(connection.id);
    expect(tunnels.map(t => t.type)).toEqual(['local', 'dynamic']);

    // Nothing reaches the network under the simulator, so nothing may claim to
    // be listening either.
    expect(tunnels.every(t => t.status === 'pending')).toBe(true);

    await connection.disconnect();
    expect(SSHTunnelManager.getTunnelsForSession(connection.id)).toEqual([]);
  });

  it('drops the tunnels when the connection never comes up', async () => {
    const sessionIdsSeen: string[] = [];
    const unsubscribe = SSHTunnelManager.subscribe(() => {
      // Captured while the tunnels still exist: the failure path must clear
      // them, and by the time connect() throws they are already gone.
      sessionIdsSeen.push('changed');
    });

    await expect(
      SSHClient.connect(
        makeConfig({ localForwards: [{ bindPort: 8080, targetHost: 'db', targetPort: 5432 }] }),
        { onHostKeyChallenge: jest.fn().mockResolvedValue(false) }
      )
    ).rejects.toThrow();

    unsubscribe();
    // Registered, then cleared: at least one change either way.
    expect(sessionIdsSeen.length).toBeGreaterThanOrEqual(2);
  });
});

describe('SSHClient ProxyJump', () => {
  beforeEach(async () => {
    FileSystemMock.__reset();
    await HostStorageService.reset();
  });

  function savedHost(overrides: Partial<SSHHost> & { alias: string }): SSHHost {
    return {
      id: `host_${overrides.alias}`,
      hostname: `${overrides.alias}.example.com`,
      port: 22,
      username: 'ops',
      tags: [],
      favorite: false,
      authenticationType: 'none',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    };
  }

  it('verifies each machine in the chain in turn, and trusts them separately', async () => {
    const challenged: string[] = [];
    const onHostKeyChallenge = jest.fn(async (challenge: { hostname: string; port: number }) => {
      challenged.push(`${challenge.hostname}:${challenge.port}`);
      return true;
    });

    const connection = await SSHClient.connect(
      makeConfig({ proxyJump: 'jump@bastion.example.com:2222' }),
      { onHostKeyChallenge }
    );

    // The bastion is dialled first, so its key is the first one presented.
    expect(challenged).toEqual(['bastion.example.com:2222', 'server.example.com:22']);

    const knownHosts = await HostStorageService.getKnownHosts();
    expect(knownHosts.map(entry => entry.hostname).sort()).toEqual([
      'bastion.example.com',
      'server.example.com',
    ]);

    await connection.disconnect();
  });

  it('never reaches the target when the jump host key is refused', async () => {
    const onHostKeyChallenge = jest.fn().mockResolvedValue(false);

    await expect(
      SSHClient.connect(makeConfig({ proxyJump: 'jump@bastion.example.com' }), {
        onHostKeyChallenge,
      })
    ).rejects.toThrow(/bastion\.example\.com/i);

    expect(onHostKeyChallenge).toHaveBeenCalledTimes(1);
    expect(await HostStorageService.getKnownHosts()).toHaveLength(0);
  });

  /** A bastion's policy is the bastion's, not whatever the target settled on. */
  it('applies a jump host own StrictHostKeyChecking', async () => {
    await HostStorageService.saveHost(
      savedHost({ alias: 'gateway', username: 'jump', strictHostKeyChecking: 'yes' })
    );

    const onHostKeyChallenge = jest.fn().mockResolvedValue(true);

    await expect(
      SSHClient.connect(makeConfig({ proxyJump: 'gateway', strictHostKeyChecking: 'ask' }), {
        onHostKeyChallenge,
      })
    ).rejects.toThrow();

    // Under `yes` an unknown key is refused outright; asking would be wrong.
    expect(onHostKeyChallenge).not.toHaveBeenCalled();
  });

  it('refuses to connect at all when the chain cannot be resolved', async () => {
    await expect(
      SSHClient.connect(makeConfig({ proxyJump: 'bastion.example.com' }), {
        onHostKeyChallenge: jest.fn().mockResolvedValue(true),
      })
    ).rejects.toThrow(/no username/i);

    const history = await HostStorageService.getHistory();
    expect(history[0]).toMatchObject({ status: 'failed' });
  });
});
