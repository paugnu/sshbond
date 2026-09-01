type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Patterns that must never reach a log line, in the order they are applied.
 *
 * SSHBond logs are copied to the clipboard by users and pasted into bug
 * reports, so redaction happens at the logger rather than at each call site:
 * one forgotten interpolation should not be able to leak a private key.
 */
const REDACTIONS: [RegExp, string][] = [
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, '[private key redacted]'],
  [/\b(pass(word|phrase)|secret|token)\b\s*[:=]\s*\S+/gi, '$1: [redacted]'],
];

let minimumLevel: LogLevel = __DEV__ ? 'debug' : 'warn';

function redact(value: unknown): unknown {
  if (typeof value === 'string') {
    return REDACTIONS.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), value);
  }

  if (value instanceof Error) {
    return `${value.name}: ${redact(value.message)}`;
  }

  return value;
}

function log(level: LogLevel, scope: string, message: string, ...details: unknown[]): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minimumLevel]) return;

  const line = `[${scope}] ${redact(message)}`;
  const safeDetails = details.map(redact);

  switch (level) {
    case 'debug':
    case 'info':
      console.log(line, ...safeDetails);
      break;
    case 'warn':
      console.warn(line, ...safeDetails);
      break;
    case 'error':
      console.error(line, ...safeDetails);
      break;
  }
}

/**
 * Privacy-preserving diagnostic logger. Nothing here leaves the device: there
 * is no remote sink, by design.
 */
export const logger = {
  setLevel(level: LogLevel): void {
    minimumLevel = level;
  },
  scoped(scope: string) {
    return {
      debug: (message: string, ...details: unknown[]) => log('debug', scope, message, ...details),
      info: (message: string, ...details: unknown[]) => log('info', scope, message, ...details),
      warn: (message: string, ...details: unknown[]) => log('warn', scope, message, ...details),
      error: (message: string, ...details: unknown[]) => log('error', scope, message, ...details),
    };
  },
  redact,
};
