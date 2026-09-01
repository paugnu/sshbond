import * as ed25519 from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { secureRandomBytes } from './randomBytes';

/**
 * @noble/ed25519 v2 delegates hashing to WebCrypto (`crypto.subtle`) and
 * randomness to `crypto.getRandomValues`. Neither exists on Hermes, so every
 * key operation would throw at runtime on device even though it works under
 * Node in tests. Wiring pure-JS SHA-512 and the platform CSPRNG makes the
 * module behave identically on iOS, Android and Jest.
 *
 * Importing this module has the side effect of installing those hooks; it is
 * imported for effect by SSHKeyManager and is safe to import repeatedly.
 */
let installed = false;

export function installEd25519Hooks(): void {
  if (installed) return;

  ed25519.etc.sha512Sync = (...messages: Uint8Array[]) =>
    sha512(ed25519.etc.concatBytes(...messages));

  ed25519.etc.sha512Async = async (...messages: Uint8Array[]) =>
    sha512(ed25519.etc.concatBytes(...messages));

  ed25519.etc.randomBytes = (length = 32) => secureRandomBytes(length);

  installed = true;
}

installEd25519Hooks();

export { ed25519 };
