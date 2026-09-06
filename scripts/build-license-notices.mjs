#!/usr/bin/env node
// Bundle exact upstream notices for offline reading. Never fetch at app runtime.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const entries = [];
const missing = [];
const seen = new Set();
for (const [relative, pkg] of Object.entries(lock.packages)) {
  if (!relative || (pkg.dev && !['node_modules/xterm', 'node_modules/xterm-addon-fit'].includes(relative))) continue;
  const dir = path.join(root, relative);
  if (!fs.existsSync(path.join(dir, 'package.json'))) continue; // optional platform package
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const name = `${manifest.name} ${manifest.version}`;
  if (seen.has(name)) continue;
  seen.add(name);
  const files = fs.readdirSync(dir).filter(f => /^(licen[cs]e|notice|copying)([.-]|$)/i.test(f) && fs.statSync(path.join(dir, f)).isFile()).sort();
  if (!files.length) {
    const upstream = /^(expo$|expo-|babel-preset-expo$)/.test(manifest.name) ? 'Expo-SDK54' :
      manifest.name.startsWith('@react-native/') ? 'ReactNative-0.81.5' :
      /^(metro$|metro-|ob1$)/.test(manifest.name) ? 'Metro-0.83.3' : null;
    if (upstream) entries.push({name, text: fs.readFileSync(path.join(root, 'third-party/native', `${upstream}.txt`), 'utf8')});
    else missing.push(name);
    continue;
  }
  entries.push({ name, text: files.map(f => `${f}\n\n${fs.readFileSync(path.join(dir, f), 'utf8')}`).join('\n\n') });
}
for (const name of fs.readdirSync(path.join(root, 'third-party/native')).filter(n=>n.endsWith('.txt')).sort()) {
  entries.push({name: name.replace(/\.txt$/, ''), text: fs.readFileSync(path.join(root, 'third-party/native', name), 'utf8')});
}
entries.push({name:'libssh2 1.11.1', text: fs.readFileSync(path.join(root, 'modules/expo-sshbond/ios/vendor/libssh2/LICENSE'),'utf8')});
entries.sort((a,b)=>a.name.localeCompare(b.name,'en'));
fs.mkdirSync(path.join(root,'src/generated'),{recursive:true});
fs.writeFileSync(path.join(root,'src/generated/licenseNotices.json'),JSON.stringify(entries));
fs.mkdirSync(path.join(root,'output/store'),{recursive:true});
fs.writeFileSync(path.join(root,'output/store/license-notices-missing.json'),JSON.stringify(missing,null,2));
console.log(`Bundled ${entries.length} notices; ${missing.length} installed package entries need manual license-file review.`);
