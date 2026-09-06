export type AppLockState = 'checking' | 'locked' | 'unlocked';

/** Keeps authentication results from an earlier foreground visit from unlocking a later one. */
export class AppLockController {
  private appState = 'active';
  private generation = 0;
  private authenticating = false;
  private authorized = false;
  private inactiveDuringAuthentication = false;

  constructor(
    private readonly requiresAuthentication: () => Promise<boolean>,
    private readonly authenticate: () => Promise<boolean>,
    private readonly publish: (state: AppLockState) => void,
  ) {}

  async unlock(): Promise<void> {
    if (this.authenticating) return;
    this.authenticating = true;
    const generation = ++this.generation;
    this.publish('checking');
    try {
      const required = await this.requiresAuthentication();
      if (generation !== this.generation) return;
      const accepted = !required || await this.authenticate();
      if (generation !== this.generation) return;
      this.authorized = accepted;
      this.publish(accepted && this.appState === 'active' ? 'unlocked' : 'locked');
    } catch {
      if (generation === this.generation) {
        this.authorized = false;
        this.publish('locked');
      }
    } finally {
      this.authenticating = false;
    }
  }

  onAppStateChange(state: string): void {
    this.appState = state;
    if (state !== 'active') {
      this.inactiveDuringAuthentication = state === 'inactive' && this.authenticating;
      // A system biometric dialog can make iOS inactive. Only a real trip to
      // background invalidates an authentication currently in progress.
      if (state === 'background' || !this.authenticating) {
        this.generation++;
        this.authorized = false;
      }
      this.publish('locked');
    } else if (this.inactiveDuringAuthentication) {
      // In particular, cancelling the system dialog must not immediately open
      // another dialog when iOS reports active afterwards.
      this.inactiveDuringAuthentication = false;
      this.publish(this.authorized ? 'unlocked' : this.authenticating ? 'checking' : 'locked');
    } else if (this.authorized) {
      this.publish('unlocked');
    } else if (!this.authenticating) {
      void this.unlock();
    }
  }

  dispose(): void {
    this.generation++;
  }
}
