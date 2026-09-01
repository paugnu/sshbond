import {
  SSHHost,
  SSHIdentity,
  SSHGroup,
  KnownHost,
  ConnectionHistoryEntry,
} from '@/domain/models/sshConfig';
import { SecureStorageService } from '../secureStorage/SecureStorageService';
import { JsonFileStore } from './JsonFileStore';

export interface AppSettings {
  theme: 'system' | 'dark' | 'light';
  terminalTheme: 'nord' | 'dracula' | 'solarized-dark' | 'solarized-light' | 'system-dark' | 'system-light';
  terminalFontSize: number;
  terminalFontFamily: string;
  cursorStyle: 'block' | 'underline' | 'bar';
  keepAwakeDuringSession: boolean;
  hapticFeedback: boolean;
  confirmMultilinePaste: boolean;
  requireBiometrics: boolean;
  defaultUsername: string;
  defaultPort: number;
  defaultIdentityId?: string;
  connectionTimeoutSeconds: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  terminalTheme: 'nord',
  terminalFontSize: 14,
  terminalFontFamily: 'Menlo, Monaco, Courier New, monospace',
  cursorStyle: 'block',
  keepAwakeDuringSession: true,
  hapticFeedback: true,
  confirmMultilinePaste: true,
  requireBiometrics: false,
  defaultUsername: '',
  defaultPort: 22,
  connectionTimeoutSeconds: 30,
};

const MAX_HISTORY_ENTRIES = 50;

/** Document names in the metadata tier. */
const DOCS = {
  HOSTS: 'hosts',
  IDENTITIES: 'identities',
  GROUPS: 'groups',
  KNOWN_HOSTS: 'known_hosts',
  HISTORY: 'history',
  SETTINGS: 'settings',
} as const;

/** Legacy SecureStore keys, migrated away from on first launch. */
const LEGACY_SECURE_KEYS: Record<string, string> = {
  [DOCS.HOSTS]: 'sshbond_hosts',
  [DOCS.IDENTITIES]: 'sshbond_identities',
  [DOCS.GROUPS]: 'sshbond_groups',
  [DOCS.KNOWN_HOSTS]: 'sshbond_known_hosts',
  [DOCS.HISTORY]: 'sshbond_history',
  [DOCS.SETTINGS]: 'sshbond_settings',
};

export class HostStorageService {
  private static hosts: SSHHost[] = [];
  private static identities: SSHIdentity[] = [];
  private static groups: SSHGroup[] = [];
  private static knownHosts: KnownHost[] = [];
  private static history: ConnectionHistoryEntry[] = [];
  private static settings: AppSettings = { ...DEFAULT_SETTINGS };

  /**
   * Single-flight init. Every public method awaits this, and screens call them
   * concurrently on mount, so without memoising the promise the same documents
   * would be read (and seeded) several times in parallel.
   */
  private static initPromise: Promise<void> | null = null;

