import { EventSubscription } from 'expo-modules-core';
import { ResolvedSSHConfig, SSHAuthType } from '@/domain/models/sshConfig';
import { SSHConnection } from '../SSHConnection';
import { MockSSHBridge } from './MockSSHBridge';
import { SSHBondNative, SSHForwardSpec, SSHTunnelEvent } from '../../../../modules/expo-sshbond';

export interface PresentedHostKey {
  /** The machine this key belongs to: a jump host, or the target. */
  hostname: string;
  port: number;
  algorithm: string;
  fingerprint: string;
  publicKey: string;
}

/** A resolved ProxyJump hop, with its credential already read from the keystore. */
export interface NativeJumpHost {
  hostname: string;
  port: number;
  username: string;
  authType: SSHAuthType;
  credential: SSHCredential;
}

/** Credential handed to the engine, already resolved from the keystore. */
export type SSHCredential =
  | { kind: 'password'; password: string }
  | { kind: 'key'; privateKey: string; passphrase?: string }
  | { kind: 'none' };

export interface NativeConnectRequest {
  sessionId: string;
  config: ResolvedSSHConfig;
  credential: SSHCredential;
  connection: SSHConnection;
  /** Port forwards to open once authenticated. */
  forwards?: SSHForwardSpec[];
  /** Jump hosts to traverse first, in order. */
  jumps?: NativeJumpHost[];
  /**
   * Called as each forward comes up or fails. The simulator never calls it:
   * it opens no channels, so its tunnels stay `pending`.
   */
  onTunnelStatus?: (event: SSHTunnelEvent) => void;
  /**
   * Called with the server's host key before authentication. Resolving `false`
   * or throwing aborts the connection.
   */
  verifyHostKey: (key: PresentedHostKey) => Promise<boolean>;
}

export class NativeSSHBridge {
  /** True when a real SSH engine is present; false under Jest, web and Expo Go. */
  public static get isNativeEngineAvailable(): boolean {
    return SSHBondNative !== null;
  }

  public static async connect(request: NativeConnectRequest): Promise<void> {
    if (!SSHBondNative) {
      await MockSSHBridge.createSession(request);
      return;
    }

    const native = SSHBondNative;
    const { sessionId, config, connection, credential } = request;

    // Subscribe before calling connect. The engine starts emitting as soon as
    // the transport opens -- the host key arrives during the handshake -- so a
    // listener attached after the promise resolves would miss it entirely.
    const subscriptions: EventSubscription[] = [];
    const forSession = <T extends { sessionId: string }>(handler: (payload: T) => void) => {
      // One native event stream serves every session; filtering here keeps a
      // busy session from delivering its output into another one's terminal.
      return (payload: T) => {
        if (payload.sessionId === sessionId) handler(payload);
      };
    };

    subscriptions.push(
      native.addListener('onSSHData', forSession(({ data }) => connection.emitData(data))),
      native.addListener('onSSHError', forSession(({ message }) => connection.emitError(message))),
      native.addListener('onSSHClose', forSession(({ exitCode }) => connection.emitClose(exitCode ?? 0))),
      native.addListener(
        'onSSHStatus',
        forSession(({ status }) => connection.updateStatus(normaliseStatus(status)))
      ),
      native.addListener(
        'onSSHTunnel',
        forSession(event => request.onTunnelStatus?.(event))
      ),
      native.addListener(
        'onSSHHostKey',
        forSession(({ hostname, port, algorithm, fingerprint, publicKey }) => {
          void request
            .verifyHostKey({ hostname, port, algorithm, fingerprint, publicKey })
            .then(accepted => native.respondToHostKey(sessionId, accepted))
            .catch(async err => {
              // Any failure in the verification path -- including a storage
              // error -- must refuse the key rather than wave it through.
              connection.emitError(
                err instanceof Error ? err.message : 'Host key verification failed.'
              );
              await native.respondToHostKey(sessionId, false).catch(() => undefined);
            });
        })
      )
    );

    connection.addCleanup(() => {
      for (const subscription of subscriptions) {
        subscription.remove();
      }
    });

    try {
      connection.updateStatus('connecting');

      await native.connect({
        sessionId,
        hostname: config.hostname,
        port: config.port,
        username: config.username,
        authType: config.authenticationType,
        ...credentialFields(credential),
        timeoutMs: config.connectTimeout * 1000,
        compression: config.compression,
        keepAliveIntervalSeconds: config.serverAliveInterval,
        keepAliveCountMax: config.serverAliveCountMax,
        proxyJump: config.proxyJump,
        requestTTY: config.requestTTY,
        remoteCommand: config.remoteCommand,
        forwards: request.forwards ?? [],
        jumps: (request.jumps ?? []).map(jump => ({
          hostname: jump.hostname,
          port: jump.port,
          username: jump.username,
          authType: jump.authType,
          ...credentialFields(jump.credential),
        })),
      });

      connection.setHandlers({
        send: data => native.sendData(sessionId, data),
        resize: (cols, rows) => native.resizePTY(sessionId, cols, rows),
        disconnect: () => native.disconnect(sessionId),
      });

      connection.updateStatus('connected');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Native SSH connection failed.';
      connection.updateStatus('error');
      connection.emitError(message);
      // Also tears down the subscriptions registered above.
      connection.emitClose(1);
      throw err instanceof Error ? err : new Error(message);
    }
  }
}

function credentialFields(credential: SSHCredential) {
  switch (credential.kind) {
    case 'password':
      return { password: credential.password };
    case 'key':
      return { privateKey: credential.privateKey, passphrase: credential.passphrase };
    case 'none':
      return {};
  }
}

function normaliseStatus(status: string) {
  switch (status) {
    case 'connecting':
    case 'verifying_host':
    case 'authenticating':
    case 'connected':
    case 'error':
    case 'disconnected':
      return status;
    default:
      return 'connecting';
  }
}
