import * as FileSystem from 'expo-file-system/legacy';

/**
 * Document-tier persistence: plain JSON files in the app's private documents
 * directory.
 *
 * This is deliberately *not* SecureStore. The keychain/keystore is designed for
 * small secrets -- Android's EncryptedSharedPreferences backing warns above
 * 2 KB per value and larger writes are unreliable -- so a growing host list,
 * known-hosts database or connection history stored there will silently start
 * failing once the user has a realistic number of entries. Secrets keep going
 * to SecureStorageService; everything non-sensitive lives here.
 */
const STORE_DIRECTORY = `${FileSystem.documentDirectory ?? ''}sshbond/`;

let directoryReady: Promise<void> | null = null;

async function ensureDirectory(): Promise<void> {
  if (!directoryReady) {
    directoryReady = (async () => {
      const info = await FileSystem.getInfoAsync(STORE_DIRECTORY);
      if (!info.exists) {
        await FileSystem.makeDirectoryAsync(STORE_DIRECTORY, { intermediates: true });
      }
    })().catch(err => {
      // Reset so a transient failure does not poison every later write.
      directoryReady = null;
      throw err;
    });
  }
  return directoryReady;
}

function pathFor(name: string): string {
  return `${STORE_DIRECTORY}${name}.json`;
}

export class JsonFileStore {
  public static async read<T>(name: string, fallback: T): Promise<T> {
    try {
      await ensureDirectory();
      const info = await FileSystem.getInfoAsync(pathFor(name));
      if (!info.exists) return fallback;

      const raw = await FileSystem.readAsStringAsync(pathFor(name));
      if (!raw.trim()) return fallback;

      return JSON.parse(raw) as T;
    } catch (err) {
      console.warn(`[JsonFileStore] Unable to read "${name}", using fallback.`, err);
      return fallback;
    }
  }

  public static async write(name: string, value: unknown): Promise<void> {
    await ensureDirectory();

    // Write to a sibling temp file first: a crash mid-write would otherwise
    // leave a truncated JSON document that fails to parse on next launch,
    // losing every host the user has saved.
    const target = pathFor(name);
    const temp = `${target}.tmp`;

    await FileSystem.writeAsStringAsync(temp, JSON.stringify(value));
    await FileSystem.moveAsync({ from: temp, to: target });
  }

  public static async delete(name: string): Promise<void> {
    try {
      await FileSystem.deleteAsync(pathFor(name), { idempotent: true });
    } catch (err) {
      console.warn(`[JsonFileStore] Unable to delete "${name}".`, err);
    }
  }
}
