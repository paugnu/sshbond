import { NativeConnectRequest } from './NativeSSHBridge';

/**
 * Stand-in engine used when the `expo-sshbond` native module is absent: Jest,
 * web, and Expo Go before a development build has been made.
 *
 * It runs the full session lifecycle -- including host key verification -- so
 * the UI and the client orchestration can be exercised end to end. It is a
 * simulator, never a fallback for a failed real connection, and it says so in
 * the banner: silently pretending to be connected to a production server would
 * be far worse than refusing to connect.
 */
const SIMULATED_HOST_KEY = {
  algorithm: 'ssh-ed25519',
  fingerprint: 'SHA256:U5uS0hRr9r3Bx8Y3VvvR3xtcC0lJKGJ0kR5iVQ0dEMo',
  publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHNpbXVsYXRlZC1ob3N0LWtleS1ub3QtcmVhbA sshbond-simulator',
};

export class MockSSHBridge {
  public static async createSession(request: NativeConnectRequest): Promise<void> {
    const { config, connection } = request;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const later = (ms: number, fn: () => void) => {
      timers.push(setTimeout(fn, ms));
    };

    connection.addCleanup(() => {
      for (const timer of timers) clearTimeout(timer);
    });

    connection.updateStatus('connecting');
    connection.updateStatus('verifying_host');

    // Same verification path the native engine drives, and in the same order:
    // every jump host is vetted before the target, so a chain behaves here
    // exactly as it would on device -- a rejected key at any hop aborts.
    for (const jump of request.jumps ?? []) {
      const acceptedHop = await request.verifyHostKey({
        ...SIMULATED_HOST_KEY,
        hostname: jump.hostname,
        port: jump.port,
      });
      if (!acceptedHop) {
        throw new Error(
          `Host key verification failed for jump host ${jump.hostname}: rejected by the user.`
        );
      }
    }

    const accepted = await request.verifyHostKey({
      ...SIMULATED_HOST_KEY,
      hostname: config.hostname,
      port: config.port,
    });
    if (!accepted) {
      throw new Error('Host key verification failed: rejected by the user.');
    }

    const username = config.username || 'user';
    const alias = config.alias || 'sshbond';
    const via = (request.jumps ?? []).map(jump => `${jump.username}@${jump.hostname}:${jump.port}`);
    const prompt = `\x1b[32m${username}@${alias}\x1b[0m:\x1b[34m~\x1b[0m$ `;

    let inputBuffer = '';

    connection.setHandlers({
      send: async (input: string) => {
        inputBuffer = handleInput(input, inputBuffer, prompt, config.hostname, username, connection);
      },
      resize: async () => {
        // The simulator has no PTY to resize.
      },
      disconnect: async () => {
        // Closing is handled by SSHConnection.disconnect().
      },
    });

    connection.updateStatus('authenticating');

    later(150, () => {
      connection.updateStatus('connected');
      connection.emitData(
        [
          '\x1b[33m*** SSHBond simulator: no native SSH engine is loaded. ***\x1b[0m',
          '\x1b[33m*** Nothing is being sent to the network.            ***\x1b[0m',
          '',
          `\x1b[38;5;39mWould connect to ${config.hostname}:${config.port} as ${username}\x1b[0m`,
          ...(via.length > 0 ? [`\x1b[38;5;39mvia ${via.join(' → ')}\x1b[0m`] : []),
          '',
          prompt,
        ].join('\r\n')
      );
    });
  }
}

function handleInput(
  input: string,
  buffer: string,
  prompt: string,
  hostname: string,
  username: string,
  connection: NativeConnectRequest['connection']
): string {
  // Backspace
  if (input === '\x7f' || input === '\b') {
    if (buffer.length > 0) {
      connection.emitData('\b \b');
      return buffer.slice(0, -1);
    }
    return buffer;
  }

  // Ctrl+C
  if (input === '\x03') {
    connection.emitData(`^C\r\n${prompt}`);
    return '';
  }

  // Ctrl+L
  if (input === '\x0c') {
    connection.emitData(`\x1b[2J\x1b[H${prompt}${buffer}`);
    return buffer;
  }

  if (input === '\r' || input === '\n') {
    const command = buffer.trim();
    connection.emitData('\r\n');

    if (command === 'exit' || command === 'logout') {
      connection.emitData(`logout\r\nConnection to ${hostname} closed.\r\n`);
      void connection.disconnect();
      return '';
    }

    connection.emitData(runSimulatedCommand(command, hostname, username));
    connection.emitData(prompt);
    return '';
  }

  connection.emitData(input);
  return buffer + input;
}

function runSimulatedCommand(command: string, hostname: string, username: string): string {
  if (!command) return '';

  switch (command) {
    case 'whoami':
      return `${username}\r\n`;
    case 'hostname':
      return `${hostname}\r\n`;
    case 'uname -a':
      return `Linux ${hostname} 6.8.0-40-generic #40-Ubuntu SMP x86_64 GNU/Linux\r\n`;
    case 'clear':
      return '\x1b[2J\x1b[H';
    case 'ls':
    case 'ls -la':
      return [
        'total 16',
        `drwxr-xr-x 4 ${username} ${username} 4096 Jan  1 00:00 .`,
        'drwxr-xr-x 3 root root 4096 Jan  1 00:00 ..',
        `drwx------ 2 ${username} ${username} 4096 Jan  1 00:00 .ssh`,
        `drwxr-xr-x 2 ${username} ${username} 4096 Jan  1 00:00 projects`,
        '',
      ].join('\r\n');
    default:
      return `sshbond-simulator: ${command}: no native SSH engine loaded\r\n`;
  }
}
