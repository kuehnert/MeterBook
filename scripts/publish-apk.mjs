#!/usr/bin/env node
// Lädt die Android-App in den MeterBook-Store (RustFS, MinIO, Cloudflare R2 oder ein anderer
// S3-Speicher), aus dem kuehnert.online/meterbook den Download anbietet.
//
//   node scripts/publish-apk.mjs [X.Y.Z] [--env DATEI] [--setup] [--dry-run]
//
// Ohne Version gilt die versionName aus android/app/build.gradle.kts. Hochgeladen wird
// apk/meterbook-X.Y.Z.apk (das baut ./gradlew assembleRelease) als
//   downloads/MeterBook-X.Y.Z.apk   die App
//   releases/X.Y.Z.json             was zu dieser Version gehört
//   releases/latest.json            die neueste, die die Seite liest
// --setup legt vorher den Bucket an und erlaubt anonymes Lesen (einmalig nötig).
// --dry-run zeigt nur, was hochgeladen würde.
//
// assembleRelease ruft das Skript nach dem Bauen selbst auf, sobald es Zugangsdaten findet.
//
// Zugangsdaten: scripts/apk-store.env (nicht eingecheckt), --env DATEI oder METERBOOK_STORE_ENV,
// einzelne Werte auch aus der Umgebung:
//   STORE_ENDPOINT=http://192.168.168.2:9000   STORE_BUCKET=meterbook   STORE_REGION=auto
//   STORE_ACCESS_KEY=...                       STORE_SECRET_KEY=...
//   STORE_PREFIX=                              (optional: Ordner im Bucket)
// Statt STORE_ENDPOINT/_ACCESS_KEY/_SECRET_KEY/_REGION gehen auch die ART_*-Namen aus
// Dungeon Remasters art_store.env; den Bucket nimmt das Skript aber nie von dort (Standard: meterbook).
// Braucht Node 18 oder neuer, keine Pakete.
//
// Version: 2026-11-10

import { createHash, createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const fail = (message) => {
  console.error(`publish-apk: ${message}`);
  process.exit(1);
};

const gradle = readFileSync(join(root, 'android/app/build.gradle.kts'), 'utf8');
const version = args.find((a, i) => /^\d+\.\d+\.\d+$/.test(a) && args[i - 1] !== '--env') ?? gradle.match(/versionName = "([^"]+)"/)?.[1];
if (!version) fail('Keine Version gefunden.');

const apkFile = join(root, 'apk', `meterbook-${version}.apk`);
if (!existsSync(apkFile)) fail(`${apkFile} fehlt – erst "./gradlew assembleRelease" in android/.`);
const apk = readFileSync(apkFile);

// ---- Zugangsdaten ---------------------------------------------------------------------------

const envFile = option('--env') ?? process.env.METERBOOK_STORE_ENV ?? join(root, 'scripts', 'apk-store.env');
const values = {};
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const at = line.indexOf('=');
    if (at > 0 && !line.startsWith('#')) values[line.slice(0, at).trim()] = line.slice(at + 1).trim().replace(/^["']|["']$/g, '');
  }
}
const get = (names, fallback) => {
  for (const name of names) {
    const value = process.env[name] ?? values[name];
    if (value) return value;
  }
  if (fallback !== undefined) return fallback;
  fail(`${names[0]} fehlt. In ${envFile} oder in die Umgebung schreiben.`);
};
const config = {
  endpoint: get(['STORE_ENDPOINT', 'ART_ENDPOINT']).replace(/\/+$/, ''),
  bucket: get(['STORE_BUCKET'], 'meterbook'),
  region: get(['STORE_REGION', 'ART_REGION'], 'auto'),
  accessKey: get(['STORE_ACCESS_KEY', 'ART_ACCESS_KEY']),
  secretKey: get(['STORE_SECRET_KEY', 'ART_SECRET_KEY']),
  prefix: get(['STORE_PREFIX'], '').replace(/^\/+|\/+$/g, ''),
};
const key = (path) => (config.prefix ? `${config.prefix}/${path}` : path);

// ---- S3 mit AWS Signature Version 4, path style ---------------------------------------------

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const encode = (text) => encodeURIComponent(text).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

async function request(method, objectKey, query, body, headers, ok = [200]) {
  const { endpoint, bucket, region, accessKey, secretKey } = config;
  const path = '/' + [bucket, ...objectKey.split('/')].filter((s) => s !== '').map(encode).join('/');
  const canonicalQuery = Object.keys(query).sort().map((k) => `${encode(k)}=${encode(query[k])}`).join('&');
  const url = endpoint + path + (canonicalQuery ? '?' + canonicalQuery : '');
  const now = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
  const date = now.slice(0, 8);
  const payloadHash = sha256(body);
  const signed = { ...headers, host: new URL(endpoint).host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': now };
  const names = Object.keys(signed).sort();
  const canonical = [method, path, canonicalQuery, names.map((n) => `${n}:${String(signed[n]).trim()}\n`).join(''), names.join(';'), payloadHash].join('\n');
  const scope = `${date}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', now, scope, sha256(canonical)].join('\n');
  let signingKey = 'AWS4' + secretKey;
  for (const part of [date, region, 's3', 'aws4_request']) signingKey = createHmac('sha256', signingKey).update(part).digest();
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  const { host: _host, ...sent } = signed;
  sent.authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
  const response = await fetch(url, { method, headers: sent, body: body.length > 0 ? body : undefined });
  if (!ok.includes(response.status)) fail(`${method} ${path}: HTTP ${response.status}\n${(await response.text()).slice(0, 400)}`);
  return response;
}

const put = (objectKey, body, contentType) => request('PUT', objectKey, {}, Buffer.isBuffer(body) ? body : Buffer.from(body), { 'content-type': contentType });

// ---- Hochladen ------------------------------------------------------------------------------

const release = { version, published: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), notes: '', apk: { size: apk.length, sha256: sha256(apk) } };
const json = JSON.stringify(release, null, 2) + '\n';
const uploads = [
  [key(`downloads/MeterBook-${version}.apk`), apk, 'application/vnd.android.package-archive'],
  [key(`releases/${version}.json`), json, 'application/json'],
  [key('releases/latest.json'), json, 'application/json'],
];

console.log(`MeterBook ${version} → ${config.endpoint}/${config.bucket}`);
if (flag('--dry-run')) {
  for (const [k, body] of uploads) console.log(`  würde hochladen: ${k} (${Buffer.byteLength(body)} Bytes)`);
  process.exit(0);
}

if (flag('--setup')) {
  const created = await request('PUT', '', {}, Buffer.alloc(0), {}, [200, 409]);
  console.log(created.status === 409 ? '  Bucket gibt es schon' : '  Bucket angelegt');
  const policy = {
    Version: '2012-10-17',
    Statement: [{ Effect: 'Allow', Principal: { AWS: ['*'] }, Action: ['s3:GetObject'], Resource: [`arn:aws:s3:::${config.bucket}/*`] }],
  };
  await request('PUT', '', { policy: '' }, Buffer.from(JSON.stringify(policy)), { 'content-type': 'application/json' }, [200, 204]);
  console.log('  Anonymes Lesen erlaubt');
}

// Die App zuerst, latest.json zuletzt: die Seite zeigt nie eine Version, deren APK noch fehlt.
for (const [k, body, type] of uploads) {
  await put(k, body, type);
  console.log(`  ${k}`);
}
console.log('Fertig.');
