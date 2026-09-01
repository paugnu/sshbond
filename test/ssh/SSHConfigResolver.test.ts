import { SSHConfigParser } from '../../src/services/ssh/config/SSHConfigParser';
import { SSHConfigResolver } from '../../src/services/ssh/config/SSHConfigResolver';
import { SSHHost } from '../../src/domain/models/sshConfig';

describe('SSHConfigResolver', () => {
  it('should correctly resolve inheritance with first-match-wins semantics', () => {
    const raw = `
Host *
    ServerAliveInterval 60
    User defaultuser
    Port 22

Host *.prod
    IdentityFile ~/.ssh/prod_key
    User prodadmin

Host db.prod
    HostName 10.0.0.20
    User dbuser
    ProxyJump gateway

Host gateway
    HostName 203.0.113.1
    User gatewayuser
`;

    const parsed = SSHConfigParser.parse(raw);

    // Resolving db.prod
    const resolvedDb = SSHConfigResolver.resolve('db.prod', parsed.blocks);
    expect(resolvedDb.hostname).toBe('10.0.0.20');
    // Note: Since 'Host *' appears first in this file, 'User defaultuser' is encountered first in OpenSSH semantics!
    // OpenSSH rule: first obtained value is used.
    expect(resolvedDb.serverAliveInterval).toBe(60);
    expect(resolvedDb.identityFile).toBe('~/.ssh/prod_key');
    expect(resolvedDb.proxyJump).toBe('gateway');
  });

  it('should correctly prioritize specific overrides when defined before wildcards', () => {
    const raw = `
Host db.prod
    HostName 10.0.0.20
    User dbuser
    Port 5432
    ProxyJump gateway

Host *.prod
    User prodadmin
    IdentityFile ~/.ssh/prod_key

Host *
    User defaultuser
    ServerAliveInterval 60
    Port 22
`;

    const parsed = SSHConfigParser.parse(raw);
    const resolvedDb = SSHConfigResolver.resolve('db.prod', parsed.blocks);

    expect(resolvedDb.hostname).toBe('10.0.0.20');
    expect(resolvedDb.username).toBe('dbuser'); // Specific wins because it's first
    expect(resolvedDb.port).toBe(5432);
    expect(resolvedDb.identityFile).toBe('~/.ssh/prod_key'); // Inherited from *.prod
    expect(resolvedDb.serverAliveInterval).toBe(60); // Inherited from *
    expect(resolvedDb.proxyJump).toBe('gateway');
  });

  it('should support negation and question mark wildcards', () => {
    expect(SSHConfigResolver.matchesHostPatterns('app-1', ['app-?'])).toBe(true);
    expect(SSHConfigResolver.matchesHostPatterns('app-12', ['app-?'])).toBe(false);
    expect(SSHConfigResolver.matchesHostPatterns('test-dev', ['!test-*', '*'])).toBe(false);
    expect(SSHConfigResolver.matchesHostPatterns('prod-db', ['!test-*', '*'])).toBe(true);
  });
});

describe('SSHConfigResolver.resolveFromHostModels', () => {
  const base = {
    tags: [],
    favorite: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  const target: SSHHost = {
    ...base,
    id: 'h1',
    alias: 'db.prod',
    hostname: '10.0.0.20',
    port: 22,
    username: '',
    authenticationType: 'password',
  };

  const wildcardProd: SSHHost = {
    ...base,
    id: 'h2',
    alias: '*.prod',
    hostname: '',
    port: 22,
    username: 'prodadmin',
    authenticationType: 'key',
    identityId: 'key_prod',
    serverAliveInterval: 30,
    localForwards: [{ bindPort: 5432, targetHost: '127.0.0.1', targetPort: 5432 }],
  };

  const globalDefaults: SSHHost = {
    ...base,
    id: 'h3',
    alias: '*',
    hostname: '',
    port: 22,
    username: 'defaultuser',
    authenticationType: 'password',
    serverAliveInterval: 60,
    connectTimeout: 15,
    strictHostKeyChecking: 'accept-new',
  };

  it('inherits from wildcard entries, most specific first', () => {
    const resolved = SSHConfigResolver.resolveFromHostModels(target, [
      target,
      globalDefaults,
      wildcardProd,
    ]);

    // The target sets neither, so *.prod wins over * for both.
    expect(resolved.username).toBe('prodadmin');
    expect(resolved.serverAliveInterval).toBe(30);

    // Only the global entry supplies these.
    expect(resolved.connectTimeout).toBe(15);
    expect(resolved.strictHostKeyChecking).toBe('accept-new');

    // The target's own values are never overridden.
    expect(resolved.hostname).toBe('10.0.0.20');
  });

  it('lets the host itself win over any wildcard', () => {
    const explicit: SSHHost = { ...target, username: 'dbuser', connectTimeout: 5 };

    const resolved = SSHConfigResolver.resolveFromHostModels(explicit, [
      explicit,
      wildcardProd,
      globalDefaults,
    ]);

    expect(resolved.username).toBe('dbuser');
    expect(resolved.connectTimeout).toBe(5);
  });

  it('inherits an identity for a key-auth host that names none', () => {
    const keyAuthHost: SSHHost = { ...target, authenticationType: 'key' };

    const resolved = SSHConfigResolver.resolveFromHostModels(keyAuthHost, [keyAuthHost, wildcardProd]);

    expect(resolved.authenticationType).toBe('key');
    expect(resolved.identityId).toBe('key_prod');
  });

  it('does not let a wildcard override an explicit auth type', () => {
    // The target says password; inheriting *.prod's key would change how the
    // user is authenticated behind their back.
    const resolved = SSHConfigResolver.resolveFromHostModels(target, [target, wildcardProd]);

    expect(resolved.authenticationType).toBe('password');
    expect(resolved.identityId).toBeUndefined();
  });

  it('accumulates port forwards across the inheritance chain', () => {
    const withForward: SSHHost = {
      ...target,
      localForwards: [{ bindPort: 8080, targetHost: '127.0.0.1', targetPort: 80 }],
    };

    const resolved = SSHConfigResolver.resolveFromHostModels(withForward, [
      withForward,
      wildcardProd,
    ]);

    expect(resolved.localForwards).toHaveLength(2);
    expect(resolved.localForwards.map(f => f.bindPort).sort()).toEqual([5432, 8080]);
  });

  it('ignores wildcard entries that do not match the target', () => {
    const staging: SSHHost = { ...base, id: 'h4', alias: '*.staging', hostname: '', port: 22, username: 'stager', authenticationType: 'password' };

    const resolved = SSHConfigResolver.resolveFromHostModels(target, [target, staging]);

    expect(resolved.username).toBe('');
  });

  it('falls back to OpenSSH defaults with no wildcards present', () => {
    const resolved = SSHConfigResolver.resolveFromHostModels(target, [target]);

    expect(resolved.port).toBe(22);
    expect(resolved.connectTimeout).toBe(30);
    expect(resolved.strictHostKeyChecking).toBe('ask');
    expect(resolved.serverAliveCountMax).toBe(3);
  });
});
