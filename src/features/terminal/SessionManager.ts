import { ISSHConnection } from '@/services/ssh/SSHConnection';
import { SSHSessionInfo, ResolvedSSHConfig } from '@/domain/models/sshConfig';
import { SSHClient, ConnectOptions } from '@/services/ssh/SSHClient';
import { SSHTunnelManager, ActiveTunnel } from '@/services/ssh/SSHTunnelManager';

interface TrackedSession {
  info: SSHSessionInfo;
  connection: ISSHConnection;
  unsubscribes: (() => void)[];
}

export class SessionManager {
  private static sessions = new Map<string, TrackedSession>();
  private static listeners = new Set<() => void>();

  /**
   * A forward coming up or failing changes what the sessions list shows, and
   * the engine reports that on its own schedule -- long after the session was
   * created -- so the screen has to be told to re-render.
   */
  private static readonly tunnelSubscription = SSHTunnelManager.subscribe(() => {
    SessionManager.notify();
  });

  public static getSessions(): SSHSessionInfo[] {
    return Array.from(this.sessions.values())
      .map(s => s.info)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }

  public static getConnection(sessionId: string): ISSHConnection | undefined {
    return this.sessions.get(sessionId)?.connection;
  }

  public static getSessionInfo(sessionId: string): SSHSessionInfo | undefined {
    return this.sessions.get(sessionId)?.info;
  }

  public static getTunnels(sessionId: string): ActiveTunnel[] {
    return SSHTunnelManager.getTunnelsForSession(sessionId);
  }

  public static async createSession(
    config: ResolvedSSHConfig,
    options?: ConnectOptions
  ): Promise<{ session: SSHSessionInfo; connection: ISSHConnection }> {
    const connection = await SSHClient.connect(config, options);
    const now = new Date().toISOString();

    const info: SSHSessionInfo = {
      id: connection.id,
      hostId: options?.hostId,
      hostAlias: config.alias,
      hostname: config.hostname,
      port: config.port,
      username: config.username,
      status: connection.status,
      startedAt: now,
      lastActiveAt: now,
    };

    const tracked: TrackedSession = { info, connection, unsubscribes: [] };

    tracked.unsubscribes.push(
      connection.onStatusChange(status => {
        this.patch(connection.id, { status, lastActiveAt: new Date().toISOString() });
      }),
      connection.onError(errorMessage => {
        this.patch(connection.id, { errorMessage });
      }),
      // A session dropped by the server must disappear from the list on its
      // own; previously only an explicit close removed it.
      connection.onClose(() => {
        this.forget(connection.id);
      })
    );

    // The tunnels themselves were registered by SSHClient before connecting.
    this.sessions.set(connection.id, tracked);
    this.notify();

    return { session: info, connection };
  }

  public static async closeSession(sessionId: string): Promise<void> {
    const tracked = this.sessions.get(sessionId);
    if (!tracked) return;

    try {
      await tracked.connection.disconnect();
    } finally {
      this.forget(sessionId);
    }
  }

  public static async closeAllSessions(): Promise<void> {
    await Promise.all(Array.from(this.sessions.keys()).map(id => this.closeSession(id)));
  }

  public static subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Replaces the stored info object instead of mutating it, so React sees a
   * new reference and re-renders. Mutating in place made the sessions list go
   * stale even though listeners fired.
   */
  private static patch(sessionId: string, updates: Partial<SSHSessionInfo>): void {
    const tracked = this.sessions.get(sessionId);
    if (!tracked) return;

    tracked.info = { ...tracked.info, ...updates };
    this.notify();
  }

  private static forget(sessionId: string): void {
    const tracked = this.sessions.get(sessionId);
    if (!tracked) return;

    for (const unsubscribe of tracked.unsubscribes) {
      unsubscribe();
    }

    SSHTunnelManager.clear(sessionId);
    this.sessions.delete(sessionId);
    this.notify();
  }

  private static notify(): void {
    for (const listener of Array.from(this.listeners)) {
      try {
        listener();
      } catch (err) {
        console.warn('[SessionManager] Listener threw.', err);
      }
    }
  }
}
