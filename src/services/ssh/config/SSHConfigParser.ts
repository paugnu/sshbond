import { SSHHost, PortForwardRule, DynamicForwardRule } from '@/domain/models/sshConfig';

export interface ParsedSSHBlock {
  patterns: string[]; // e.g. ['prod', '*.prod', '!test.prod']
  directives: Record<string, string | string[]>;
  customDirectives: Record<string, string>;
  rawComments: string[];
}

export interface ParseConfigResult {
  blocks: ParsedSSHBlock[];
  hosts: SSHHost[];
  globalBlock?: ParsedSSHBlock;
}

export class SSHConfigParser {
  /**
   * Parse raw OpenSSH config text into structured blocks and SSHHost entities.
   */
  public static parse(content: string): ParseConfigResult {
    const lines = content.split(/\r?\n/);
    const blocks: ParsedSSHBlock[] = [];
    
    let currentBlock: ParsedSSHBlock | null = null;
    let pendingComments: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Empty line
      if (!line) {
        continue;
      }

      // Comment
      if (line.startsWith('#')) {
        pendingComments.push(line.slice(1).trim());
        continue;
      }

      // Tokenize line respecting quotes and = delimiters
      const tokens = this.tokenizeLine(line);
      if (tokens.length === 0) continue;

      const directive = tokens[0].toLowerCase();
      const value = tokens.slice(1).join(' ').trim();

      if (directive === 'host') {
        const patterns = tokens.slice(1);
        currentBlock = {
          patterns,
          directives: {},
          customDirectives: {},
          rawComments: [...pendingComments],
        };
        blocks.push(currentBlock);
        pendingComments = [];
        continue;
      }

      if (directive === 'match') {
        // Match block support (e.g. Match host *.example.com)
        const patterns = tokens.slice(1);
        currentBlock = {
          patterns: [`match:${patterns.join(' ')}`],
          directives: {},
          customDirectives: {},
          rawComments: [...pendingComments],
        };
        blocks.push(currentBlock);
        pendingComments = [];
        continue;
      }

      // If no host block declared yet, it's a global block
      if (!currentBlock) {
        currentBlock = {
          patterns: ['*'],
          directives: {},
          customDirectives: {},
          rawComments: [...pendingComments],
        };
        blocks.push(currentBlock);
        pendingComments = [];
      }

      // Multi-value directives (e.g. LocalForward, RemoteForward, DynamicForward, SendEnv)
      if (['localforward', 'remoteforward', 'dynamicforward', 'sendenv'].includes(directive)) {
        const existing = currentBlock.directives[directive];
        if (Array.isArray(existing)) {
          existing.push(value);
        } else if (existing) {
          currentBlock.directives[directive] = [existing as string, value];
        } else {
          currentBlock.directives[directive] = [value];
        }
      } else {
        currentBlock.directives[directive] = value;
      }
    }

    // Convert individual host blocks into SSHHost models
    const hosts = this.convertBlocksToHosts(blocks);
    const globalBlock = blocks.find(b => b.patterns.length === 1 && b.patterns[0] === '*');

