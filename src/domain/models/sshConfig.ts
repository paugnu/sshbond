export type SSHAuthType = 'password' | 'key' | 'certificate' | 'agent' | 'none';

export interface PortForwardRule {
  bindAddress?: string;
  bindPort: number;
  targetHost: string;
  targetPort: number;
}

export interface DynamicForwardRule {
  bindAddress?: string;
  port: number;
}

export interface SSHHost {
  id: string;
  alias: string; // e.g. 'web-prod' or 'db' or '*'
  hostname: string; // e.g. 'server.example.com' or '10.0.0.12'
  port: number; // default 22
  username: string; // e.g. 'ubuntu'
  groupId?: string;
  tags: string[];
  favorite: boolean;
  identityId?: string; // Reference to SSHIdentity
  authenticationType: SSHAuthType;
  proxyJump?: string; // e.g. 'gateway' or 'bastion1,bastion2'
  proxyCommand?: string;
  serverAliveInterval?: number;
  serverAliveCountMax?: number;
  connectTimeout?: number;
  compression?: boolean;
  forwardAgent?: boolean;
  requestTTY?: 'yes' | 'no' | 'force' | 'auto';
  remoteCommand?: string;
  localForwards?: PortForwardRule[];
  remoteForwards?: PortForwardRule[];
  dynamicForwards?: DynamicForwardRule[];
  tcpKeepAlive?: boolean;
  strictHostKeyChecking?: 'yes' | 'no' | 'accept-new' | 'ask';
  userKnownHostsFile?: string;
  terminalTheme?: string;
  customDirectives?: Record<string, string>; // Preserves unsupported/custom OpenSSH directives
  createdAt: string;
  updatedAt: string;
  lastConnectedAt?: string;
}

export type SSHKeyAlgorithm = 'ed25519' | 'rsa' | 'ecdsa';

export interface SSHIdentity {
  id: string;
  name: string; // e.g. 'id_ed25519'
  algorithm: SSHKeyAlgorithm;
  publicKey: string; // e.g. 'ssh-ed25519 AAAAC3... comment'
  privateKeySecureReference: string; // Identifier key in SecureStore
  fingerprint: string; // e.g. 'SHA256:xxxxxxxx...'
  comment?: string;
  keySize?: number; // e.g. 4096 for RSA
  /** True when the stored private key is itself encrypted with a passphrase. */
  hasPassphrase: boolean;
  /** True when reading the key from the keystore requires Face ID / fingerprint. */
  requiresBiometrics?: boolean;
  createdAt: string;
}

export interface SSHGroup {
  id: string;
  name: string;
  sortOrder: number;
}

export interface KnownHost {
  id: string;
  hostname: string;
  port: number;
  algorithm: string;
  fingerprint: string;
  publicKey: string;
  trustedAt: string;
}

export interface ResolvedSSHConfig {
  alias: string;
  hostname: string;
  port: number;
  username: string;
  identityId?: string;
  identityFile?: string;
  authenticationType: SSHAuthType;
  proxyJump?: string;
  proxyCommand?: string;
  serverAliveInterval: number;
  serverAliveCountMax: number;
  connectTimeout: number;
  compression: boolean;
  forwardAgent: boolean;
  requestTTY: 'yes' | 'no' | 'force' | 'auto';
  remoteCommand?: string;
  tcpKeepAlive: boolean;
  strictHostKeyChecking: 'yes' | 'no' | 'accept-new' | 'ask';
  localForwards: PortForwardRule[];
  remoteForwards: PortForwardRule[];
  dynamicForwards: DynamicForwardRule[];
  customDirectives: Record<string, string>;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'verifying_host' | 'authenticating' | 'connected' | 'error';

export interface SSHSessionInfo {
  id: string;
  hostId?: string;
  hostAlias: string;
  hostname: string;
  port: number;
  username: string;
  status: ConnectionStatus;
  startedAt: string;
  lastActiveAt: string;
  errorMessage?: string;
}

export interface ConnectionHistoryEntry {
  id: string;
  hostId?: string;
  hostAlias: string;
  hostname: string;
  port: number;
  username: string;
  timestamp: string;
  durationSeconds: number;
  status: 'success' | 'failed';
  errorMessage?: string;
}
