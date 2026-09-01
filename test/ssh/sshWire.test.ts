import {
  SSHWireReader,
  SSHWireWriter,
  base64ToBytes,
  bytesToBase64,
  utf8Decode,
  utf8Encode,
} from '../../src/services/ssh/keys/sshWire';

describe('SSH wire encoding', () => {
  it('round-trips raw bytes, uint32 and length-prefixed strings in order', () => {
    const bytes = new SSHWireWriter()
      .writeRaw(new Uint8Array([0xde, 0xad]))
      .writeUint32(0xcafebabe)
      .writeString('ssh-ed25519')
      .writeString(new Uint8Array([1, 2, 3]))
      .toBytes();

    const reader = new SSHWireReader(bytes);
    expect(Array.from(reader.readRaw(2))).toEqual([0xde, 0xad]);
    expect(reader.readUint32()).toBe(0xcafebabe);
    expect(reader.readStringUtf8()).toBe('ssh-ed25519');
    expect(Array.from(reader.readString())).toEqual([1, 2, 3]);
    expect(reader.remaining).toBe(0);
  });

  it('rejects a truncated blob instead of returning silent garbage', () => {
    const reader = new SSHWireReader(new Uint8Array([0, 0, 0, 10, 1, 2]));
    expect(() => reader.readString()).toThrow(/unexpected end of data/i);
  });

  it('writes a uint32 big-endian, as RFC 4251 requires', () => {
    const bytes = new SSHWireWriter().writeUint32(1).toBytes();
    expect(Array.from(bytes)).toEqual([0, 0, 0, 1]);
  });
});

describe('base64 without btoa/atob', () => {
  it.each([0, 1, 2, 3, 4, 5, 31, 32, 64, 255])('round-trips %i bytes', length => {
    const input = new Uint8Array(length);
    for (let i = 0; i < length; i++) input[i] = (i * 37) % 256;

    const encoded = bytesToBase64(input);
    expect(encoded).toBe(Buffer.from(input).toString('base64'));
    expect(Array.from(base64ToBytes(encoded))).toEqual(Array.from(input));
  });

  it('tolerates the line breaks found in PEM armour', () => {
    const input = new Uint8Array(120).fill(0xab);
    const wrapped = bytesToBase64(input).replace(/(.{20})/g, '$1\n');

    expect(Array.from(base64ToBytes(wrapped))).toEqual(Array.from(input));
  });
});

describe('utf8 helpers', () => {
  it.each(['', 'ascii', 'ünïcödé', 'キー', 'emoji 🔐 comment'])('round-trips %s', value => {
    expect(utf8Decode(utf8Encode(value))).toBe(value);
  });

  it('encodes the same bytes Node does', () => {
    const value = 'pau@iphone 🔐';
    expect(Array.from(utf8Encode(value))).toEqual(Array.from(Buffer.from(value, 'utf8')));
  });
});
