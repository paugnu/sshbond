import type { SSHForwardSpec } from '../../../modules/expo-sshbond';
import { ISSHConnection } from './SSHConnection';

export type TunnelStatus =
  /** Declared in the config; the engine has not confirmed it is listening. */
  | 'pending'
  /** The engine has the forwarding channel open. */
  | 'active'
  | 'stopped'
  | 'error';

export interface ActiveTunnel {
  id: string;
  sessionId: string;
  type: 'local' | 'remote' | 'dynamic';
  description: string;
  bindAddress?: string;
  bindPort: number;
  /** The port the engine really bound. Differs from `bindPort` when it was 0. */
  boundPort?: number;
  targetHost?: string;
  targetPort?: number;
  status: TunnelStatus;
  /** Why the forward failed, when it did. */
  message?: string;
}

export interface TunnelStatusUpdate {
  tunnelId: string;
  status: TunnelStatus;
  boundPort?: number | null;
  message?: string | null;
}

/**
 * Tracks the port forwards declared for each live session.
 *
 * The forwarding channels are opened by the engine, not here; a tunnel is
 * registered as `pending` and only becomes `active` when the engine says it is
 * listening. Nothing here ever assumes success -- a tunnel drawn as working
 * when no channel was opened sends the user's traffic into a black hole, and
 * under the simulator no channel is ever opened at all.
 */
export class SSHTunnelManager {
  private static tunnelsBySession = new Map<string, ActiveTunnel[]>();
  private static listeners = new Set<() => void>();

  /**
   * Builds the tunnel rows for a session. Called before the engine connects,
   * because the rules have to travel with the connect request.
   */
  public static registerForConnection(connection: ISSHConnection): ActiveTunnel[] {
    const { config } = connection;

    const tunnels: ActiveTunnel[] = [
      ...config.localForwards.map((rule, index) =>
        withDescription({
          id: `${connection.id}_local_${index}`,
          sessionId: connection.id,
          type: 'local' as const,
          bindAddress: rule.bindAddress,
          bindPort: rule.bindPort,
          targetHost: rule.targetHost,
          targetPort: rule.targetPort,
          status: 'pending' as const,
        })
      ),
      ...config.remoteForwards.map((rule, index) =>
        withDescription({
          id: `${connection.id}_remote_${index}`,
          sessionId: connection.id,
          type: 'remote' as const,
          bindAddress: rule.bindAddress,
          bindPort: rule.bindPort,
          targetHost: rule.targetHost,
          targetPort: rule.targetPort,
          status: 'pending' as const,
        })
      ),
      ...config.dynamicForwards.map((rule, index) =>
        withDescription({
          id: `${connection.id}_dynamic_${index}`,
          sessionId: connection.id,
          type: 'dynamic' as const,
          bindAddress: rule.bindAddress,
          bindPort: rule.port,
          status: 'pending' as const,
        })
      ),
    ];

    if (tunnels.length === 0) {
      return [];
    }

    this.tunnelsBySession.set(connection.id, tunnels);
    connection.onClose(() => {
      this.clear(connection.id);
    });

    this.notify();
    return tunnels;
  }

  /** The registered rules, in the shape the native engine expects. */
  public static getForwardSpecs(sessionId: string): SSHForwardSpec[] {
    return this.getTunnelsForSession(sessionId).map(tunnel => ({
      id: tunnel.id,
      type: tunnel.type,
      bindAddress: tunnel.bindAddress,
      bindPort: tunnel.bindPort,
      targetHost: tunnel.targetHost,
      targetPort: tunnel.targetPort,
    }));
  }

  /** Applies what the engine reported about one tunnel. */
  public static applyStatus(sessionId: string, update: TunnelStatusUpdate): void {
    const tunnels = this.tunnelsBySession.get(sessionId);
    if (!tunnels) return;

    const index = tunnels.findIndex(tunnel => tunnel.id === update.tunnelId);
    if (index === -1) return;

    tunnels[index] = withDescription({
      ...tunnels[index],
      status: update.status,
      boundPort: update.boundPort ?? undefined,
      message: update.message ?? undefined,
    });

    this.notify();
  }

  public static getTunnelsForSession(sessionId: string): ActiveTunnel[] {
    return this.tunnelsBySession.get(sessionId) ?? [];
  }

  public static clear(sessionId: string): void {
    if (!this.tunnelsBySession.delete(sessionId)) return;
    this.notify();
  }

  /** Notified whenever a tunnel is registered, updated or cleared. */
  public static subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private static notify(): void {
    for (const listener of Array.from(this.listeners)) {
      try {
        listener();
      } catch (err) {
        console.warn('[SSHTunnelManager] Listener threw.', err);
      }
    }
  }
}

/**
 * Describes a tunnel the way `ssh` states the flag, using the port that was
 * actually bound once the engine reports one -- a rule written as port 0 is
 * useless to the user until they know where to point their client.
 */
function withDescription(tunnel: Omit<ActiveTunnel, 'description'>): ActiveTunnel {
  const bindAddress = tunnel.bindAddress ?? (tunnel.type === 'remote' ? '0.0.0.0' : 'localhost');
  const port = tunnel.boundPort ?? tunnel.bindPort;
  const target = `${tunnel.targetHost}:${tunnel.targetPort}`;

  const description =
    tunnel.type === 'local'
      ? `-L ${bindAddress}:${port} → ${target}`
      : tunnel.type === 'remote'
        ? `-R ${bindAddress}:${port} → ${target}`
        : `-D SOCKS5 on ${bindAddress}:${port}`;

  return { ...tunnel, description };
}
