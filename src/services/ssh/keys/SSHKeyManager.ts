import { sha256 } from '@noble/hashes/sha256';
import { ed25519 } from '@/services/crypto/ed25519Bootstrap';
import { secureRandomBytes } from '@/services/crypto/randomBytes';
import { SSHIdentity, SSHKeyAlgorithm } from '@/domain/models/sshConfig';
import {
  SSHWireReader,
  SSHWireWriter,
  base64ToBytes,
  bytesToBase64,
  utf8Encode,
} from './sshWire';

export interface GenerateKeyOptions {
  name: string;
  algorithm: SSHKeyAlgorithm;
  comment?: string;
  /** Gate the stored private key behind Face ID / fingerprint. */
  requireBiometrics?: boolean;
}

export interface GeneratedKeyPair {
  identity: SSHIdentity;
  privateKey: string;
  publicKey: string;
}

export interface ParsedPublicKey {
  algorithm: SSHKeyAlgorithm;
  keyType: string;
  fingerprint: string;
  comment?: string;
}

export interface ParsedPrivateKey {
  algorithm: SSHKeyAlgorithm;
  keyType: string;
  isEncrypted: boolean;
  /** Present only for unencrypted OpenSSH keys we can fully decode. */
  publicKey?: string;
  fingerprint?: string;
  comment?: string;
}

const OPENSSH_AUTH_MAGIC = 'openssh-key-v1\0';
const OPENSSH_PEM_HEADER = '-----BEGIN OPENSSH PRIVATE KEY-----';
const OPENSSH_PEM_FOOTER = '-----END OPENSSH PRIVATE KEY-----';

/**
 * Algorithms SSHBond can generate on device. RSA and ECDSA are deliberately
 * absent: there is no audited pure-JS keygen for them in the dependency set,
 * and emitting a placeholder would hand the user a key that no server accepts.
 * Both remain fully supported for *import*.
 */
export const GENERATABLE_ALGORITHMS: SSHKeyAlgorithm[] = ['ed25519'];

export class SSHKeyManager {
  public static async generateKeyPair(options: GenerateKeyOptions): Promise<GeneratedKeyPair> {
    if (!GENERATABLE_ALGORITHMS.includes(options.algorithm)) {
      throw new Error(
        `On-device generation of ${options.algorithm.toUpperCase()} keys is not supported. ` +
          `Generate it with "ssh-keygen -t ${options.algorithm}" and import it instead.`
      );
    }

    const id = `id_${Date.now()}_${randomSuffix()}`;
    const comment = options.comment?.trim() || `${options.name}@sshbond`;

    return this.generateEd25519KeyPair(id, options.name, comment, options.requireBiometrics);
  }

  private static async generateEd25519KeyPair(
    id: string,
    name: string,
    comment: string,
    requireBiometrics?: boolean
  ): Promise<GeneratedKeyPair> {
    const seed = secureRandomBytes(32);
    const publicKeyBytes = ed25519.getPublicKey(seed);

    const publicBlob = encodeEd25519PublicBlob(publicKeyBytes);
    const publicKey = formatAuthorizedKey('ssh-ed25519', publicBlob, comment);
    const fingerprint = fingerprintFromBlob(publicBlob);
    const privateKey = encodeOpenSSHPrivateKey(seed, publicKeyBytes, comment);

    const identity: SSHIdentity = {
      id,
      name,
      algorithm: 'ed25519',
      publicKey,
      privateKeySecureReference: `ssh_key_${id}`,
      fingerprint,
      comment,
      hasPassphrase: false,
      requiresBiometrics: Boolean(requireBiometrics),
      createdAt: new Date().toISOString(),
    };

    return { identity, privateKey, publicKey };
  }

  /**
   * SHA256 fingerprint of a public key, in the format `ssh-keygen -l` prints.
   *
   * Accepts either the raw key blob or a full `ssh-ed25519 AAAA... comment`
   * line. The digest is taken over the raw blob bytes -- hashing a textual
   * representation of those bytes yields a plausible-looking but wrong
   * fingerprint that never matches what the server or ssh-keygen reports.
   */
  public static calculateFingerprint(publicKey: Uint8Array | string): string {
    const blob = typeof publicKey === 'string' ? extractKeyBlob(publicKey) : publicKey;
    return fingerprintFromBlob(blob);
  }

