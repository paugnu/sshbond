import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';

/**
 * SecureStore starts warning past 2 KB per value, and on Android that ceiling
 * is real: the write fails rather than truncating, and expo-secure-store says
 * the call will throw outright in a future SDK. A 4096-bit RSA key is
 * comfortably over it, so anything too large is split across numbered entries
 * and rejoined on read.
 *
 * Kept well under the limit: the ceiling is in bytes and the accounting below
 * is too, but leaving room costs nothing.
 */
const MAX_CHUNK_BYTES = 1536;

/**
 * How many parts a split secret was stored in, kept in an entry of its own.
 *
 * Separate from the secret, and never behind the biometric gate, so that
 * finding out whether a secret is split -- which overwriting and deleting both
 * need to know -- never asks the user for a face or a fingerprint. It holds a
 * count and nothing else.
 */
const indexKey = (key: string) => `${key}__parts`;

const chunkKey = (key: string, index: number) => `${key}__c${index}`;

const PLAIN_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export class SecureStorageService {
  /**
   * Stores a sensitive secret (private key, passphrase, password) in OS Keychain / Keystore
   */
  public static async setSecret(key: string, value: string, requireBiometrics = false): Promise<void> {
    const options: SecureStore.SecureStoreOptions = {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    };

    if (requireBiometrics) {
      options.requireAuthentication = true;
      options.authenticationPrompt = 'Authenticate to access your secure SSH credentials';
    }

    // Whatever was stored here before may have been split differently. A
    // leftover chunk from a longer value would otherwise be read back as part
    // of the new one.
    await this.clearChunks(key);

    const chunks = splitByByteLength(value, MAX_CHUNK_BYTES);

    if (chunks.length <= 1) {
      await SecureStore.setItemAsync(key, value, options);
      return;
    }

    // Parts first, index last. A write that dies halfway then leaves no index,
    // which reads as "no secret", rather than half a private key.
    for (let index = 0; index < chunks.length; index++) {
      await SecureStore.setItemAsync(chunkKey(key, index), chunks[index], options);
    }

    // The entry itself would otherwise still hold whatever an older, unsplit
    // write left there, and that value wins on read.
    await SecureStore.deleteItemAsync(key);
    await SecureStore.setItemAsync(indexKey(key), String(chunks.length), PLAIN_OPTIONS);
  }

  /**
   * Retrieves a sensitive secret from OS Keychain / Keystore
   *
   * A biometric-gated secret large enough to have been split prompts once per
   * chunk: the keystore authorises a single read at a time, and there is no
   * way to ask it for a batch.
   */
  public static async getSecret(key: string, promptReason = 'Authenticate to unlock SSH credentials'): Promise<string | null> {
    try {
      const options: SecureStore.SecureStoreOptions = {
        authenticationPrompt: promptReason,
      };

      // Asked before the secret itself: reading the entry is what triggers the
      // biometric prompt, and a split secret does not live there.
      const count = await this.partCount(key);
      if (count === null) {
        return await SecureStore.getItemAsync(key, options);
      }

      const parts: string[] = [];
      for (let index = 0; index < count; index++) {
        const part = await SecureStore.getItemAsync(chunkKey(key, index), options);

        // A missing chunk means the secret is gone, not that it is shorter than
        // advertised. Returning what did come back would hand the caller a
        // truncated private key, which the SSH engine would then fail to parse
        // with an error naming the wrong problem entirely.
        if (part === null) {
          throw new Error(`Secret "${key}" is missing part ${index + 1} of ${count}.`);
        }

        parts.push(part);
      }

      return parts.join('');
    } catch (err) {
      console.warn(`[SecureStorage] Failed to retrieve secret: ${key}`, err);
      return null;
    }
  }

  /**
   * Deletes a secret from OS Keychain / Keystore
   */
  public static async deleteSecret(key: string): Promise<void> {
    try {
      await this.clearChunks(key);
      await SecureStore.deleteItemAsync(key);
    } catch (err) {
      console.warn(`[SecureStorage] Failed to delete secret: ${key}`, err);
    }
  }

  /** How many parts a secret was split into, or null when it was not split. */
  private static async partCount(key: string): Promise<number | null> {
    const stored = await SecureStore.getItemAsync(indexKey(key), PLAIN_OPTIONS);
    if (stored === null) return null;

    const count = Number.parseInt(stored, 10);
    return Number.isInteger(count) && count > 0 ? count : null;
  }

  /** Removes the parts of a split secret, and the index that named them. */
  private static async clearChunks(key: string): Promise<void> {
    const count = await this.partCount(key);
    if (count === null) return;

    for (let index = 0; index < count; index++) {
      await SecureStore.deleteItemAsync(chunkKey(key, index));
    }

    await SecureStore.deleteItemAsync(indexKey(key));
  }

  /**
   * Checks if biometric authentication is available on this device
   */
  public static async isBiometricAvailable(): Promise<boolean> {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    return hasHardware && isEnrolled;
  }

  /**
   * Prompts user for biometric authentication
   */
  public static async promptBiometrics(promptMessage = 'Unlock SSHBond'): Promise<boolean> {
    try {
      const isAvailable = await this.isBiometricAvailable();
      if (!isAvailable) return true; // Fallback if no biometrics setup

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage,
        cancelLabel: 'Cancel',
        disableDeviceFallback: false,
      });

      return result.success;
    } catch {
      return false;
    }
  }
}

/** UTF-8 byte length of one string. */
function byteLength(value: string): number {
  // React Native has TextEncoder, but this runs on every character of a key and
  // the arithmetic is cheaper than allocating a buffer per slice.
  let bytes = 0;
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/**
 * Splits a string into pieces no larger than `limit` bytes.
 *
 * Splitting is by code point, never mid-character: a chunk cut through a
 * multi-byte character would come back as replacement characters and corrupt a
 * passphrase that happened to contain one.
 */
function splitByByteLength(value: string, limit: number): string[] {
  if (byteLength(value) <= limit) return [value];

  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;

  for (const character of value) {
    const size = byteLength(character);

    if (currentBytes + size > limit) {
      chunks.push(current);
      current = '';
      currentBytes = 0;
    }

    current += character;
    currentBytes += size;
  }

  if (current.length > 0) chunks.push(current);

  return chunks;
}
