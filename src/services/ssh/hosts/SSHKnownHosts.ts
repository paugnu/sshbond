import { KnownHost } from '@/domain/models/sshConfig';
import { HostStorageService } from '../../persistence/HostStorageService';

export type HostKeyVerificationStatus = 'trusted' | 'unknown' | 'mismatch';

export type StrictHostKeyChecking = 'yes' | 'no' | 'accept-new' | 'ask';

export interface HostKeyPresentation {
  hostname: string;
  port: number;
  algorithm: string;
  fingerprint: string;
  publicKey: string;
}

export interface HostKeyVerificationResult extends HostKeyPresentation {
  status: HostKeyVerificationStatus;
  storedFingerprint?: string;
  existingKnownHost?: KnownHost;
}

/** What the StrictHostKeyChecking policy dictates for a verification result. */
export type HostKeyDecision =
  | { action: 'accept'; trust: boolean }
  | { action: 'ask' }
  | { action: 'reject'; reason: string };

export class SSHKnownHosts {
  /**
   * Verifies an incoming host key against the known_hosts database.
   *
   * Keys are matched on host, port *and* algorithm: a server legitimately
   * offers several host keys, so an Ed25519 key arriving where only an RSA key
   * was recorded is a new key, not evidence of an attack.
   */
  public static async verifyHostKey(
    hostname: string,
    port: number,
    algorithm: string,
    fingerprint: string,
    publicKey: string
  ): Promise<HostKeyVerificationResult> {
    const knownHosts = await HostStorageService.getKnownHosts();
    const normalisedHost = hostname.toLowerCase();

    const existing = knownHosts.find(
      k => k.hostname.toLowerCase() === normalisedHost && k.port === port && k.algorithm === algorithm
    );

    const base: HostKeyPresentation = { hostname, port, algorithm, fingerprint, publicKey };

    if (!existing) {
      return { ...base, status: 'unknown' };
    }

    if (existing.fingerprint === fingerprint) {
      return { ...base, status: 'trusted', storedFingerprint: existing.fingerprint, existingKnownHost: existing };
    }

    return { ...base, status: 'mismatch', storedFingerprint: existing.fingerprint, existingKnownHost: existing };
  }

  /**
   * Applies OpenSSH's StrictHostKeyChecking semantics to a verification result.
   *
   * A mismatch is never auto-accepted, not even under `no`: that is the exact
   * signature of a man-in-the-middle, and silently continuing would hand the
   * user's credentials to whoever is impersonating the server.
   */
  public static decide(
    result: HostKeyVerificationResult,
    policy: StrictHostKeyChecking
  ): HostKeyDecision {
    if (result.status === 'trusted') {
      return { action: 'accept', trust: false };
    }

    if (result.status === 'mismatch') {
      if (policy === 'ask') return { action: 'ask' };
      return {
        action: 'reject',
        reason:
          `REMOTE HOST IDENTIFICATION HAS CHANGED for ${result.hostname}:${result.port}. ` +
          `Expected ${result.storedFingerprint}, got ${result.fingerprint}. ` +
          `Someone could be eavesdropping on you right now (man-in-the-middle attack).`,
      };
    }

    // status === 'unknown'
    switch (policy) {
      case 'no':
      case 'accept-new':
        return { action: 'accept', trust: true };
      case 'yes':
        return {
          action: 'reject',
          reason:
            `Host key for ${result.hostname}:${result.port} is not in known hosts and ` +
            `StrictHostKeyChecking is set to "yes".`,
        };
      case 'ask':
      default:
        return { action: 'ask' };
    }
  }

  /** Saves a trusted host key into known_hosts. */
  public static async trustHost(
    hostname: string,
    port: number,
    algorithm: string,
    fingerprint: string,
    publicKey: string
  ): Promise<KnownHost> {
    const knownHost: KnownHost = {
      id: `kh_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      hostname: hostname.toLowerCase(),
      port,
      algorithm,
      fingerprint,
      publicKey,
      trustedAt: new Date().toISOString(),
    };

    await HostStorageService.saveKnownHost(knownHost);
    return knownHost;
  }
}
