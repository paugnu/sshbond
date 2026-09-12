import { SSHConfigParser } from '../../src/services/ssh/config/SSHConfigParser';
import { SSHConfigSerializer } from '../../src/services/ssh/config/SSHConfigSerializer';
import { SSHHost } from '../../src/domain/models/sshConfig';

describe('SSHConfigSerializer', () => {
  it('should serialize SSHHost models and be cleanly re-parsable', () => {
    const host: SSHHost = {
      id: 'test-1',
      alias: 'yogabond',
      hostname: 'server.example.com',
      username: 'pau',
      port: 22,
      authenticationType: 'key',
      serverAliveInterval: 60,
      tags: ['production'],
      favorite: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const output = SSHConfigSerializer.serializeHost(host);
    expect(output).toContain('Host yogabond');
    expect(output).toContain('HostName server.example.com');
    expect(output).toContain('User pau');
    expect(output).toContain('ServerAliveInterval 60');

    const parsed = SSHConfigParser.parse(output);
    expect(parsed.hosts.length).toBe(1);
    expect(parsed.hosts[0].alias).toBe('yogabond');
    expect(parsed.hosts[0].hostname).toBe('server.example.com');
    expect(parsed.hosts[0].username).toBe('pau');
    expect(parsed.hosts[0].serverAliveInterval).toBe(60);
  });
});

it('keeps key authentication without inventing a file for a stored identity', () => {
  const host = SSHConfigParser.parse('Host demo\n  HostName example.com\n  User demo').hosts[0];
  host.authenticationType = 'key';
  host.identityId = 'id_internal_123';
  const text = SSHConfigSerializer.serializeHost(host);
  expect(text).not.toContain('IdentityFile');
  expect(text).not.toContain('id_internal_123');
  expect(SSHConfigParser.parse(text).hosts[0].authenticationType).toBe('key');
});

it('preserves an explicitly imported IdentityFile on a config round trip', () => {
  const host = SSHConfigParser.parse('Host demo\n  IdentityFile ~/.ssh/my_key').hosts[0];
  expect(SSHConfigSerializer.serializeHost(host)).toContain('IdentityFile ~/.ssh/my_key');
});