    return { blocks, hosts, globalBlock };
  }

  /**
   * Tokenizes a line into directive and arguments, respecting quotes and `=` separator.
   */
  private static tokenizeLine(line: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';

    // Replace first '=' with a space if not in quotes
    let normalized = '';
    let foundEquals = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' || ch === "'") {
        if (!inQuotes) {
          inQuotes = true;
          quoteChar = ch;
        } else if (quoteChar === ch) {
          inQuotes = false;
        }
        normalized += ch;
      } else if (ch === '=' && !inQuotes && !foundEquals) {
        normalized += ' ';
        foundEquals = true;
      } else {
        normalized += ch;
      }
    }

    inQuotes = false;
    quoteChar = '';

    for (let i = 0; i < normalized.length; i++) {
      const ch = normalized[i];

      if ((ch === '"' || ch === "'")) {
        if (!inQuotes) {
          inQuotes = true;
          quoteChar = ch;
        } else if (quoteChar === ch) {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else if ((ch === ' ' || ch === '\t') && !inQuotes) {
        if (current.length > 0) {
          tokens.push(current);
          current = '';
        }
      } else {
        current += ch;
      }
    }

    if (current.length > 0) {
      tokens.push(current);
    }

    return tokens;
  }

  private static convertBlocksToHosts(blocks: ParsedSSHBlock[]): SSHHost[] {
    const hosts: SSHHost[] = [];
    const now = new Date().toISOString();

    for (const block of blocks) {
      for (const pattern of block.patterns) {
        // `Match` blocks and negated patterns (`!staging`) describe which
        // hosts a block does *not* apply to; neither names a connectable host.
        if (pattern.startsWith('match:') || pattern.startsWith('!')) continue;

        const d = block.directives;
        const customDirectives: Record<string, string> = {};

        const knownDirectives = new Set([
          'host', 'hostname', 'user', 'port', 'identityfile', 'identitiesonly',
          'proxyjump', 'proxycommand', 'serveraliveinterval', 'serveralivecountmax',
          'connecttimeout', 'compression', 'forwardagent', 'requesttty',
          'remotecommand', 'localforward', 'remoteforward', 'dynamicforward',
          'tcpkeepalive', 'stricthostkeychecking', 'userknownhostsfile'
        ]);

        for (const [key, val] of Object.entries(d)) {
          if (!knownDirectives.has(key)) {
            customDirectives[key] = Array.isArray(val) ? val.join(' ') : val;
          }
        }

        const localForwards = this.parsePortForwards(d['localforward']);
        const remoteForwards = this.parsePortForwards(d['remoteforward']);
        const dynamicForwards = this.parseDynamicForwards(d['dynamicforward']);

        const host: SSHHost = {
          id: `host_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          alias: pattern,
          hostname: (d['hostname'] as string) || (pattern !== '*' && !pattern.includes('*') ? pattern : ''),
          port: d['port'] ? parseInt(d['port'] as string, 10) : 22,
          username: (d['user'] as string) || '',
          tags: [],
          favorite: false,
          identityFile: d['identityfile'] as string | undefined,
          authenticationType: d['identityfile'] || String(d['preferredauthentications'] || '').split(',')[0] === 'publickey' ? 'key' : 'password',
          proxyJump: d['proxyjump'] as string,
          proxyCommand: d['proxycommand'] as string,
          serverAliveInterval: d['serveraliveinterval'] ? parseInt(d['serveraliveinterval'] as string, 10) : undefined,
          serverAliveCountMax: d['serveralivecountmax'] ? parseInt(d['serveralivecountmax'] as string, 10) : undefined,
          connectTimeout: d['connecttimeout'] ? parseInt(d['connecttimeout'] as string, 10) : undefined,
          compression: d['compression'] ? (d['compression'] as string).toLowerCase() === 'yes' : undefined,
          forwardAgent: d['forwardagent'] ? (d['forwardagent'] as string).toLowerCase() === 'yes' : undefined,
          requestTTY: d['requesttty'] as any,
          remoteCommand: d['remotecommand'] as string,
          tcpKeepAlive: d['tcpkeepalive'] ? (d['tcpkeepalive'] as string).toLowerCase() === 'yes' : undefined,
          strictHostKeyChecking: d['stricthostkeychecking'] as any,
          userKnownHostsFile: d['userknownhostsfile'] as string,
          localForwards: localForwards.length > 0 ? localForwards : undefined,
          remoteForwards: remoteForwards.length > 0 ? remoteForwards : undefined,
          dynamicForwards: dynamicForwards.length > 0 ? dynamicForwards : undefined,
          customDirectives: Object.keys(customDirectives).length > 0 ? customDirectives : undefined,
          createdAt: now,
          updatedAt: now,
        };

        hosts.push(host);
      }
    }

    return hosts;
  }

  /**
   * Parses a `LocalForward` / `RemoteForward` value.
   *
   * OpenSSH accepts two spellings and SSHBond has to read both, since a config
   * written by hand is as likely to use one as the other:
   *
   *   [bind_address:]port host:hostport
   *   [bind_address:]port:host:hostport
   *
   * IPv6 literals are bracketed, as OpenSSH requires -- the colon form is
   * otherwise ambiguous. A rule that cannot be understood is dropped rather
   * than guessed at: forwarding a port to the wrong host is worse than not
   * forwarding it.
   */
  public static parsePortForwards(raw: string | string[] | undefined): PortForwardRule[] {
    if (!raw) return [];
    const entries = Array.isArray(raw) ? raw : [raw];
    const rules: PortForwardRule[] = [];

    for (const entry of entries) {
      const tokens = entry.trim().split(/\s+/).filter(Boolean);

      const rule =
        tokens.length === 2
          ? this.buildForwardRule(tokens[0], tokens[1])
          : tokens.length === 1
            ? this.parseColonForwardForm(tokens[0])
            : undefined;

      if (rule) rules.push(rule);
    }

    return rules;
  }

  /** `[bind_address:]port:host:hostport`, read from the right. */
  private static parseColonForwardForm(value: string): PortForwardRule | undefined {
    const lastColon = value.lastIndexOf(':');
    if (lastColon < 0) return undefined;

    const targetPort = value.slice(lastColon + 1);
    const rest = value.slice(0, lastColon);

    // The target host may itself be a bracketed IPv6 literal, in which case the
    // bind spec is whatever precedes the bracket.
    if (rest.endsWith(']')) {
      const opening = rest.lastIndexOf('[');
      if (opening < 0) return undefined;
      const host = rest.slice(opening, rest.length);
      const bind = rest.slice(0, opening).replace(/:$/, '');
      return this.buildForwardRule(bind, `${host}:${targetPort}`);
    }

    const hostColon = rest.lastIndexOf(':');
    if (hostColon < 0) return undefined;

    return this.buildForwardRule(rest.slice(0, hostColon), `${rest.slice(hostColon + 1)}:${targetPort}`);
  }

  private static buildForwardRule(bind: string, target: string): PortForwardRule | undefined {
    const bindSpec = this.parseBindSpec(bind);
    const targetSpec = this.parseHostPort(target);
    if (!bindSpec || !targetSpec) return undefined;

    return {
      bindAddress: bindSpec.bindAddress,
      bindPort: bindSpec.bindPort,
      targetHost: targetSpec.host,
      targetPort: targetSpec.port,
    };
  }

  /** `port`, `bind_address:port`, or `[::1]:port`. */
  private static parseBindSpec(
    value: string
  ): { bindAddress?: string; bindPort: number } | undefined {
    const trimmed = value.trim();
    if (!trimmed) return undefined;

    if (/^\d+$/.test(trimmed)) {
      return { bindPort: parseInt(trimmed, 10) };
    }

    const spec = this.parseHostPort(trimmed);
    return spec ? { bindAddress: spec.host, bindPort: spec.port } : undefined;
  }

  /** `host:port` or `[ipv6]:port`. */
  private static parseHostPort(value: string): { host: string; port: number } | undefined {
    const trimmed = value.trim();

    if (trimmed.startsWith('[')) {
      const closing = trimmed.indexOf(']');
      if (closing < 0 || trimmed[closing + 1] !== ':') return undefined;
      const port = this.toPort(trimmed.slice(closing + 2));
      const host = trimmed.slice(1, closing);
      return port !== undefined && host ? { host, port } : undefined;
    }

    const colon = trimmed.lastIndexOf(':');
    if (colon < 1) return undefined;

    const host = trimmed.slice(0, colon);
    const port = this.toPort(trimmed.slice(colon + 1));

    // A bare IPv6 literal has no room for a port; it must be bracketed.
    if (host.includes(':') || port === undefined) return undefined;

    return { host, port };
  }

  private static toPort(value: string): number | undefined {
    if (!/^\d+$/.test(value)) return undefined;
    const port = parseInt(value, 10);
    return port >= 0 && port <= 65535 ? port : undefined;
  }

  /**
   * Parses a `DynamicForward` value: `[bind_address:]port`, with IPv6 literals
   * bracketed.
   */
  public static parseDynamicForwards(raw: string | string[] | undefined): DynamicForwardRule[] {
    if (!raw) return [];
    const entries = Array.isArray(raw) ? raw : [raw];
    const rules: DynamicForwardRule[] = [];

    for (const entry of entries) {
      const spec = this.parseBindSpec(entry);
      if (spec) {
        rules.push({ bindAddress: spec.bindAddress, port: spec.bindPort });
      }
    }

    return rules;
  }
}
