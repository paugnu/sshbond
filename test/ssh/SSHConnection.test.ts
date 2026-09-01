import { SSHConnection } from '../../src/services/ssh/SSHConnection';
import { ResolvedSSHConfig } from '../../src/domain/models/sshConfig';

const config: ResolvedSSHConfig = {
  alias: 'test',
  hostname: 'test.example.com',
  port: 22,
  username: 'pau',
  authenticationType: 'none',
  serverAliveInterval: 0,
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
};

describe('SSHConnection', () => {
  it('refuses input until the session can carry it', async () => {
    const connection = new SSHConnection('s1', config);

    await expect(connection.sendInput('ls\n')).rejects.toThrow(/disconnected/);

    connection.updateStatus('connected');
    const send = jest.fn().mockResolvedValue(undefined);
    connection.setHandlers({ send, resize: jest.fn(), disconnect: jest.fn() });

    await connection.sendInput('ls\n');
    expect(send).toHaveBeenCalledWith('ls\n');
  });

  it('closes exactly once however many times it is asked to', async () => {
    const connection = new SSHConnection('s1', config);
    const disconnect = jest.fn().mockResolvedValue(undefined);
    const onClose = jest.fn();

    connection.setHandlers({ send: jest.fn(), resize: jest.fn(), disconnect });
    connection.onClose(onClose);

    await connection.disconnect();
    await connection.disconnect();
    connection.emitClose(1);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('runs cleanup handlers on close so native subscriptions do not leak', () => {
    const connection = new SSHConnection('s1', config);
    const cleanup = jest.fn();

    connection.addCleanup(cleanup);
    connection.emitClose(0);
    connection.emitClose(0);

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('reports a status change only when the status actually changes', () => {
    const connection = new SSHConnection('s1', config);
    const listener = jest.fn();

    connection.onStatusChange(listener);
    connection.updateStatus('connecting');
    connection.updateStatus('connecting');
    connection.updateStatus('connected');

    expect(listener.mock.calls.map(call => call[0])).toEqual(['connecting', 'connected']);
  });

  it('keeps notifying listeners after one of them throws', () => {
    const connection = new SSHConnection('s1', config);
    const second = jest.fn();

    connection.onData(() => {
      throw new Error('listener blew up');
    });
    connection.onData(second);

    expect(() => connection.emitData('output')).not.toThrow();
    expect(second).toHaveBeenCalledWith('output');
  });

  it('ignores nonsensical resize requests instead of forwarding them', async () => {
    const connection = new SSHConnection('s1', config);
    const resize = jest.fn().mockResolvedValue(undefined);
    connection.setHandlers({ send: jest.fn(), resize, disconnect: jest.fn() });

    await connection.resize(0, 24);
    await connection.resize(80, -1);
    await connection.resize(Number.NaN, 24);
    expect(resize).not.toHaveBeenCalled();

    await connection.resize(80.6, 24.2);
    expect(resize).toHaveBeenCalledWith(80, 24);
  });

  it('stops delivering to unsubscribed listeners', () => {
    const connection = new SSHConnection('s1', config);
    const listener = jest.fn();

    const unsubscribe = connection.onData(listener);
    connection.emitData('first');
    unsubscribe();
    connection.emitData('second');

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
