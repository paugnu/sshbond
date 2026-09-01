import {
  ResolvedSSHConfig,
  SSHHost,
  PortForwardRule,
  DynamicForwardRule,
  SSHAuthType,
} from '@/domain/models/sshConfig';
import { SSHConfigParser, ParsedSSHBlock } from './SSHConfigParser';

/** Defaults OpenSSH applies when a directive appears nowhere. */
const DEFAULTS = {
  port: 22,
  serverAliveInterval: 0,
  serverAliveCountMax: 3,
  connectTimeout: 30,
  compression: false,
  forwardAgent: false,
  requestTTY: 'auto' as const,
  tcpKeepAlive: true,
  strictHostKeyChecking: 'ask' as const,
};

export class SSHConfigResolver {
  /**
   * Matches a host string against an OpenSSH pattern (`*.prod`, `web-?`, ...).
   */
  public static matchesPattern(host: string, pattern: string): boolean {
    if (pattern === '*') return true;
    if (pattern === host) return true;

    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');

    return new RegExp(`^${escaped}$`, 'i').test(host);
  }

  /**
   * Evaluates a `Host` line's pattern list. A negated pattern that matches
   * disqualifies the whole block, regardless of the other patterns.
   */
  public static matchesHostPatterns(host: string, patterns: string[]): boolean {
    let matched = false;

    for (const pattern of patterns) {
      if (pattern.startsWith('!')) {
        if (this.matchesPattern(host, pattern.slice(1))) return false;
      } else if (this.matchesPattern(host, pattern)) {
        matched = true;
      }
    }

    return matched;
  }

  /**
   * Resolves a target alias against parsed config blocks using OpenSSH's
   * first-match-wins rule: the first value obtained for a directive is used,
   * and later blocks can only supply directives not yet set.
   */
  public static resolve(targetAlias: string, blocks: ParsedSSHBlock[]): ResolvedSSHConfig {
    const directives: Record<string, string> = {};
    const localForwards: PortForwardRule[] = [];
    const remoteForwards: PortForwardRule[] = [];
    const dynamicForwards: DynamicForwardRule[] = [];
    const customDirectives: Record<string, string> = {};

    for (const block of blocks) {
      if (!this.matchesHostPatterns(targetAlias, block.patterns)) continue;

      for (const [key, value] of Object.entries(block.directives)) {
        const lowerKey = key.toLowerCase();

        // Forwarding directives accumulate across matching blocks rather than
        // being shadowed by the first one.
        if (lowerKey === 'localforward') {
          localForwards.push(...SSHConfigParser.parsePortForwards(value));
        } else if (lowerKey === 'remoteforward') {
          remoteForwards.push(...SSHConfigParser.parsePortForwards(value));
        } else if (lowerKey === 'dynamicforward') {
          dynamicForwards.push(...SSHConfigParser.parseDynamicForwards(value));
        } else if (directives[lowerKey] === undefined) {
          directives[lowerKey] = Array.isArray(value) ? value[0] : value;
        }
      }

      for (const [key, value] of Object.entries(block.customDirectives)) {
        if (customDirectives[key] === undefined) {
          customDirectives[key] = value;
        }
      }
    }

    const identityFile = directives['identityfile'];

    return {
      alias: targetAlias,
      hostname: directives['hostname'] || targetAlias,
      port: parseIntOr(directives['port'], DEFAULTS.port),
      username: directives['user'] || '',
      identityFile,
      authenticationType: identityFile ? 'key' : 'password',
      proxyJump: directives['proxyjump'],
      proxyCommand: directives['proxycommand'],
      serverAliveInterval: parseIntOr(directives['serveraliveinterval'], DEFAULTS.serverAliveInterval),
      serverAliveCountMax: parseIntOr(directives['serveralivecountmax'], DEFAULTS.serverAliveCountMax),
      connectTimeout: parseIntOr(directives['connecttimeout'], DEFAULTS.connectTimeout),
      compression: parseBoolOr(directives['compression'], DEFAULTS.compression),
      forwardAgent: parseBoolOr(directives['forwardagent'], DEFAULTS.forwardAgent),
      requestTTY: parseRequestTTY(directives['requesttty']),
      remoteCommand: directives['remotecommand'],
      tcpKeepAlive: parseBoolOr(directives['tcpkeepalive'], DEFAULTS.tcpKeepAlive),
      strictHostKeyChecking: parseStrictHostKeyChecking(directives['stricthostkeychecking']),
      localForwards,
      remoteForwards,
      dynamicForwards,
      customDirectives,
    };
  }

