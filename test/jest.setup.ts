// Mock expo modules for Node/Jest environment
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
    setItemAsync: jest.fn(async (key: string, val: string) => {
      // Android refuses a value this large rather than truncating it. Failing
      // the same way here is what makes the chunking in SecureStorageService
      // testable at all.
      if (Buffer.byteLength(val, 'utf8') > 2048) {
        throw new Error(`SecureStore value for "${key}" exceeds the 2048 byte limit.`);
      }
      store.set(key, val);
    }),
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    __store: store,
  };
});

jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn(async () => true),
  isEnrolledAsync: jest.fn(async () => true),
  authenticateAsync: jest.fn(async () => ({ success: true })),
}));

jest.mock('expo-crypto', () => {
  const crypto = require('crypto');
  return {
    CryptoDigestAlgorithm: {
      SHA256: 'SHA-256',
    },
    CryptoEncoding: {
      HEX: 'hex',
    },
    getRandomBytesAsync: jest.fn(async (size: number) => {
      return new Uint8Array(crypto.randomBytes(size));
    }),
    getRandomValues: jest.fn((array: Uint8Array) => {
      const bytes = crypto.randomBytes(array.length);
      array.set(bytes);
      return array;
    }),
    digestStringAsync: jest.fn(async (_algorithm: string, data: string) => {
      return crypto.createHash('sha256').update(data).digest('hex');
    }),
  };
});

jest.mock('expo-file-system/legacy', () => {
  const files = new Map<string, string>();
  const directories = new Set<string>();

  return {
    documentDirectory: 'file:///test-documents/',
    getInfoAsync: jest.fn(async (uri: string) => ({
      exists: files.has(uri) || directories.has(uri),
      uri,
    })),
    makeDirectoryAsync: jest.fn(async (uri: string) => {
      directories.add(uri);
    }),
    readAsStringAsync: jest.fn(async (uri: string) => {
      const contents = files.get(uri);
      if (contents === undefined) throw new Error(`ENOENT: ${uri}`);
      return contents;
    }),
    writeAsStringAsync: jest.fn(async (uri: string, contents: string) => {
      files.set(uri, contents);
    }),
    moveAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
      const contents = files.get(from);
      if (contents === undefined) throw new Error(`ENOENT: ${from}`);
      files.set(to, contents);
      files.delete(from);
    }),
    deleteAsync: jest.fn(async (uri: string) => {
      files.delete(uri);
    }),
    __reset: () => {
      files.clear();
      directories.clear();
    },
  };
});

/**
 * There is no native SSH engine under Jest, which is exactly the condition that
 * makes NativeSSHBridge fall back to MockSSHBridge. Throwing from
 * `requireNativeModule` reproduces what expo-modules-core does when a module was
 * not built in, so the full connect flow (host key verification included) stays
 * testable in plain Node.
 */
jest.mock('expo-modules-core', () => ({
  requireNativeModule: jest.fn(() => {
    throw new Error("Cannot find native module 'SSHBondNative'");
  }),
  EventEmitter: class {},
}));
