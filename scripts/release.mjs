#!/usr/bin/env node
// Setzt eine neue Version in Server, Web und Android, committet und legt den Git-Tag an.
//
//   node scripts/release.mjs 0.2.0          # nur lokal
//   node scripts/release.mjs 0.2.0 --push   # zusätzlich pushen → GitHub baut das Image 0.2.0
//
// Die Android-versionCode wird bei jedem Release um 1 erhöht.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [version, ...flags] = process.argv.slice(2);
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Aufruf: node scripts/release.mjs X.Y.Z [--push]');
  process.exit(1);
}
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

if (git('status', '--porcelain')) {
  console.error('Es gibt nicht committete Änderungen – bitte erst committen.');
  process.exit(1);
}
if (git('tag', '--list', `v${version}`)) {
  console.error(`Tag v${version} gibt es schon.`);
  process.exit(1);
}

const file = (p) => join(root, p);
const setJsonVersion = (p, lock = false) => {
  const j = JSON.parse(readFileSync(file(p), 'utf8'));
  j.version = version;
  if (lock && j.packages?.['']) j.packages[''].version = version;
  writeFileSync(file(p), JSON.stringify(j, null, 2) + '\n');
};
setJsonVersion('server/package.json');
setJsonVersion('server/package-lock.json', true);
setJsonVersion('web/package.json');
setJsonVersion('web/package-lock.json', true);

const gradle = 'android/app/build.gradle.kts';
let g = readFileSync(file(gradle), 'utf8');
const code = Number(g.match(/versionCode = (\d+)/)[1]) + 1;
g = g.replace(/versionCode = \d+/, `versionCode = ${code}`).replace(/versionName = "[^"]+"/, `versionName = "${version}"`);
writeFileSync(file(gradle), g);

git('add', 'server/package.json', 'server/package-lock.json', 'web/package.json', 'web/package-lock.json', gradle);
git('commit', '-m', `Version ${version}`);
git('tag', '-a', `v${version}`, '-m', `Version ${version}`);
console.log(`Version ${version} (Android versionCode ${code}) committet und als v${version} getaggt.`);

if (flags.includes('--push')) {
  git('push');
  git('push', 'origin', `v${version}`);
  console.log(`Gepusht – GitHub baut jetzt ghcr.io/kuehnert/meterbook:${version}`);
} else {
  console.log(`Zum Veröffentlichen: git push && git push origin v${version}`);
}
