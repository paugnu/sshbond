import { ResolvedSSHConfig, ConnectionHistoryEntry } from '@/domain/models/sshConfig';
import { SSHConnection, ISSHConnection } from './SSHConnection';
import { SSHKnownHosts, HostKeyVerificationResult } from './hosts/SSHKnownHosts';
import { HostStorageService } from '../persistence/HostStorageService';
import { SecureStorageService } from '../secureStorage/SecureStorageService';
import {
  NativeSSHBridge,
  SSHCredential,
  NativeJumpHost,
  PresentedHostKey,
} from './native/NativeSSHBridge';
import { SSHTunnelManager } from './SSHTunnelManager';
import { SSHProxyJump, ProxyJumpHop, CredentialTarget, addressKey } from './SSHProxyJump';

export interface HostKeyChallenge {
  hostname: string;
  port: number;
  algorithm: string;
  fingerprint: string;
  /** True when a *different* key was previously trusted for this host. */
  isMismatch: boolean;
  storedFingerprint?: string;
}

export interface ConnectOptions {
  /** Resolve `true` to continue. An absent handler means "refuse". */
  onHostKeyChallenge?: (challenge: HostKeyChallenge) => Promise<boolean>;
  onPasswordRequired?: (prompt: string) => Promise<string | null>;
  onPassphraseRequired?: (keyName: string) => Promise<string | null>;
  /** Recorded in connection history so it can be attributed to a saved host. */
  hostId?: string;
}

export class SSHClient {
  /**
   * Establishes an SSH connection for an already-resolved configuration.
   *
   * The host key is verified *before* any credential reaches the wire; a
   * rejected or unverifiable key aborts the connection.
   */
  public static async connect(
    config: ResolvedSSHConfig,
    options: ConnectOptions = {}
  ): Promise<ISSHConnection> {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const connection = new SSHConnection(sessionId, config);
    const startTime = Date.now();

    let reachedConnected = false;
    connection.onStatusChange(status => {
      if (status === 'connected') reachedConnected = true;
    });

    // Registered before the engine is asked for anything: the forwarding rules
    // travel with the connect request itself.
    SSHTunnelManager.registerForConnection(connection);

    try {
      // Jump hosts first, in the order they are traversed: their credentials
      // are needed before the target's, and prompting for the target's
      // password before the bastion has even been reached is misleading.
      const { hops, jumps } = await this.resolveJumpHosts(config, options);
      const credential = await this.resolveCredential(config, options);

      await NativeSSHBridge.connect({
        sessionId,
        config,
        credential,
        connection,
        jumps,
        forwards: SSHTunnelManager.getForwardSpecs(sessionId),
        onTunnelStatus: event =>
          SSHTunnelManager.applyStatus(sessionId, {
            tunnelId: event.tunnelId,
            status: event.status,
            boundPort: event.boundPort,
            message: event.message,
          }),
        verifyHostKey: presented =>
          this.verifyHostKey(presented, options, this.policyFor(presented, config, hops)),
      });

      // Only a session that actually came up counts as a successful
      // connection; a socket that closed during the handshake is a failure.
      connection.onClose(() => {
        void this.recordHistory(config, options.hostId, startTime, {
          status: reachedConnected ? 'success' : 'failed',
          errorMessage: reachedConnected
            ? undefined
            : 'Connection closed before the session was established.',
        });
      });

      return connection;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Connection failed.';
      await this.recordHistory(config, options.hostId, startTime, {
        status: 'failed',
        errorMessage: message,
      });
      connection.emitClose(1);
      throw err;
    }
  }

  /**
   * Decides whether a presented host key may be used, honouring
   * StrictHostKeyChecking and prompting through the UI when the policy says
   * "ask". Trust-on-first-use keys are persisted only once accepted.
   *
   * The key is checked against the machine it actually belongs to, which for a
   * ProxyJump chain is each jump host in turn and only then the target. A
   * bastion's key checked against the target's known-hosts entry would be a
   * mismatch on every connection, and worse, the target's key checked against
   * the bastion's would wave a real one through.
   */
  private static async verifyHostKey(
    presented: PresentedHostKey,
    options: ConnectOptions,
    policy: ResolvedSSHConfig['strictHostKeyChecking']
  ): Promise<boolean> {
    const result: HostKeyVerificationResult = await SSHKnownHosts.verifyHostKey(
      presented.hostname,
      presented.port,
      presented.algorithm,
      presented.fingerprint,
      presented.publicKey
    );

    const decision = SSHKnownHosts.decide(result, policy);

    if (decision.action === 'reject') {
      throw new Error(decision.reason);
    }

    if (decision.action === 'accept') {
      if (decision.trust) {
        await SSHKnownHosts.trustHost(
          presented.hostname,
          presented.port,
          presented.algorithm,
          presented.fingerprint,
          presented.publicKey
        );
      }
      return true;
    }

    // decision.action === 'ask'
    if (!options.onHostKeyChallenge) {
      throw new Error(
        `Host key for ${presented.hostname}:${presented.port} could not be verified and there is no way to ask for confirmation.`
      );
    }

    const accepted = await options.onHostKeyChallenge({
      hostname: presented.hostname,
      port: presented.port,
      algorithm: presented.algorithm,
      fingerprint: presented.fingerprint,
      isMismatch: result.status === 'mismatch',
      storedFingerprint: result.storedFingerprint,
    });

    if (!accepted) {
      // Names the machine: in a ProxyJump chain, which host was refused is the
      // whole content of the message.
      throw new Error(
        `Host key verification failed for ${presented.hostname}:${presented.port}: rejected by the user.`
      );
    }

    await SSHKnownHosts.trustHost(
      presented.hostname,
      presented.port,
      presented.algorithm,
      presented.fingerprint,
      presented.publicKey
    );

    return true;
  }

