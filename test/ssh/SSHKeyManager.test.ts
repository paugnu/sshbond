import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SSHKeyManager } from '../../src/services/ssh/keys/SSHKeyManager';

/**
 * These tests shell out to the real `ssh-keygen`. A key SSHBond generates is
 * worthless unless OpenSSH itself accepts it, so interoperability is asserted
 * against the reference implementation rather than against our own encoder.
 */
function hasSSHKeygen(): boolean {
  try {
    execFileSync('which', ['ssh-keygen'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const describeInterop = hasSSHKeygen() ? describe : describe.skip;

describe('SSHKeyManager', () => {
  it('generates an Ed25519 identity with an OpenSSH public key and armoured private key', async () => {
    const keyPair = await SSHKeyManager.generateKeyPair({
      name: 'id_ed25519',
      algorithm: 'ed25519',
      comment: 'pau@iphone',
    });

    expect(keyPair.identity.algorithm).toBe('ed25519');
    expect(keyPair.identity.hasPassphrase).toBe(false);
    expect(keyPair.publicKey).toMatch(/^ssh-ed25519 [A-Za-z0-9+/=]+ pau@iphone$/);
    expect(keyPair.identity.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
    expect(keyPair.privateKey).toContain('-----BEGIN OPENSSH PRIVATE KEY-----');
    expect(keyPair.privateKey).toContain('-----END OPENSSH PRIVATE KEY-----');
  });

  it('produces distinct key material on every generation', async () => {
    const a = await SSHKeyManager.generateKeyPair({ name: 'a', algorithm: 'ed25519' });
    const b = await SSHKeyManager.generateKeyPair({ name: 'b', algorithm: 'ed25519' });
    expect(a.publicKey).not.toBe(b.publicKey);
    expect(a.privateKey).not.toBe(b.privateKey);
  });

  it('refuses to generate algorithms it cannot generate for real', async () => {
    await expect(
      SSHKeyManager.generateKeyPair({ name: 'k', algorithm: 'rsa' })
    ).rejects.toThrow(/not supported/i);

    await expect(
      SSHKeyManager.generateKeyPair({ name: 'k', algorithm: 'ecdsa' })
    ).rejects.toThrow(/not supported/i);
  });

  it('parses an OpenSSH public key and rejects a corrupted one', () => {
    const parsed = SSHKeyManager.parsePublicKey(
      'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHBtaWi4z747+dSNN12RmWyjHSSeJ73H7B4h6bpkHddf pau@work'
    );

    expect(parsed.algorithm).toBe('ed25519');
    expect(parsed.keyType).toBe('ssh-ed25519');
    expect(parsed.comment).toBe('pau@work');
    expect(parsed.fingerprint).toMatch(/^SHA256:/);

    expect(() =>
      SSHKeyManager.parsePublicKey(
        'ssh-rsa AAAAC3NzaC1lZDI1NTE5AAAAIHBtaWi4z747+dSNN12RmWyjHSSeJ73H7B4h6bpkHddf x'
      )
    ).toThrow(/does not match/i);

    expect(() => SSHKeyManager.parsePublicKey('not-a-key')).toThrow(/Invalid OpenSSH public key/);
  });

  it('recovers the public key and fingerprint from a generated private key', async () => {
    const keyPair = await SSHKeyManager.generateKeyPair({
      name: 'id_ed25519',
      algorithm: 'ed25519',
      comment: 'roundtrip@sshbond',
    });

    const parsed = SSHKeyManager.parsePrivateKey(keyPair.privateKey);

    expect(parsed.isEncrypted).toBe(false);
    expect(parsed.algorithm).toBe('ed25519');
    expect(parsed.comment).toBe('roundtrip@sshbond');
    expect(parsed.publicKey).toBe(keyPair.publicKey);
    expect(parsed.fingerprint).toBe(keyPair.identity.fingerprint);
  });

  it('classifies legacy PEM private keys and rejects junk', () => {
    expect(
      SSHKeyManager.parsePrivateKey('-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----')
    ).toMatchObject({ algorithm: 'rsa', isEncrypted: false });

    expect(
      SSHKeyManager.parsePrivateKey(
        '-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nAAAA\n-----END RSA PRIVATE KEY-----'
      )
    ).toMatchObject({ algorithm: 'rsa', isEncrypted: true });

    expect(() => SSHKeyManager.parsePrivateKey('hello world')).toThrow(/Unrecognised private key/);
  });
});

describeInterop('SSHKeyManager <-> OpenSSH interoperability', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sshbond-keys-'));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('generates a private key that ssh-keygen can load and derive the public key from', async () => {
    const keyPair = await SSHKeyManager.generateKeyPair({
      name: 'id_ed25519',
      algorithm: 'ed25519',
      comment: 'interop@sshbond',
    });

    const keyPath = path.join(tmpDir, 'id_ed25519');
    fs.writeFileSync(keyPath, `${keyPair.privateKey}\n`, { mode: 0o600 });

    const derived = execFileSync('ssh-keygen', ['-y', '-f', keyPath]).toString().trim();

    // ssh-keygen only gets this far if the openssh-key-v1 framing is byte-exact.
    expect(derived).toBe(keyPair.publicKey);
  });

  it('reports the same SHA256 fingerprint as ssh-keygen -l', async () => {
    const keyPair = await SSHKeyManager.generateKeyPair({
      name: 'id_ed25519',
      algorithm: 'ed25519',
      comment: 'fingerprint@sshbond',
    });

    const pubPath = path.join(tmpDir, 'fp.pub');
    fs.writeFileSync(pubPath, `${keyPair.publicKey}\n`);

    const output = execFileSync('ssh-keygen', ['-l', '-f', pubPath]).toString().trim();
    const referenceFingerprint = output.split(/\s+/)[1];

    expect(keyPair.identity.fingerprint).toBe(referenceFingerprint);
  });

  it('parses a private key produced by ssh-keygen itself', () => {
    const keyPath = path.join(tmpDir, 'from_keygen');
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', 'made@by-keygen', '-f', keyPath]);

    const parsed = SSHKeyManager.parsePrivateKey(fs.readFileSync(keyPath, 'utf8'));
    const referencePublic = fs.readFileSync(`${keyPath}.pub`, 'utf8').trim();

    expect(parsed.algorithm).toBe('ed25519');
    expect(parsed.isEncrypted).toBe(false);
    expect(parsed.comment).toBe('made@by-keygen');
    expect(parsed.publicKey).toBe(referencePublic);
    expect(parsed.fingerprint).toBe(SSHKeyManager.calculateFingerprint(referencePublic));
  });

  it('detects a passphrase-protected key without being able to read it', () => {
    const keyPath = path.join(tmpDir, 'encrypted_key');
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', 'hunter2', '-f', keyPath]);

    const parsed = SSHKeyManager.parsePrivateKey(fs.readFileSync(keyPath, 'utf8'));

    expect(parsed.isEncrypted).toBe(true);
    expect(parsed.algorithm).toBe('ed25519');
  });
});
