import { EventEmitter, EventSubscription, requireNativeModule } from 'expo-modules-core';

export type SSHForwardType = 'local' | 'remote' | 'dynamic';

/** One `-L` / `-R` / `-D` rule handed to the engine. */
export interface SSHForwardSpec {
  /** Minted by the caller and echoed back in every tunnel event. */
  id: string;
  type: SSHForwardType;
  bindAddress?: string;
  /** 0 asks for an allocated port: from the OS for `-L`/`-D`, from the server for `-R`. */
  bindPort: number;
  /** Where the far end should connect to. Unused by a dynamic forward. */
  targetHost?: string;
  targetPort?: number;
}

/**
 * One machine to authenticate to on the way to the target. The engine opens
 * them in order, each one through the previous, and the last one carries the
 * channel to the target.
 */
export interface SSHJumpHostOptions {
  hostname: string;
  port: number;
  username: string;
  authType: 'password' | 'key' | 'none' | 'agent' | 'certificate';
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

export interface SSHConnectOptions {
  sessionId: string;
  hostname: string;
  port: number;
  username: string;
  authType: 'password' | 'key' | 'none' | 'agent' | 'certificate';
  /** Password auth only. */
  password?: string;
  /** Key auth only: the PEM/OpenSSH private key. */
  privateKey?: string;
  /** Key auth only: passphrase protecting `privateKey`. */
  passphrase?: string;
  timeoutMs: number;
  compression: boolean;
  keepAliveIntervalSeconds: number;
  keepAliveCountMax: number;
  proxyJump?: string;
  requestTTY: string;
  remoteCommand?: string;
  forwards: SSHForwardSpec[];
  /** The ProxyJump chain, already resolved. Empty for a direct connection. */
  jumps: SSHJumpHostOptions[];
}

export interface SSHStatusEvent {
  sessionId: string;
  status: string;
}

export interface SSHDataEvent {
  sessionId: string;
  data: string;
}

export interface SSHErrorEvent {
  sessionId: string;
  message: string;
}

export interface SSHCloseEvent {
  sessionId: string;
  exitCode: number;
}

export interface SSHTunnelEvent {
  sessionId: string;
  tunnelId: string;
  status: 'active' | 'error' | 'stopped';
  /** The port actually bound; only meaningful when the rule asked for 0. */
  boundPort?: number | null;
  message?: string | null;
}

export interface SSHHostKeyEvent {
  sessionId: string;
  /**
   * The machine whose key this is -- a jump host, or the target. Never the
   * address the socket was opened to, which for anything but the first hop is a
   * local forward on 127.0.0.1.
   */
  hostname: string;
  port: number;
  algorithm: string;
  fingerprint: string;
  publicKey: string;
}

interface SSHBondNativeModule {
  connect(options: SSHConnectOptions): Promise<void>;
  /**
   * Answers a pending `onSSHHostKey`. The server handshake is blocked until this
   * is called; `false` aborts the connection before authentication.
   */
  respondToHostKey(sessionId: string, accept: boolean): Promise<void>;
  sendData(sessionId: string, data: string): Promise<void>;
  resizePTY(sessionId: string, cols: number, rows: number): Promise<void>;
  disconnect(sessionId: string): Promise<void>;
  isNativeEngineAvailable(): Promise<boolean>;

  addListener(event: 'onSSHStatus', listener: (payload: SSHStatusEvent) => void): EventSubscription;
  addListener(event: 'onSSHData', listener: (payload: SSHDataEvent) => void): EventSubscription;
  addListener(event: 'onSSHError', listener: (payload: SSHErrorEvent) => void): EventSubscription;
  addListener(event: 'onSSHClose', listener: (payload: SSHCloseEvent) => void): EventSubscription;
  addListener(event: 'onSSHHostKey', listener: (payload: SSHHostKeyEvent) => void): EventSubscription;
  addListener(event: 'onSSHTunnel', listener: (payload: SSHTunnelEvent) => void): EventSubscription;
}

/**
 * The native SSH engine, or `null` where it was not built in.
 *
 * The module is Android-only for now and is absent under Expo Go, on web and in
 * Jest, so callers must handle `null` rather than assume a transport exists.
 */
export const SSHBondNative: (SSHBondNativeModule & EventEmitter) | null = (() => {
  try {
    return requireNativeModule('SSHBondNative');
  } catch {
    return null;
  }
})();

export default SSHBondNative;
