#!/usr/bin/env node
/**
 * Renders the launcher icons and splash art referenced by app.json.
 *
 * app.json pointed at ./assets/*.png which did not exist, so `expo start`
 * failed before the bundler ever ran. These are drawn procedurally (a terminal
 * prompt glyph) rather than committed as opaque binaries, so the mark can be
 * tweaked in one place: `npm run build:app-icons`.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = join(root, 'assets');

const BACKGROUND = [0x0d, 0x11, 0x17, 0xff];
const ACCENT = [0x2f, 0x81, 0xf7, 0xff];
const FOREGROUND = [0xf0, 0xf6, 0xfc, 0xff];
const TRANSPARENT = [0, 0, 0, 0];

/** Minimal RGBA PNG encoder (filter type 0, single IDAT). */
function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0; // filter: none
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typeAndData) >>> 0);
    return Buffer.concat([length, typeAndData, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

/**
 * The mark: a chevron and an underscore, i.e. a shell prompt. `scale` is the
 * glyph size relative to the canvas; `inset` shrinks it for Android's adaptive
 * icon safe zone.
 */
function markCoverage(nx, ny, scale) {
  const stroke = 0.1;

  // Offsets that centre the combined bounding box of the two strokes on the
  // canvas; without them the mark sits visibly high and to the left.
  const CENTER_X = 0.05;
  const CENTER_Y = 0.045;

  // Work in a centred space scaled to the glyph size.
  const x = (nx - 0.5) / scale + CENTER_X;
  const y = (ny - 0.5) / scale + CENTER_Y;

  // Chevron ">": two segments meeting on the right.
  const chevron =
    segmentDistance(x, y, -0.38, -0.38, 0.14, 0) < stroke ||
    segmentDistance(x, y, -0.38, 0.38, 0.14, 0) < stroke;

  // Underscore, sitting on the prompt baseline.
  const underscore = segmentDistance(x, y, 0.0, 0.46, 0.5, 0.46) < stroke;

  return { chevron, underscore };
}

function segmentDistance(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  let t = lengthSquared === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function render(size, { background, glyphScale, rounded }) {
  const rgba = Buffer.alloc(size * size * 4);
  const samples = 3; // supersampling for smooth edges

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let chevronHits = 0;
      let underscoreHits = 0;
      let insideHits = 0;

      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const nx = (x + (sx + 0.5) / samples) / size;
          const ny = (y + (sy + 0.5) / samples) / size;

          if (rounded && !insideRoundedSquare(nx, ny, 0.22)) continue;
          insideHits++;

          const { chevron, underscore } = markCoverage(nx, ny, glyphScale);
          if (chevron) chevronHits++;
          if (underscore) underscoreHits++;
        }
      }

      const total = samples * samples;
      const inside = insideHits / total;
      const chevronAlpha = chevronHits / total;
      const underscoreAlpha = underscoreHits / total;

      let pixel = background === 'transparent' ? TRANSPARENT : BACKGROUND;
      if (background !== 'transparent') {
        pixel = blend(TRANSPARENT, BACKGROUND, inside);
      }

      pixel = blend(pixel, ACCENT, chevronAlpha);
      pixel = blend(pixel, FOREGROUND, underscoreAlpha);

      const offset = (y * size + x) * 4;
      rgba[offset] = pixel[0];
      rgba[offset + 1] = pixel[1];
      rgba[offset + 2] = pixel[2];
      rgba[offset + 3] = pixel[3];
    }
  }

  return encodePng(size, size, rgba);
}

/** Squircle-ish rounded square covering the whole canvas. */
function insideRoundedSquare(nx, ny, radius) {
  const x = Math.abs(nx - 0.5) * 2;
  const y = Math.abs(ny - 0.5) * 2;
  const limit = 1 - radius * 2;

  if (x <= limit || y <= limit) return x <= 1 && y <= 1;
  const dx = x - limit;
  const dy = y - limit;
  return Math.hypot(dx, dy) <= radius * 2;
}

function blend(base, overlay, alpha) {
  if (alpha <= 0) return base;
  if (alpha >= 1) return overlay;

  const outAlpha = overlay[3] * alpha + base[3] * (1 - alpha);
  if (outAlpha === 0) return TRANSPARENT;

  return [
    Math.round((overlay[0] * overlay[3] * alpha + base[0] * base[3] * (1 - alpha)) / outAlpha),
    Math.round((overlay[1] * overlay[3] * alpha + base[1] * base[3] * (1 - alpha)) / outAlpha),
    Math.round((overlay[2] * overlay[3] * alpha + base[2] * base[3] * (1 - alpha)) / outAlpha),
    Math.round(outAlpha),
  ];
}

mkdirSync(assetsDir, { recursive: true });

const outputs = [
  // Store/launcher icon: opaque, full bleed.
  ['icon.png', render(1024, { background: 'solid', glyphScale: 0.56, rounded: false })],
  // Android adaptive foreground: transparent, glyph inside the 66% safe zone.
  ['adaptive-icon.png', render(1024, { background: 'transparent', glyphScale: 0.4, rounded: false })],
  // Splash art: contain-fitted over the configured background colour.
  ['splash.png', render(1024, { background: 'transparent', glyphScale: 0.5, rounded: false })],
  // Web favicon.
  ['favicon.png', render(64, { background: 'solid', glyphScale: 0.6, rounded: true })],
];

for (const [name, buffer] of outputs) {
  writeFileSync(join(assetsDir, name), buffer);
  console.log(`assets/${name} (${Math.round(buffer.length / 1024)} KB)`);
}
