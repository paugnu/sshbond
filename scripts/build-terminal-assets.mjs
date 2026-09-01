#!/usr/bin/env node
/**
 * Inlines xterm.js into a TypeScript module so the terminal WebView never
 * reaches out to a CDN.
 *
 * SSHBond is local-first: fetching the emulator from jsdelivr at runtime makes
 * the terminal unusable without internet (the common "SSH into a box on my
 * LAN" case) and leaks a request on every session open. Regenerate with
 * `npm run build:terminal-assets` after bumping the xterm dependency.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const sources = {
  XTERM_JS: 'node_modules/xterm/lib/xterm.js',
  XTERM_CSS: 'node_modules/xterm/css/xterm.css',
  XTERM_FIT_ADDON_JS: 'node_modules/xterm-addon-fit/lib/xterm-addon-fit.js',
};

const version = JSON.parse(readFileSync(join(root, 'node_modules/xterm/package.json'), 'utf8')).version;

const parts = [
  '// GENERATED FILE - do not edit by hand.',
  '// Produced by scripts/build-terminal-assets.mjs; run `npm run build:terminal-assets`.',
  '/* eslint-disable */',
  '',
  `export const XTERM_VERSION = ${JSON.stringify(version)};`,
  '',
];

for (const [exportName, relativePath] of Object.entries(sources)) {
  const contents = readFileSync(join(root, relativePath), 'utf8');
  parts.push(`export const ${exportName} = ${JSON.stringify(contents)};`, '');
}

const outputPath = join(root, 'src/features/terminal/xtermAssets.ts');
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, parts.join('\n'));

const kb = Math.round(Buffer.byteLength(parts.join('\n')) / 1024);
console.log(`Wrote src/features/terminal/xtermAssets.ts (xterm ${version}, ${kb} KB).`);