  /**
   * Resolves a saved host, inheriting from the user's wildcard entries.
   *
   * Saved hosts have no file ordering, so precedence is defined as: the target
   * host itself wins every directive it sets, then wildcard entries (`*`,
   * `*.prod`, ...) fill the gaps, most specific first. This gives a `Host *`
   * entry the "global defaults" role users expect from `~/.ssh/config`, which
   * previously had no effect at all on saved hosts.
   */
  public static resolveFromHostModels(
    targetHost: SSHHost,
    allHosts: SSHHost[] = [],
    rawConfig?: string
  ): ResolvedSSHConfig {
    if (rawConfig) {
      return this.resolve(targetHost.alias, SSHConfigParser.parse(rawConfig).blocks);
    }

    const inherited = allHosts
      .filter(h => h.id !== targetHost.id && isPattern(h.alias))
      .filter(h => this.matchesHostPatterns(targetHost.alias, [h.alias]))
      .sort((a, b) => specificity(b.alias) - specificity(a.alias));

    const chain = [targetHost, ...inherited];

    const firstDefined = <K extends keyof SSHHost>(key: K): SSHHost[K] | undefined => {
      for (const host of chain) {
        const value = host[key];
        if (value !== undefined && value !== null && value !== '') return value;
      }
      return undefined;
    };

    const identityId = firstDefined('identityId');
    const authenticationType =
      (firstDefined('authenticationType') as SSHAuthType | undefined) ??
      (identityId ? 'key' : 'password');

    return {
      alias: targetHost.alias,
      hostname: targetHost.hostname || targetHost.alias,
      port: firstDefined('port') ?? DEFAULTS.port,
      username: firstDefined('username') ?? '',
      identityId: authenticationType === 'key' ? identityId : undefined,
      authenticationType,
      proxyJump: firstDefined('proxyJump'),
      proxyCommand: firstDefined('proxyCommand'),
      serverAliveInterval: firstDefined('serverAliveInterval') ?? DEFAULTS.serverAliveInterval,
      serverAliveCountMax: firstDefined('serverAliveCountMax') ?? DEFAULTS.serverAliveCountMax,
      connectTimeout: firstDefined('connectTimeout') ?? DEFAULTS.connectTimeout,
      compression: firstDefined('compression') ?? DEFAULTS.compression,
      forwardAgent: firstDefined('forwardAgent') ?? DEFAULTS.forwardAgent,
      requestTTY: firstDefined('requestTTY') ?? DEFAULTS.requestTTY,
      remoteCommand: firstDefined('remoteCommand'),
      tcpKeepAlive: firstDefined('tcpKeepAlive') ?? DEFAULTS.tcpKeepAlive,
      strictHostKeyChecking: firstDefined('strictHostKeyChecking') ?? DEFAULTS.strictHostKeyChecking,
      // Forwarding rules accumulate, matching OpenSSH.
      localForwards: chain.flatMap(h => h.localForwards ?? []),
      remoteForwards: chain.flatMap(h => h.remoteForwards ?? []),
      dynamicForwards: chain.flatMap(h => h.dynamicForwards ?? []),
      customDirectives: Object.assign({}, ...[...chain].reverse().map(h => h.customDirectives ?? {})),
    };
  }
}

function isPattern(alias: string): boolean {
  return alias.includes('*') || alias.includes('?');
}

/** Fewer wildcards means a more specific pattern. */
function specificity(alias: string): number {
  return alias.replace(/[^*?]/g, '').length === 0 ? Number.MAX_SAFE_INTEGER : alias.length - (alias.match(/[*?]/g)?.length ?? 0);
}

function parseIntOr(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolOr(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.toLowerCase() === 'yes';
}

function parseRequestTTY(value: string | undefined): ResolvedSSHConfig['requestTTY'] {
  const normalised = value?.toLowerCase();
  return normalised === 'yes' || normalised === 'no' || normalised === 'force' || normalised === 'auto'
    ? normalised
    : DEFAULTS.requestTTY;
}

function parseStrictHostKeyChecking(
  value: string | undefined
): ResolvedSSHConfig['strictHostKeyChecking'] {
  const normalised = value?.toLowerCase();
  return normalised === 'yes' ||
    normalised === 'no' ||
    normalised === 'accept-new' ||
    normalised === 'ask'
    ? normalised
    : DEFAULTS.strictHostKeyChecking;
}
