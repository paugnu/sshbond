import { SSHConfigParser } from '../../src/services/ssh/config/SSHConfigParser';

describe('SSHConfigParser', () => {
  it('should parse standard OpenSSH configuration blocks', () => {
    const raw = `
# Global default
Host *
    ServerAliveInterval 60
    ServerAliveCountMax 3
    User pau

# Web production
Host web-prod
    HostName server.example.com
    Port 2222
    User ubuntu
    IdentityFile ~/.ssh/id_ed25519
    ProxyJump gateway.example.com
    LocalForward 8080 127.0.0.1:80
    RemoteForward 9000 127.0.0.1:3000
    DynamicForward 1080
    Compression yes
    ForwardAgent yes
    CustomHeader X-SSH-Bond
`;

    const result = SSHConfigParser.parse(raw);
    expect(result.blocks.length).toBe(2);
    expect(result.hosts.length).toBe(2);

    const webProd = result.hosts.find(h => h.alias === 'web-prod');
    expect(webProd).toBeDefined();
    expect(webProd?.hostname).toBe('server.example.com');
    expect(webProd?.port).toBe(2222);
    expect(webProd?.username).toBe('ubuntu');
    expect(webProd?.proxyJump).toBe('gateway.example.com');
    expect(webProd?.compression).toBe(true);
    expect(webProd?.forwardAgent).toBe(true);
    expect(webProd?.localForwards).toEqual([
      { bindAddress: undefined, bindPort: 8080, targetHost: '127.0.0.1', targetPort: 80 }
    ]);
    expect(webProd?.remoteForwards).toEqual([
      { bindAddress: undefined, bindPort: 9000, targetHost: '127.0.0.1', targetPort: 3000 }
    ]);
    expect(webProd?.dynamicForwards).toEqual([{ port: 1080 }]);
    expect(webProd?.customDirectives).toEqual({ customheader: 'X-SSH-Bond' });
  });

  it('should support equals sign and quotes in directives', () => {
    const raw = `
Host "my server"
    HostName="192.168.1.100"
    User='admin user'
    Port=2200
`;
    const result = SSHConfigParser.parse(raw);
    const host = result.hosts[0];
    expect(host.alias).toBe('my server');
    expect(host.hostname).toBe('192.168.1.100');
    expect(host.username).toBe('admin user');
    expect(host.port).toBe(2200);
  });
});

describe('SSHConfigParser port forward syntax', () => {
  it('reads both spellings OpenSSH accepts', () => {
    expect(SSHConfigParser.parsePortForwards('8080 db.internal:5432')).toEqual([
      { bindPort: 8080, targetHost: 'db.internal', targetPort: 5432 },
    ]);

    // The colon form was previously dropped on the floor.
    expect(SSHConfigParser.parsePortForwards('8080:db.internal:5432')).toEqual([
      { bindPort: 8080, targetHost: 'db.internal', targetPort: 5432 },
    ]);
  });

  it('keeps an explicit bind address in either spelling', () => {
    expect(SSHConfigParser.parsePortForwards('0.0.0.0:8080 db:5432')).toEqual([
      { bindAddress: '0.0.0.0', bindPort: 8080, targetHost: 'db', targetPort: 5432 },
    ]);
    expect(SSHConfigParser.parsePortForwards('127.0.0.1:8080:db:5432')).toEqual([
      { bindAddress: '127.0.0.1', bindPort: 8080, targetHost: 'db', targetPort: 5432 },
    ]);
  });

  it('reads bracketed IPv6 literals on both sides', () => {
    expect(SSHConfigParser.parsePortForwards('[::1]:8080 [2001:db8::5]:5432')).toEqual([
      { bindAddress: '::1', bindPort: 8080, targetHost: '2001:db8::5', targetPort: 5432 },
    ]);
    expect(SSHConfigParser.parsePortForwards('[::1]:8080:[2001:db8::5]:5432')).toEqual([
      { bindAddress: '::1', bindPort: 8080, targetHost: '2001:db8::5', targetPort: 5432 },
    ]);
  });

  /** Forwarding a port to the wrong host is worse than not forwarding it. */
  it('drops a rule it cannot understand rather than guessing', () => {
    expect(SSHConfigParser.parsePortForwards('8080')).toEqual([]);
    expect(SSHConfigParser.parsePortForwards('8080 db.internal')).toEqual([]);
    expect(SSHConfigParser.parsePortForwards('eight:db:5432')).toEqual([]);
    // A bare IPv6 target has no room for a port and must be bracketed.
    expect(SSHConfigParser.parsePortForwards('8080 2001:db8::5:5432')).toEqual([]);
    expect(SSHConfigParser.parsePortForwards('8080 db:70000')).toEqual([]);
  });

  it('reads dynamic forwards with and without a bind address', () => {
    expect(SSHConfigParser.parseDynamicForwards('1080')).toEqual([{ port: 1080 }]);
    expect(SSHConfigParser.parseDynamicForwards('127.0.0.1:1080')).toEqual([
      { bindAddress: '127.0.0.1', port: 1080 },
    ]);
    expect(SSHConfigParser.parseDynamicForwards('[::1]:1080')).toEqual([
      { bindAddress: '::1', port: 1080 },
    ]);
    expect(SSHConfigParser.parseDynamicForwards('not-a-port')).toEqual([]);
  });
});
