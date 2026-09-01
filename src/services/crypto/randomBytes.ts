import * as Crypto from 'expo-crypto';

/**
 * Cryptographically secure random bytes.
 *
 * React Native (Hermes) has no `crypto.subtle` and, depending on the runtime,
 * may not expose a global `crypto.getRandomValues` either. expo-crypto is
 * backed by the platform CSPRNG (SecRandomCopyBytes / SecureRandom), so it is
 * the only source we trust for key material.
 */
export function secureRandomBytes(length: number): Uint8Array {
  return Crypto.getRandomValues(new Uint8Array(length));
}