  public static parsePublicKey(rawKey: string): ParsedPublicKey {
    const trimmed = rawKey.trim();
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) {
      throw new Error('Invalid OpenSSH public key: expected "<type> <base64> [comment]".');
    }

    const declaredType = parts[0];
    const blob = base64ToBytes(parts[1]);
    const comment = parts.slice(2).join(' ') || undefined;

    // The type is encoded inside the blob too; a mismatch means a corrupt or
    // hand-edited key, which is worth surfacing rather than silently trusting.
    const embeddedType = new SSHWireReader(blob).readStringUtf8();
    if (embeddedType !== declaredType) {
      throw new Error(
        `Corrupt public key: declared type "${declaredType}" does not match embedded type "${embeddedType}".`
      );
    }

    return {
      algorithm: algorithmFromKeyType(embeddedType),
      keyType: embeddedType,
      fingerprint: fingerprintFromBlob(blob),
      comment,
    };
  }

  /**
   * Inspects a pasted private key. For unencrypted OpenSSH keys the public key
   * and fingerprint are recovered from the file itself, so an import does not
   * depend on the user also pasting the matching `.pub`.
   */
  public static parsePrivateKey(rawKey: string): ParsedPrivateKey {
    const text = rawKey.trim();

    if (text.includes(OPENSSH_PEM_HEADER)) {
      return parseOpenSSHPrivateKey(text);
    }

    // Legacy PEM (PKCS#1 / SEC1 / PKCS#8). We can classify it, but decoding it
    // is the native engine's job at authentication time.
    const isEncrypted = /Proc-Type:\s*4,ENCRYPTED/i.test(text) || text.includes('ENCRYPTED PRIVATE KEY');

    if (/BEGIN RSA PRIVATE KEY/.test(text)) {
      return { algorithm: 'rsa', keyType: 'ssh-rsa', isEncrypted };
    }
    if (/BEGIN EC PRIVATE KEY/.test(text)) {
      return { algorithm: 'ecdsa', keyType: 'ecdsa-sha2-nistp256', isEncrypted };
    }
    if (/BEGIN (ENCRYPTED )?PRIVATE KEY/.test(text)) {
      // PKCS#8 does not name the algorithm in the armour.
      return { algorithm: 'rsa', keyType: 'unknown', isEncrypted };
    }

    throw new Error('Unrecognised private key format. Expected an OpenSSH or PEM private key.');
  }

  public static bytesToBase64 = bytesToBase64;
  public static base64ToBytes = base64ToBytes;
}

function parseOpenSSHPrivateKey(text: string): ParsedPrivateKey {
  const start = text.indexOf(OPENSSH_PEM_HEADER);
  const end = text.indexOf(OPENSSH_PEM_FOOTER);
  if (start < 0 || end < 0) {
    throw new Error('Truncated OpenSSH private key: missing BEGIN/END armour.');
  }

  const body = text.slice(start + OPENSSH_PEM_HEADER.length, end);
  const bytes = base64ToBytes(body);
  const reader = new SSHWireReader(bytes);

  const magic = reader.readRaw(OPENSSH_AUTH_MAGIC.length);
  if (bytesToBase64(magic) !== bytesToBase64(utf8Encode(OPENSSH_AUTH_MAGIC))) {
    throw new Error('Not an OpenSSH private key: bad auth magic.');
  }

  const cipherName = reader.readStringUtf8();
  reader.readStringUtf8(); // kdfname
  reader.readString(); // kdfoptions
  reader.readUint32(); // number of keys
  const publicBlob = reader.readString();

  const keyType = new SSHWireReader(publicBlob).readStringUtf8();
  const algorithm = algorithmFromKeyType(keyType);
  const isEncrypted = cipherName !== 'none';

  const base: ParsedPrivateKey = {
    algorithm,
    keyType,
    isEncrypted,
    publicKey: formatAuthorizedKey(keyType, publicBlob, ''),
    fingerprint: fingerprintFromBlob(publicBlob),
  };

  if (isEncrypted) {
    // The comment lives inside the encrypted section; nothing more to read.
    return base;
  }

  try {
    const privateSection = new SSHWireReader(reader.readString());
    const check1 = privateSection.readUint32();
    const check2 = privateSection.readUint32();
    if (check1 !== check2) {
      throw new Error('Private key checksum mismatch (wrong passphrase or corrupt file).');
    }
    privateSection.readStringUtf8(); // key type, repeated
    privateSection.readString(); // public part, repeated
    privateSection.readString(); // private part
    const comment = privateSection.readStringUtf8() || undefined;
    return { ...base, comment, publicKey: formatAuthorizedKey(keyType, publicBlob, comment ?? '') };
  } catch {
    // A readable public half is still useful even if the private section uses
    // an encoding we do not model; fall back to what we already decoded.
    return base;
  }
}