  public static async init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.loadAll().catch(err => {
        console.warn('[HostStorageService] Init failed; continuing with in-memory state.', err);
      });
    }
    return this.initPromise;
  }

  /** Test seam: drops caches so a fresh store can be loaded. */
  public static async reset(): Promise<void> {
    this.initPromise = null;
    this.hosts = [];
    this.identities = [];
    this.groups = [];
    this.knownHosts = [];
    this.history = [];
    this.settings = { ...DEFAULT_SETTINGS };
  }

  private static async loadAll(): Promise<void> {
    this.hosts = await this.loadDocument<SSHHost[]>(DOCS.HOSTS, []);
    this.identities = await this.loadDocument<SSHIdentity[]>(DOCS.IDENTITIES, []);
    this.groups = await this.loadDocument<SSHGroup[]>(DOCS.GROUPS, []);
    this.knownHosts = await this.loadDocument<KnownHost[]>(DOCS.KNOWN_HOSTS, []);
    this.history = await this.loadDocument<ConnectionHistoryEntry[]>(DOCS.HISTORY, []);

    const storedSettings = await this.loadDocument<Partial<AppSettings>>(DOCS.SETTINGS, {});
    this.settings = { ...DEFAULT_SETTINGS, ...storedSettings };

    if (this.groups.length === 0) {
      this.groups = [
        { id: 'group_prod', name: 'PRODUCTION', sortOrder: 0 },
        { id: 'group_homelab', name: 'HOMELAB', sortOrder: 1 },
      ];
      await JsonFileStore.write(DOCS.GROUPS, this.groups);
    }
  }

  /**
   * Reads a document, transparently migrating data written by builds that kept
   * the metadata tier in SecureStore.
   */
  private static async loadDocument<T>(name: string, fallback: T): Promise<T> {
    const fromFile = await JsonFileStore.read<T | null>(name, null);
    if (fromFile !== null) return fromFile;

    const legacyKey = LEGACY_SECURE_KEYS[name];
    if (legacyKey) {
      const legacyRaw = await SecureStorageService.getSecret(legacyKey);
      if (legacyRaw) {
        try {
          const parsed = JSON.parse(legacyRaw) as T;
          await JsonFileStore.write(name, parsed);
          await SecureStorageService.deleteSecret(legacyKey);
          return parsed;
        } catch (err) {
          console.warn(`[HostStorageService] Could not migrate legacy "${name}".`, err);
        }
      }
    }

    return fallback;
  }

  // --- Hosts ---
  public static async getHosts(): Promise<SSHHost[]> {
    await this.init();
    return [...this.hosts];
  }

  public static async getHostById(id: string): Promise<SSHHost | undefined> {
    await this.init();
    return this.hosts.find(h => h.id === id);
  }

  public static async saveHost(host: SSHHost): Promise<void> {
    await this.init();
    const index = this.hosts.findIndex(h => h.id === host.id);
    const stamped = { ...host, updatedAt: new Date().toISOString() };

    if (index >= 0) {
      this.hosts[index] = stamped;
    } else {
      this.hosts.push(stamped);
    }

    await JsonFileStore.write(DOCS.HOSTS, this.hosts);
  }

  public static async deleteHost(id: string): Promise<void> {
    await this.init();
    this.hosts = this.hosts.filter(h => h.id !== id);
    await JsonFileStore.write(DOCS.HOSTS, this.hosts);
  }

  // --- Identities ---
  public static async getIdentities(): Promise<SSHIdentity[]> {
    await this.init();
    return [...this.identities];
  }

  public static async getIdentityById(id: string): Promise<SSHIdentity | undefined> {
    await this.init();
    return this.identities.find(i => i.id === id);
  }

  public static async saveIdentity(identity: SSHIdentity, privateKeyPem?: string): Promise<void> {
    await this.init();

    // The private key goes into the hardware-backed keystore *first*: if that
    // write fails we must not leave an identity in the list pointing at a
    // secret that does not exist.
    if (privateKeyPem) {
      await SecureStorageService.setSecret(
        identity.privateKeySecureReference,
        privateKeyPem,
        identity.requiresBiometrics
      );
    }

    const index = this.identities.findIndex(i => i.id === identity.id);
    if (index >= 0) {
      this.identities[index] = identity;
    } else {
      this.identities.push(identity);
    }

    await JsonFileStore.write(DOCS.IDENTITIES, this.identities);
  }

  public static async deleteIdentity(id: string): Promise<void> {
    await this.init();

    const identity = this.identities.find(i => i.id === id);
    if (identity) {
      await SecureStorageService.deleteSecret(identity.privateKeySecureReference);
    }

    this.identities = this.identities.filter(i => i.id !== id);
    await JsonFileStore.write(DOCS.IDENTITIES, this.identities);

    // Hosts pointing at a deleted key would otherwise keep claiming key auth
    // against an identity that can no longer be resolved.
    let hostsChanged = false;
    this.hosts = this.hosts.map(host => {
      if (host.identityId !== id) return host;
      hostsChanged = true;
      return { ...host, identityId: undefined, updatedAt: new Date().toISOString() };
    });

    if (hostsChanged) {
      await JsonFileStore.write(DOCS.HOSTS, this.hosts);
    }
  }

  // --- Groups ---
  public static async getGroups(): Promise<SSHGroup[]> {
    await this.init();
    return [...this.groups].sort((a, b) => a.sortOrder - b.sortOrder);
  }

  public static async addGroup(name: string): Promise<SSHGroup> {
    await this.init();
    const group: SSHGroup = {
      id: `group_${Date.now()}`,
      name,
      sortOrder: this.groups.length,
    };
    this.groups.push(group);
    await JsonFileStore.write(DOCS.GROUPS, this.groups);
    return group;
  }

  // --- Known Hosts ---
  public static async getKnownHosts(): Promise<KnownHost[]> {
    await this.init();
    return [...this.knownHosts];
  }

  public static async saveKnownHost(knownHost: KnownHost): Promise<void> {
    await this.init();
    const index = this.knownHosts.findIndex(
      k => k.hostname === knownHost.hostname && k.port === knownHost.port && k.algorithm === knownHost.algorithm
    );

    if (index >= 0) {
      this.knownHosts[index] = knownHost;
    } else {
      this.knownHosts.push(knownHost);
    }

    await JsonFileStore.write(DOCS.KNOWN_HOSTS, this.knownHosts);
  }

  public static async removeKnownHost(id: string): Promise<void> {
    await this.init();
    this.knownHosts = this.knownHosts.filter(k => k.id !== id);
    await JsonFileStore.write(DOCS.KNOWN_HOSTS, this.knownHosts);
  }

  // --- History ---
  public static async getHistory(): Promise<ConnectionHistoryEntry[]> {
    await this.init();
    return [...this.history];
  }

  public static async addHistoryEntry(entry: ConnectionHistoryEntry): Promise<void> {
    await this.init();
    this.history.unshift(entry);
    if (this.history.length > MAX_HISTORY_ENTRIES) {
      this.history = this.history.slice(0, MAX_HISTORY_ENTRIES);
    }
    await JsonFileStore.write(DOCS.HISTORY, this.history);
  }

  public static async clearHistory(): Promise<void> {
    await this.init();
    this.history = [];
    await JsonFileStore.write(DOCS.HISTORY, this.history);
  }

  // --- Settings ---
  public static async getSettings(): Promise<AppSettings> {
    await this.init();
    return { ...this.settings };
  }

  public static async updateSettings(updates: Partial<AppSettings>): Promise<AppSettings> {
    await this.init();
    this.settings = { ...this.settings, ...updates };
    await JsonFileStore.write(DOCS.SETTINGS, this.settings);
    return { ...this.settings };
  }
}