  /**
   * Resolves the ProxyJump chain and reads each hop's credential.
   *
   * The hops are returned alongside the native payload because their host key
   * policies are needed later, when the engine presents each one's key.
   */
  private static async resolveJumpHosts(
    config: ResolvedSSHConfig,
    options: ConnectOptions
  ): Promise<{ hops: ProxyJumpHop[]; jumps: NativeJumpHost[] }> {
    const hops = await SSHProxyJump.resolveChain(config);
    const jumps: NativeJumpHost[] = [];

    for (const hop of hops) {
      jumps.push({
        hostname: hop.hostname,
        port: hop.port,
        username: hop.username,
        authType: hop.authenticationType,
        credential: await this.resolveCredential(hop, options),
      });
    }

    return { hops, jumps };
  }

  /** A jump host answers for its own StrictHostKeyChecking, not the target's. */
  private static policyFor(
    presented: PresentedHostKey,
    config: ResolvedSSHConfig,
    hops: ProxyJumpHop[]
  ): ResolvedSSHConfig['strictHostKeyChecking'] {
    const key = addressKey(presented.hostname, presented.port);
    const hop = hops.find(candidate => addressKey(candidate.hostname, candidate.port) === key);
    return hop?.strictHostKeyChecking ?? config.strictHostKeyChecking;
  }

  /**
   * Reads the credential this connection needs out of the keystore, prompting
   * the user only when the keystore cannot supply it.
   */
  private static async resolveCredential(
    config: CredentialTarget,
    options: ConnectOptions
  ): Promise<SSHCredential> {
    if (config.authenticationType === 'key') {
      if (!config.identityId) {
        throw new Error(
          'This host is configured for key authentication but no identity is selected.'
        );
      }

      const identity = await HostStorageService.getIdentityById(config.identityId);
      if (!identity) {
        throw new Error('The SSH key configured for this host no longer exists.');
      }

      const privateKey = await SecureStorageService.getSecret(
        identity.privateKeySecureReference,
        `Unlock "${identity.name}" to connect to ${config.hostname}`
      );

      if (!privateKey) {
        throw new Error(`Could not read "${identity.name}" from secure storage.`);
      }

      if (identity.hasPassphrase) {
        if (!options.onPassphraseRequired) {
          throw new Error(
            `"${identity.name}" is passphrase-protected and there is no way to ask for it.`
          );
        }
        const passphrase = await options.onPassphraseRequired(identity.name);
        if (passphrase === null) {
          throw new Error('Passphrase entry cancelled.');
        }
        return { kind: 'key', privateKey, passphrase };
      }

      return { kind: 'key', privateKey };
    }

    if (config.authenticationType === 'password') {
      const stored = await SecureStorageService.getSecret(`host_pwd_${config.alias}`);
      if (stored) return { kind: 'password', password: stored };

      if (options.onPasswordRequired) {
        const entered = await options.onPasswordRequired(
          `Password for ${config.username}@${config.hostname}`
        );
        if (entered === null) {
          throw new Error('Password entry cancelled.');
        }
        return { kind: 'password', password: entered };
      }

      throw new Error('A password is required but no way to ask for one was provided.');
    }

    return { kind: 'none' };
  }

  private static async recordHistory(
    config: ResolvedSSHConfig,
    hostId: string | undefined,
    startTime: number,
    outcome: { status: ConnectionHistoryEntry['status']; errorMessage?: string }
  ): Promise<void> {
    const entry: ConnectionHistoryEntry = {
      id: `hist_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      hostId,
      hostAlias: config.alias,
      hostname: config.hostname,
      port: config.port,
      username: config.username,
      timestamp: new Date().toISOString(),
      durationSeconds: Math.round((Date.now() - startTime) / 1000),
      ...outcome,
    };

    try {
      await HostStorageService.addHistoryEntry(entry);
    } catch (err) {
      console.warn('[SSHClient] Could not record connection history.', err);
    }
  }
}
