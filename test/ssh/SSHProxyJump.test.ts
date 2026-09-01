import { SSHProxyJump } from '../../src/services/ssh/SSHProxyJump';
import { HostStorageService } from '../../src/services/persistence/HostStorageService';
import { ResolvedSSHConfig, SSHHost } from '../../src/domain/models/sshConfig';

const FileSystemMock = jest.requireMock('expo-file-system/legacy') as { __reset: () => void };

function makeConfig(overrides: Partial<ResolvedSSHConfig> = {}): ResolvedSSHConfig {
  return {
    alias: 'web-prod',
    hostname: 'server.example.com',
    port: 22,
    username: 'ubuntu',
    authenticationType: 'key',
    identityId: 'key_target',
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

function makeHost(overrides: Partial<SSHHost> & { alias: string }): SSHHost {
  return {
    id: `host_${overrides.alias}`,
    hostname: `${overrides.alias}.example.com`,
    port: 22,
    username: 'ops',
    tags: [],
    favorite: false,
    authenticationType: 'key',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('SSHProxyJump.parseChain', () => {
  it('reads a comma-separated chain in traversal order', () => {
    expect(SSHProxyJump.parseChain('bastion1,bastion2')).toEqual([
      { hostname: 'bastion1', username: undefined, port: undefined },
      { hostname: 'bastion2', username: undefined, port: undefined },
    ]);
  });

  it('keeps an explicit user and port, and leaves them unstated otherwise', () => {
    expect(SSHProxyJump.parseChain('jump@gateway:2222')).toEqual([
      { username: 'jump', hostname: 'gateway', port: 2222 },
    ]);
  });

  /** `none` is OpenSSH's way of cancelling an inherited ProxyJump. */
  it('treats none as no chain at all, never as a hostname', () => {
    expect(SSHProxyJump.parseChain('none')).toEqual([]);
    expect(SSHProxyJump.parseChain('NONE')).toEqual([]);
    expect(SSHProxyJump.parseChain(undefined)).toEqual([]);
    expect(SSHProxyJump.parseChain('   ')).toEqual([]);
  });
});

describe('SSHProxyJump.resolveChain', () => {
  beforeEach(async () => {
    FileSystemMock.__reset();
    await HostStorageService.reset();
  });

  it('returns nothing for a host with no ProxyJump', async () => {
    expect(await SSHProxyJump.resolveChain(makeConfig())).toEqual([]);
  });

  it('resolves a hop against the saved host it names', async () => {
    await HostStorageService.saveHost(
      makeHost({
        alias: 'gateway',
        hostname: 'gw.example.com',
        port: 2022,
        username: 'jump',
        identityId: 'key_gateway',
        strictHostKeyChecking: 'yes',
      })
    );

    const [hop] = await SSHProxyJump.resolveChain(makeConfig({ proxyJump: 'gateway' }));

    expect(hop).toMatchObject({
      alias: 'gateway',
      hostname: 'gw.example.com',
      port: 2022,
      username: 'jump',
      identityId: 'key_gateway',
      // A jump host answers for its own policy, not the target's.
      strictHostKeyChecking: 'yes',
    });
  });

  it('lets the directive override the saved host, as OpenSSH does', async () => {
    await HostStorageService.saveHost(
      makeHost({ alias: 'gateway', hostname: 'gw.example.com', port: 22, username: 'ops' })
    );

    const [hop] = await SSHProxyJump.resolveChain(makeConfig({ proxyJump: 'root@gateway:2222' }));

    expect(hop).toMatchObject({ hostname: 'gw.example.com', port: 2222, username: 'root' });
  });

  /**
   * An unsaved bastion has no settings of its own; borrowing the target's key
   * is what makes `ProxyJump user@host` work without saving the host first.
   */
  it('falls back to the target credentials for an unsaved jump host', async () => {
    const [hop] = await SSHProxyJump.resolveChain(makeConfig({ proxyJump: 'jump@10.0.0.1' }));

    expect(hop).toMatchObject({
      hostname: '10.0.0.1',
      port: 22,
      username: 'jump',
      authenticationType: 'key',
      identityId: 'key_target',
    });
  });

  it('refuses a hop it cannot name a user for', async () => {
    await expect(
      SSHProxyJump.resolveChain(makeConfig({ proxyJump: '10.0.0.1', username: 'ubuntu' }))
    ).rejects.toThrow(/no username/i);
  });

  it('keeps a multi-hop chain in the order it is traversed', async () => {
    const hops = await SSHProxyJump.resolveChain(
      makeConfig({ proxyJump: 'a@first,b@second,c@third' })
    );

    expect(hops.map(hop => hop.hostname)).toEqual(['first', 'second', 'third']);
  });

  /** A bastion reachable only through another bastion has to be entered first. */
  it('expands a jump host that itself sits behind one', async () => {
    await HostStorageService.saveHost(
      makeHost({ alias: 'outer', hostname: 'outer.example.com', username: 'ops' })
    );
    await HostStorageService.saveHost(
      makeHost({
        alias: 'inner',
        hostname: 'inner.example.com',
        username: 'ops',
        proxyJump: 'outer',
      })
    );

    const hops = await SSHProxyJump.resolveChain(makeConfig({ proxyJump: 'inner' }));

    expect(hops.map(hop => hop.hostname)).toEqual(['outer.example.com', 'inner.example.com']);
  });

  it('refuses a chain that loops back on itself', async () => {
    await HostStorageService.saveHost(
      makeHost({ alias: 'a', hostname: 'a.example.com', username: 'ops', proxyJump: 'b' })
    );
    await HostStorageService.saveHost(
      makeHost({ alias: 'b', hostname: 'b.example.com', username: 'ops', proxyJump: 'a' })
    );

    await expect(SSHProxyJump.resolveChain(makeConfig({ proxyJump: 'a' }))).rejects.toThrow(
      /loops back/i
    );
  });

  /** Jumping through the target to reach the target would connect to nothing. */
  it('refuses a chain that jumps through the target itself', async () => {
    await expect(
      SSHProxyJump.resolveChain(makeConfig({ proxyJump: 'ubuntu@server.example.com' }))
    ).rejects.toThrow(/loops back/i);
  });
});
