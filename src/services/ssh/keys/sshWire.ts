/**
 * RFC 4251 §5 binary encoding helpers ("SSH wire format").
 *
 * OpenSSH key blobs mix raw bytes, raw uint32 and length-prefixed strings.
 * Conflating the three is what produces files that `ssh-keygen` rejects with
 * "error in libcrypto", so the distinction is made explicit here.
 */
export class SSHWireWriter {
  private chunks: Uint8Array[] = [];

  /** Raw bytes, with no length prefix. */
  public writeRaw(bytes: Uint8Array): this {
    this.chunks.push(bytes);
    return this;
  }

  /** Raw big-endian uint32, with no length prefix. */
  public writeUint32(value: number): this {
    const buf = new Uint8Array(4);
    new DataView(buf.buffer).setUint32(0, value >>> 0, false);
    this.chunks.push(buf);
    return this;
  }

  /** Length-prefixed byte string (uint32 length followed by the payload). */
  public writeString(value: Uint8Array | string): this {
    const bytes = typeof value === 'string' ? utf8Encode(value) : value;
    this.writeUint32(bytes.length);
    this.chunks.push(bytes);
    return this;
  }

  public toBytes(): Uint8Array {
    const total = this.chunks.reduce((sum, c) => sum + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

export class SSHWireReader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  public get remaining(): number {
    return this.bytes.length - this.offset;
  }

  public readRaw(length: number): Uint8Array {
    if (length < 0 || this.remaining < length) {
      throw new Error('Malformed SSH blob: unexpected end of data.');
    }
    const slice = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }

  public readUint32(): number {
    const raw = this.readRaw(4);
    return new DataView(raw.buffer, raw.byteOffset, 4).getUint32(0, false);
  }

  public readString(): Uint8Array {
    const length = this.readUint32();
    return this.readRaw(length);
  }

  public readStringUtf8(): string {
    return utf8Decode(this.readString());
  }
}

export function utf8Encode(value: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < value.length; i++) {
    let code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    }
  }
  return new Uint8Array(out);
}

export function utf8Decode(bytes: Uint8Array): string {
  let result = '';
  let i = 0;
  while (i < bytes.length) {
    const byte = bytes[i];
    let code: number;
    if (byte < 0x80) {
      code = byte;
      i += 1;
    } else if (byte >= 0xc0 && byte < 0xe0) {
      code = ((byte & 0x1f) << 6) | (bytes[i + 1] & 0x3f);
      i += 2;
    } else if (byte >= 0xe0 && byte < 0xf0) {
      code = ((byte & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f);
      i += 3;
    } else {
      code =
        ((byte & 0x07) << 18) |
        ((bytes[i + 1] & 0x3f) << 12) |
        ((bytes[i + 2] & 0x3f) << 6) |
        (bytes[i + 3] & 0x3f);
      i += 4;
    }
    if (code > 0xffff) {
      code -= 0x10000;
      result += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
    } else {
      result += String.fromCharCode(code);
    }
  }
  return result;
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 encoder that does not rely on `btoa` (absent on some RN runtimes). */
export function bytesToBase64(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    result += BASE64_ALPHABET[b0 >> 2];
    result += BASE64_ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    result += i + 1 < bytes.length ? BASE64_ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)] : '=';
    result += i + 2 < bytes.length ? BASE64_ALPHABET[b2 & 0x3f] : '=';
  }
  return result;
}

/** Base64 decoder that does not rely on `atob`, tolerant of whitespace. */
export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let outIndex = 0;
  let buffer = 0;
  let bits = 0;

  for (let i = 0; i < clean.length; i++) {
    const value = BASE64_ALPHABET.indexOf(clean[i]);
    if (value < 0) throw new Error('Invalid base64 input.');
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[outIndex++] = (buffer >> bits) & 0xff;
    }
  }

  return out.subarray(0, outIndex);
}
