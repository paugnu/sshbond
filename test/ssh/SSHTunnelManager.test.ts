import { SSHTunnelManager } from '../../src/services/ssh/SSHTunnelManager';
import { SSHConnection } from '../../src/services/ssh/SSHConnection';
import { ResolvedSSHConfig } from '../../src/domain/models/sshConfig';

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

function connectionWith(id: string, overrides: Partial<ResolvedSSHConfig>): SSHConnection {
  return new SSHConnection(id, makeConfig(overrides));
}

describe('SSHTunnelManager', () => {
  afterEach(() => {
    SSHTunnelManager.clear('s1');
    SSHTunnelManager.clear('s2');
  });

  it('registers one tunnel per declared rule, all of them pending', () => {
    const connection = connectionWith('s1', {
      localForwards: [{ bindPort: 8080, targetHost: 'db.internal', targetPort: 5432 }],
      remoteForwards: [
        { bindAddress: '*', bindPort: 9000, targetHost: 'localhost', targetPort: 3000 },
      ],
      dynamicForwards: [{ port: 1080 }],
    });

    const tunnels = SSHTunnelManager.registerForConnection(connection);

    expect(tunnels).toHaveLength(3);
    expect(tunnels.map(t => t.type)).toEqual(['local', 'remote', 'dynamic']);
    expect(tunnels.map(t => t.status)).toEqual(['pending', 'pending', 'pending']);
    expect(tunnels[0].description).toBe('-L localhost:8080 → db.internal:5432');
    expect(tunnels[1].description).toBe('-R *:9000 → localhost:3000');
    expect(tunnels[2].description).toBe('-D SOCKS5 on localhost:1080');
  });

  it('registers nothing for a session with no forwards', () => {
    expect(SSHTunnelManager.registerForConnection(connectionWith('s1', {}))).toEqual([]);
    expect(SSHTunnelManager.getTunnelsForSession('s1')).toEqual([]);
  });

  /**
   * The whole point of the engine reporting back: a tunnel must never be shown
   * as working just because a real engine is loaded.
   */
  it('leaves tunnels pending until the engine reports on them', () => {
    const connection = connectionWith('s1', {
      localForwards: [{ bindPort: 8080, targetHost: 'db.internal', targetPort: 5432 }],
    });
    SSHTunnelManager.registerForConnection(connection);

    expect(SSHTunnelManager.getTunnelsForSession('s1')[0].status).toBe('pending');

    SSHTunnelManager.applyStatus('s1', { tunnelId: 's1_local_0', status: 'active' });

    expect(SSHTunnelManager.getTunnelsForSession('s1')[0].status).toBe('active');
  });

  it('describes a rule by the port that was actually bound', () => {
    const connection = connectionWith('s1', {
      // Port 0 means "allocate one"; until the engine says which, the rule
      // cannot tell the user where to point their client.
      dynamicForwards: [{ port: 0 }],
    });
    SSHTunnelManager.registerForConnection(connection);

    SSHTunnelManager.applyStatus('s1', {
      tunnelId: 's1_dynamic_0',
      status: 'active',
      boundPort: 41234,
    });

    const [tunnel] = SSHTunnelManager.getTunnelsForSession('s1');
    expect(tunnel.boundPort).toBe(41234);
    expect(tunnel.description).toBe('-D SOCKS5 on localhost:41234');
  });

  it('keeps the reason a forward failed', () => {
    const connection = connectionWith('s1', {
      localForwards: [{ bindPort: 22, targetHost: 'db.internal', targetPort: 5432 }],
    });
    SSHTunnelManager.registerForConnection(connection);

    SSHTunnelManager.applyStatus('s1', {
      tunnelId: 's1_local_0',
      status: 'error',
      message: 'local port 127.0.0.1:22 cannot be bound.',
    });

    const [tunnel] = SSHTunnelManager.getTunnelsForSession('s1');
    expect(tunnel.status).toBe('error');
    expect(tunnel.message).toMatch(/cannot be bound/);
  });

  it('hands the engine the rules in native shape', () => {
    const connection = connectionWith('s1', {
      localForwards: [
        { bindAddress: '127.0.0.1', bindPort: 8080, targetHost: 'db.internal', targetPort: 5432 },
      ],
      dynamicForwards: [{ port: 1080 }],
    });
    SSHTunnelManager.registerForConnection(connection);

    expect(SSHTunnelManager.getForwardSpecs('s1')).toEqual([
      {
        id: 's1_local_0',
        type: 'local',
        bindAddress: '127.0.0.1',
        bindPort: 8080,
        targetHost: 'db.internal',
        targetPort: 5432,
      },
      {
        id: 's1_dynamic_0',
        type: 'dynamic',
        bindAddress: undefined,
        bindPort: 1080,
        targetHost: undefined,
        targetPort: undefined,
      },
    ]);
  });

  it('ignores a status for a session or tunnel it does not know', () => {
    SSHTunnelManager.applyStatus('s2', { tunnelId: 's2_local_0', status: 'active' });

    const connection = connectionWith('s1', {
      localForwards: [{ bindPort: 8080, targetHost: 'db.internal', targetPort: 5432 }],
    });
    SSHTunnelManager.registerForConnection(connection);

    SSHTunnelManager.applyStatus('s1', { tunnelId: 's1_local_7', status: 'active' });

    expect(SSHTunnelManager.getTunnelsForSession('s1')[0].status).toBe('pending');
  });

  it('drops the tunnels when the session closes', () => {
    const connection = connectionWith('s1', {
      localForwards: [{ bindPort: 8080, targetHost: 'db.internal', targetPort: 5432 }],
    });
    SSHTunnelManager.registerForConnection(connection);

    connection.emitClose(0);

    expect(SSHTunnelManager.getTunnelsForSession('s1')).toEqual([]);
  });

  it('notifies subscribers as tunnels appear, change and go', () => {
    const listener = jest.fn();
    const unsubscribe = SSHTunnelManager.subscribe(listener);

    const connection = connectionWith('s1', {
      localForwards: [{ bindPort: 8080, targetHost: 'db.internal', targetPort: 5432 }],
    });
    SSHTunnelManager.registerForConnection(connection);
    expect(listener).toHaveBeenCalledTimes(1);

    SSHTunnelManager.applyStatus('s1', { tunnelId: 's1_local_0', status: 'active' });
    expect(listener).toHaveBeenCalledTimes(2);

    connection.emitClose(0);
    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribe();
    SSHTunnelManager.registerForConnection(
      connectionWith('s2', {
        localForwards: [{ bindPort: 9090, targetHost: 'db.internal', targetPort: 5432 }],
      })
    );
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
