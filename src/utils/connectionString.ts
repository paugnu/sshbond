export interface ParsedConnectionString {
  username: string;
  hostname: string;
  port: number;
}

/**
 * The same destination, but saying nothing where the user said nothing.
 *
 * A ProxyJump hop that names no port must fall back to the port its saved host
 * carries, not to 22, so the absence has to survive parsing.
 */
export interface ParsedDestination {
  username?: string;
  hostname: string;
  port?: number;
}

const DEFAULT_PORT = 22;

/**
 * Parses a quick-connect string: `[user@]host[:port]`.
 *
 * Handles the cases a naive `split(':')` gets wrong -- bracketed IPv6 literals
 * (`[2001:db8::1]:2222`), bare IPv6 addresses, and usernames or passwords
 * containing `@` -- because getting any of them wrong silently connects the
 * user to the wrong machine.
 */
export function parseConnectionString(input: string): ParsedConnectionString {
  const { username, hostname, port } = parseDestination(input);
  return { username: username ?? '', hostname, port: port ?? DEFAULT_PORT };
}

/** As above, but leaves an unstated username or port unstated. */
export function parseDestination(input: string): ParsedDestination {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Enter a destination such as user@host or host:port.');
  }

  // The username ends at the *last* '@': an IPv6 zone or a literal '@' in the
  // user part would otherwise split in the wrong place.
  const atIndex = trimmed.lastIndexOf('@');
  const username = atIndex >= 0 ? trimmed.slice(0, atIndex) : undefined;
  const remainder = atIndex >= 0 ? trimmed.slice(atIndex + 1) : trimmed;

  if (!remainder) {
    throw new Error('Missing hostname.');
  }

  const { hostname, port } = splitHostAndPort(remainder);

  if (!hostname) {
    throw new Error('Missing hostname.');
  }
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new Error(`Invalid port: ${port}.`);
  }

  return { username: username || undefined, hostname, port };
}

function splitHostAndPort(value: string): { hostname: string; port?: number } {
  // Bracketed IPv6, optionally with a port: [::1] or [::1]:2222
  if (value.startsWith('[')) {
    const closing = value.indexOf(']');
    if (closing < 0) {
      throw new Error('Unbalanced brackets in IPv6 address.');
    }

    const hostname = value.slice(1, closing);
    const rest = value.slice(closing + 1);

    if (!rest) return { hostname };
    if (!rest.startsWith(':')) {
      throw new Error(`Unexpected text after IPv6 address: "${rest}".`);
    }

    return { hostname, port: toPort(rest.slice(1)) };
  }

  const colonCount = (value.match(/:/g) ?? []).length;

  // More than one colon means a bare IPv6 literal, which has no room for a port.
  if (colonCount > 1) {
    return { hostname: value };
  }

  if (colonCount === 1) {
    const [hostname, portPart] = value.split(':');
    return { hostname, port: toPort(portPart) };
  }

  return { hostname: value };
}

function toPort(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid port: "${value}".`);
  }
  return parseInt(value, 10);
}
