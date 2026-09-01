import {
  ResolvedSSHConfig,
  SSHAuthType,
  SSHHost,
} from '@/domain/models/sshConfig';
import { parseDestination, ParsedDestination } from '@/utils/connectionString';
import { SSHConfigResolver } from './config/SSHConfigResolver';
import { HostStorageService } from '../persistence/HostStorageService';

/**
 * One machine to log into on the way to the target, in the order it is
 * traversed.
 *
 * Deliberately narrower than `ResolvedSSHConfig`: a hop is only ever a place to
 * authenticate to and open a channel through, so it carries no terminal,
 * forwarding or command settings that could be mistaken for the target's.
 */
export interface ProxyJumpHop {
  /** Exactly as written in the ProxyJump directive, for error messages. */
  spec: string;
  alias: string;
  hostname: string;
  port: number;
  username: string;
  authenticationType: SSHAuthType;
  identityId?: string;
  strictHostKeyChecking: ResolvedSSHConfig['strictHostKeyChecking'];
  proxyJump?: string;
}

/** Enough of a config to authenticate with; both hops and targets satisfy it. */
export type CredentialTarget = Pick<
  ResolvedSSHConfig,
  'alias' | 'hostname' | 'username' | 'authenticationType' | 'identityId'
>;

const DEFAULT_PORT = 22;

/**
 * A chain longer than this is a configuration mistake rather than an intent.
 * The cycle check below catches loops; this catches the rest.
 */
const MAX_HOPS = 10;

/**
 * Turns a `ProxyJump` directive into the hops it names.
 *
 * An alias is looked up among the saved hosts and resolved like any other
 * host -- wildcards included -- so `ProxyJump gateway` means the same thing it
 * would mean to `ssh`. A hop may itself sit behind another jump host, and those
 * are expanded first, since they have to be traversed first.
 */
export class SSHProxyJump {
  /**
   * Splits a directive value into destinations. `none` disables the directive,
   * as in OpenSSH, and is the one value that must never be read as a hostname.
   */
  public static parseChain(value: string | undefined): ParsedDestination[] {
    const trimmed = value?.trim();
    if (!trimmed || trimmed.toLowerCase() === 'none') return [];

    return trimmed
      .split(',')
      .map(entry => entry.trim())
      .filter(Boolean)
      .map(entry => parseDestination(entry));
  }

  /** The full chain for a target, in connection order. Empty when direct. */
  public static async resolveChain(config: ResolvedSSHConfig): Promise<ProxyJumpHop[]> {
    const specs = this.parseChain(config.proxyJump);
    if (specs.length === 0) return [];

    const savedHosts = await HostStorageService.getHosts();
    const hops: ProxyJumpHop[] = [];

    // The target itself closes the loop: a bastion reached through the host it
    // is meant to protect would connect to nothing.
    const seen = new Set<string>([addressKey(config.hostname, config.port)]);

    this.expand(specs, config, savedHosts, seen, hops);
    return hops;
  }

  private static expand(
    specs: ParsedDestination[],
    target: ResolvedSSHConfig,
    savedHosts: SSHHost[],
    seen: Set<string>,
    out: ProxyJumpHop[]
  ): void {
    for (const spec of specs) {
      const hop = this.resolveHop(spec, target, savedHosts);
      const key = addressKey(hop.hostname, hop.port);

      if (seen.has(key)) {
        throw new Error(
          `ProxyJump chain loops back to ${hop.hostname}:${hop.port}; it would never reach the target.`
        );
      }
      if (out.length >= MAX_HOPS) {
        throw new Error(`ProxyJump chain is longer than ${MAX_HOPS} hops.`);
      }

      seen.add(key);

      // A jump host may itself be reachable only through another one.
      this.expand(this.parseChain(hop.proxyJump), target, savedHosts, seen, out);
      out.push(hop);
    }
  }

  private static resolveHop(
    spec: ParsedDestination,
    target: ResolvedSSHConfig,
    savedHosts: SSHHost[]
  ): ProxyJumpHop {
    const saved = savedHosts.find(host => host.alias === spec.hostname);
    const resolved = saved ? SSHConfigResolver.resolveFromHostModels(saved, savedHosts) : undefined;

    // What the directive states wins over the saved host, as in OpenSSH.
    const hostname = resolved?.hostname || spec.hostname;
    const port = spec.port ?? resolved?.port ?? DEFAULT_PORT;
    const username = spec.username ?? resolved?.username ?? '';

    if (!username) {
      throw new Error(
        `ProxyJump host "${spec.hostname}" has no username. Write it as user@${spec.hostname} or save it as a host.`
      );
    }

    // An unsaved jump host has no settings of its own. Borrowing the target's
    // key is what makes `ProxyJump user@bastion` work at all, and is far more
    // predictable than silently attempting no authentication.
    const authenticationType = resolved?.authenticationType ?? target.authenticationType;
    const identityId = resolved ? resolved.identityId : target.identityId;

    return {
      spec: formatSpec(spec),
      alias: saved?.alias ?? spec.hostname,
      hostname,
      port,
      username,
      authenticationType,
      identityId: authenticationType === 'key' ? identityId : undefined,
      strictHostKeyChecking: resolved?.strictHostKeyChecking ?? target.strictHostKeyChecking,
      proxyJump: resolved?.proxyJump,
    };
  }
}

/** Identifies a machine for loop detection, matching the known-hosts key. */
export function addressKey(hostname: string, port: number): string {
  return `${hostname.toLowerCase()}:${port}`;
}

function formatSpec(spec: ParsedDestination): string {
  const user = spec.username ? `${spec.username}@` : '';
  const port = spec.port !== undefined ? `:${spec.port}` : '';
  return `${user}${spec.hostname}${port}`;
}
