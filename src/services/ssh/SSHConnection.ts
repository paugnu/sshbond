import { ResolvedSSHConfig, ConnectionStatus } from '@/domain/models/sshConfig';

export interface SSHConnectionHandlers {
  send: (data: string) => Promise<void>;
  resize: (cols: number, rows: number) => Promise<void>;
  disconnect: () => Promise<void>;
}

export interface ISSHConnection {
  readonly id: string;
  readonly config: ResolvedSSHConfig;
  readonly status: ConnectionStatus;

  sendInput(data: string): Promise<void>;
  resize(cols: number, rows: number): Promise<void>;
  disconnect(): Promise<void>;

  onData(listener: (data: string) => void): () => void;
  onError(listener: (error: string) => void): () => void;
  onStatusChange(listener: (status: ConnectionStatus) => void): () => void;
  onClose(listener: (code: number) => void): () => void;
}

/** Statuses in which the remote end is able to accept input. */
const WRITABLE_STATUSES: ConnectionStatus[] = ['connected', 'authenticating'];

export class SSHConnection implements ISSHConnection {
  public readonly id: string;
  public readonly config: ResolvedSSHConfig;

  private currentStatus: ConnectionStatus = 'disconnected';
  private closed = false;

  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly errorListeners = new Set<(error: string) => void>();
  private readonly statusListeners = new Set<(status: ConnectionStatus) => void>();
  private readonly closeListeners = new Set<(code: number) => void>();

  private handlers?: SSHConnectionHandlers;
  private cleanupFns: (() => void)[] = [];

  constructor(id: string, config: ResolvedSSHConfig) {
    this.id = id;
    this.config = config;
  }

  public get status(): ConnectionStatus {
    return this.currentStatus;
  }

  public setHandlers(handlers: SSHConnectionHandlers): void {
    this.handlers = handlers;
  }

  /**
   * Registers work to run exactly once when the session ends -- native event
   * subscriptions in particular. Without this the bridge kept per-session
   * listeners alive for the lifetime of the app.
   */
  public addCleanup(fn: () => void): void {
    this.cleanupFns.push(fn);
  }

  public updateStatus(status: ConnectionStatus): void {
    if (this.currentStatus === status) return;
    this.currentStatus = status;
    this.emit(this.statusListeners, status);
  }

  public emitData(data: string): void {
    this.emit(this.dataListeners, data);
  }

  public emitError(error: string): void {
    this.emit(this.errorListeners, error);
  }

  /**
   * Terminates the session. Idempotent: the native layer, an explicit
   * disconnect and a server-side hangup can all race, and each extra close
   * would otherwise re-notify listeners (duplicating history entries).
   */
  public emitClose(code: number): void {
    if (this.closed) return;
    this.closed = true;

    this.updateStatus('disconnected');
    this.emit(this.closeListeners, code);

    for (const fn of this.cleanupFns) {
      try {
        fn();
      } catch (err) {
        console.warn('[SSHConnection] Cleanup handler threw.', err);
      }
    }
    this.cleanupFns = [];

    this.dataListeners.clear();
    this.errorListeners.clear();
    this.statusListeners.clear();
    this.closeListeners.clear();
  }

  public async sendInput(data: string): Promise<void> {
    if (!WRITABLE_STATUSES.includes(this.currentStatus)) {
      throw new Error(`Cannot send input while the session is "${this.currentStatus}".`);
    }
    await this.handlers?.send(data);
  }

  public async resize(cols: number, rows: number): Promise<void> {
    if (this.closed) return;
    if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols <= 0 || rows <= 0) return;
    await this.handlers?.resize(Math.floor(cols), Math.floor(rows));
  }

  public async disconnect(): Promise<void> {
    if (this.closed) return;
    try {
      await this.handlers?.disconnect();
    } finally {
      this.emitClose(0);
    }
  }

  public onData(listener: (data: string) => void): () => void {
    return this.subscribe(this.dataListeners, listener);
  }

  public onError(listener: (error: string) => void): () => void {
    return this.subscribe(this.errorListeners, listener);
  }

  public onStatusChange(listener: (status: ConnectionStatus) => void): () => void {
    return this.subscribe(this.statusListeners, listener);
  }

  public onClose(listener: (code: number) => void): () => void {
    return this.subscribe(this.closeListeners, listener);
  }

  private subscribe<T>(set: Set<T>, listener: T): () => void {
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  /** One throwing listener must not stop the others from being notified. */
  private emit<T>(listeners: Set<(value: T) => void>, value: T): void {
    for (const listener of Array.from(listeners)) {
      try {
        listener(value);
      } catch (err) {
        console.warn('[SSHConnection] Listener threw.', err);
      }
    }
  }
}
