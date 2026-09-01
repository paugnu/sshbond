import { SSHKnownHosts } from '../../src/services/ssh/hosts/SSHKnownHosts';
import { HostStorageService } from '../../src/services/persistence/HostStorageService';

describe('SSHKnownHosts', () => {
  beforeEach(async () => {
    await HostStorageService.init();
  });

  it('should identify unknown host on first connection', async () => {
    const result = await SSHKnownHosts.verifyHostKey(
      'newserver.example.com',
      22,
      'ssh-ed25519',
      'SHA256:abcd1234fakefingerprint',
      'ssh-ed25519 AAAAC3... blob'
    );

    expect(result.status).toBe('unknown');
  });

  it('should trust and verify matching host key', async () => {
    await SSHKnownHosts.trustHost(
      'trusted.example.com',
      22,
      'ssh-ed25519',
      'SHA256:exactmatchfingerprint',
      'ssh-ed25519 AAAAC3... blob'
    );

    const result = await SSHKnownHosts.verifyHostKey(
      'trusted.example.com',
      22,
      'ssh-ed25519',
      'SHA256:exactmatchfingerprint',
      'ssh-ed25519 AAAAC3... blob'
    );

    expect(result.status).toBe('trusted');
  });

  it('should detect mismatch when server key changes (security alert)', async () => {
    await SSHKnownHosts.trustHost(
      'spoofed.example.com',
      22,
      'ssh-ed25519',
      'SHA256:originalfingerprint',
      'ssh-ed25519 AAAAC3... blob'
    );

    const result = await SSHKnownHosts.verifyHostKey(
      'spoofed.example.com',
      22,
      'ssh-ed25519',
      'SHA256:CHANGED_MITM_FINGERPRINT',
      'ssh-ed25519 AAAAC3... blob2'
    );

    expect(result.status).toBe('mismatch');
    expect(result.storedFingerprint).toBe('SHA256:originalfingerprint');
  });
});

describe('SSHKnownHosts key matching', () => {
  beforeEach(async () => {
    (jest.requireMock('expo-file-system/legacy') as { __reset: () => void }).__reset();
    await HostStorageService.reset();
  });

  it('treats a different algorithm on the same host as a new key, not an attack', async () => {
    // Servers legitimately offer several host keys; an Ed25519 key arriving
    // where only an RSA key was recorded must not read as a mismatch.
    await SSHKnownHosts.trustHost('multi.example.com', 22, 'ssh-rsa', 'SHA256:rsaKey', 'ssh-rsa AAAA');

    const result = await SSHKnownHosts.verifyHostKey(
      'multi.example.com',
      22,
      'ssh-ed25519',
      'SHA256:ed25519Key',
      'ssh-ed25519 AAAA'
    );

    expect(result.status).toBe('unknown');
  });

  it('distinguishes the same host on a different port', async () => {
    await SSHKnownHosts.trustHost('host.example.com', 22, 'ssh-ed25519', 'SHA256:a', 'k');

    const result = await SSHKnownHosts.verifyHostKey(
      'host.example.com',
      2222,
      'ssh-ed25519',
      'SHA256:a',
      'k'
    );

    expect(result.status).toBe('unknown');
  });

  it('matches hostnames case-insensitively', async () => {
    await SSHKnownHosts.trustHost('Host.Example.COM', 22, 'ssh-ed25519', 'SHA256:a', 'k');

    const result = await SSHKnownHosts.verifyHostKey(
      'host.example.com',
      22,
      'ssh-ed25519',
      'SHA256:a',
      'k'
    );

    expect(result.status).toBe('trusted');
  });
});

describe('SSHKnownHosts.decide', () => {
  const unknown = {
    status: 'unknown' as const,
    hostname: 'h',
    port: 22,
    algorithm: 'ssh-ed25519',
    fingerprint: 'SHA256:new',
    publicKey: 'k',
  };
  const mismatch = { ...unknown, status: 'mismatch' as const, storedFingerprint: 'SHA256:old' };
  const trusted = { ...unknown, status: 'trusted' as const };

  it.each([
    ['ask', 'ask'],
    ['yes', 'reject'],
    ['no', 'accept'],
    ['accept-new', 'accept'],
  ] as const)('handles an unknown host under %s', (policy, expected) => {
    expect(SSHKnownHosts.decide(unknown, policy).action).toBe(expected);
  });

  it.each(['yes', 'no', 'accept-new'] as const)(
    'never auto-accepts a changed key under %s',
    policy => {
      const decision = SSHKnownHosts.decide(mismatch, policy);
      expect(decision.action).toBe('reject');
    }
  );

  it('asks about a changed key only when the policy is ask', () => {
    expect(SSHKnownHosts.decide(mismatch, 'ask').action).toBe('ask');
  });

  it('accepts a trusted key without re-recording it', () => {
    expect(SSHKnownHosts.decide(trusted, 'ask')).toEqual({ action: 'accept', trust: false });
  });
});