function encodeEd25519PublicBlob(publicKeyBytes: Uint8Array): Uint8Array {
  return new SSHWireWriter().writeString('ssh-ed25519').writeString(publicKeyBytes).toBytes();
}

/**
 * Encodes an unencrypted `openssh-key-v1` file.
 *
 * Layout (PROTOCOL.key): the auth magic is raw bytes and the key count is a
 * raw uint32 -- both are *not* length-prefixed strings, unlike every other
 * field. The same applies to the two checkints inside the private section.
 */
function encodeOpenSSHPrivateKey(seed: Uint8Array, publicKeyBytes: Uint8Array, comment: string): string {
  const publicBlob = encodeEd25519PublicBlob(publicKeyBytes);

  // ed25519 "private key" in the OpenSSH blob is seed || public key.
  const privateScalar = new Uint8Array(64);
  privateScalar.set(seed, 0);
  privateScalar.set(publicKeyBytes, 32);

  const checkInt = new DataView(secureRandomBytes(4).buffer).getUint32(0, false);

  const privateSection = new SSHWireWriter()
    .writeUint32(checkInt)
    .writeUint32(checkInt)
    .writeString('ssh-ed25519')
    .writeString(publicKeyBytes)
    .writeString(privateScalar)
    .writeString(comment)
    .toBytes();

  // Pad to the cipher block size (8 for "none") with 1, 2, 3, ...
  const padLength = (8 - (privateSection.length % 8)) % 8;
  const padded = new Uint8Array(privateSection.length + padLength);
  padded.set(privateSection, 0);
  for (let i = 0; i < padLength; i++) {
    padded[privateSection.length + i] = i + 1;
  }

  const payload = new SSHWireWriter()
    .writeRaw(utf8Encode(OPENSSH_AUTH_MAGIC))
    .writeString('none') // ciphername
    .writeString('none') // kdfname
    .writeString('') // kdfoptions
    .writeUint32(1) // number of keys
    .writeString(publicBlob)
    .writeString(padded)
    .toBytes();

  const base64 = bytesToBase64(payload);
  const lines = [OPENSSH_PEM_HEADER];
  for (let i = 0; i < base64.length; i += 70) {
    lines.push(base64.slice(i, i + 70));
  }
  lines.push(OPENSSH_PEM_FOOTER);
  return lines.join('\n');
}

function fingerprintFromBlob(blob: Uint8Array): string {
  // ssh-keygen prints unpadded base64 of the raw SHA256 digest.
  return `SHA256:${bytesToBase64(sha256(blob)).replace(/=+$/, '')}`;
}

function extractKeyBlob(publicKey: string): Uint8Array {
  const parts = publicKey.trim().split(/\s+/);
  return base64ToBytes(parts.length >= 2 ? parts[1] : parts[0]);
}

function formatAuthorizedKey(keyType: string, blob: Uint8Array, comment: string): string {
  return `${keyType} ${bytesToBase64(blob)}${comment ? ` ${comment}` : ''}`;
}

function algorithmFromKeyType(keyType: string): SSHKeyAlgorithm {
  if (keyType.includes('ed25519')) return 'ed25519';
  if (keyType.includes('ecdsa')) return 'ecdsa';
  if (keyType.includes('rsa') || keyType.includes('dss')) return 'rsa';
  throw new Error(`Unsupported SSH key type: ${keyType}`);
}

function randomSuffix(): string {
  return Array.from(secureRandomBytes(4))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
