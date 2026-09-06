import { SecureStorageService } from '../../src/services/secureStorage/SecureStorageService';

const SecureStoreMock = jest.requireMock('expo-secure-store') as {
  __store: Map<string, string>;
};

/** Roughly what a 4096-bit RSA private key looks like: past the 2 KB ceiling. */
function pemOfSize(bytes: number): string {
  const body = 'A'.repeat(bytes);
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${body}\n-----END OPENSSH PRIVATE KEY-----`;
}

describe('SecureStorageService', () => {
  it('refuses authentication when biometrics have been removed', async () => {
    const auth = jest.requireMock('expo-local-authentication');
    auth.isEnrolledAsync.mockResolvedValueOnce(false);
    const calls = auth.authenticateAsync.mock.calls.length;
    expect(await SecureStorageService.promptBiometrics()).toBe(false);
    expect(auth.authenticateAsync.mock.calls).toHaveLength(calls);
  });

  beforeEach(() => {
    SecureStoreMock.__store.clear();
  });

  it('stores and returns a small secret unchanged, in one entry', async () => {
    await SecureStorageService.setSecret('key_small', 'hunter2');

    expect(await SecureStorageService.getSecret('key_small')).toBe('hunter2');
    expect(Array.from(SecureStoreMock.__store.keys())).toEqual(['key_small']);
  });

  /**
   * The whole point: SecureStore refuses an oversized value outright on
   * Android, so a 4 KB key has to arrive in pieces or not at all.
   */
  it('round-trips a key far larger than the 2 KB ceiling', async () => {
    const key = pemOfSize(4000);

    await SecureStorageService.setSecret('key_rsa', key);

    expect(await SecureStorageService.getSecret('key_rsa')).toBe(key);
  });

  it('never writes a single entry over the limit', async () => {
    await SecureStorageService.setSecret('key_rsa', pemOfSize(8000));

    for (const [name, value] of SecureStoreMock.__store) {
      expect({ name, bytes: Buffer.byteLength(value, 'utf8') }).toMatchObject({
        bytes: expect.any(Number),
      });
      expect(Buffer.byteLength(value, 'utf8')).toBeLessThanOrEqual(2048);
    }
  });

  it('splits without cutting through a multi-byte character', async () => {
    // A passphrase of nothing but 4-byte characters: a split by byte offset
    // rather than by character would come back as replacement characters.
    const passphrase = '🔐'.repeat(600);

    await SecureStorageService.setSecret('key_emoji', passphrase);

    expect(await SecureStorageService.getSecret('key_emoji')).toBe(passphrase);
  });

  it('leaves no stale parts when a long secret is replaced by a short one', async () => {
    await SecureStorageService.setSecret('key_rotating', pemOfSize(6000));
    await SecureStorageService.setSecret('key_rotating', 'short');

    expect(await SecureStorageService.getSecret('key_rotating')).toBe('short');
    expect(Array.from(SecureStoreMock.__store.keys())).toEqual(['key_rotating']);
  });

  it('replaces a long secret with a shorter long one without mixing them', async () => {
    await SecureStorageService.setSecret('key_rotating', pemOfSize(8000));
    const replacement = pemOfSize(3000);
    await SecureStorageService.setSecret('key_rotating', replacement);

    expect(await SecureStorageService.getSecret('key_rotating')).toBe(replacement);
  });

  it('deletes every part of a split secret', async () => {
    await SecureStorageService.setSecret('key_rsa', pemOfSize(6000));
    await SecureStorageService.deleteSecret('key_rsa');

    expect(SecureStoreMock.__store.size).toBe(0);
    expect(await SecureStorageService.getSecret('key_rsa')).toBeNull();
  });

  /**
   * Half a private key is worse than none: the engine would report a parse
   * error naming the wrong problem, and the user would go looking at the key
   * they pasted rather than at their storage.
   */
  it('refuses to return a truncated secret when a part is missing', async () => {
    await SecureStorageService.setSecret('key_rsa', pemOfSize(6000));
    SecureStoreMock.__store.delete('key_rsa__c1');

    expect(await SecureStorageService.getSecret('key_rsa')).toBeNull();
  });

  it('still reads a secret written before splitting existed', async () => {
    // Written the old way: one plain entry, no index.
    SecureStoreMock.__store.set('key_legacy', 'written-by-an-older-build');

    expect(await SecureStorageService.getSecret('key_legacy')).toBe('written-by-an-older-build');
  });

  it('returns null for a secret that was never stored', async () => {
    expect(await SecureStorageService.getSecret('key_absent')).toBeNull();
  });
});
