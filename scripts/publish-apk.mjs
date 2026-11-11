#!/usr/bin/env node
// Lädt die Android-App in den MeterBook-Store (ein S3-Bucket, Cloudflare R2), aus dem
// kuehnert.online/meterbook den Download anbietet, auf Staging wie in der Produktion. Das macht
// GitHub Actions bei jedem Versions-Tag (.github/workflows/apk.yml); von Hand geht es auch:
//
//   node scripts/publish-apk.mjs [X.Y.Z] [--dry-run] [--env DATEI]
//
// Ohne Version gilt die versionName aus android/app/build.gradle.kts. Hochgeladen wird
// apk/meterbook-X.Y.Z.apk (das baut ./gradlew assembleRelease) als
//   downloads/MeterBook-X.Y.Z.apk   die App
//   releases/X.Y.Z.json             was zu dieser Version gehört
//   releases/latest.json            die neueste, die die Seite liest
// Die beiden JSON-Dateien bekommen Cache-Control: no-cache, damit Cloudflare sie nicht zwischenspeichert.
// --dry-run zeigt nur, was hochgeladen würde.
//
// Zugangsdaten aus der Umgebung (so in GitHub Actions) oder aus scripts/apk-store.env (nicht eingecheckt):
//   STORE_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com   STORE_BUCKET=meterbook   STORE_REGION=auto
//   STORE_ACCESS_KEY=...   STORE_SECRET_KEY=...   STORE_PREFIX= (optional: Ordner im Bucket)
// Braucht Node 18 oder neuer, keine Pakete.
//
// Version: 2026-11-11

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

const ENV_FILE = option('--env') ?? join(root, 'scripts', 'apk-store.env');

/** Der Store aus einer Datei (Werte aus der Umgebung haben Vorrang). */
function loadStore(envFile, name) {
  if (!existsSync(envFile) && !process.env.STORE_ENDPOINT) fail(`${envFile} fehlt – die Zugangsdaten für ${name}.`);
  const values = {};
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const at = line.indexOf('=');
      if (at > 0 && !line.startsWith('#')) values[line.slice(0, at).trim()] = line.slice(at + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
  const get = (names, fallback) => {
    for (const n of names) {
      const value = process.env[n] || values[n]; // eine leere Umgebungsvariable verdeckt die Datei nicht
      if (value) return value;
    }
    if (fallback !== undefined) return fallback;
    fail(`${names[0]} fehlt. In ${envFile} oder in die Umgebung schreiben.`);
  };
  return {
    name,
    endpoint: get(['STORE_ENDPOINT', 'ART_ENDPOINT']).replace(/\/+$/, ''),
    bucket: get(['STORE_BUCKET'], 'meterbook'),
    region: get(['STORE_REGION', 'ART_REGION'], 'auto'),
    accessKey: get(['STORE_ACCESS_KEY', 'ART_ACCESS_KEY']),
    secretKey: get(['STORE_SECRET_KEY', 'ART_SECRET_KEY']),
    prefix: get(['STORE_PREFIX'], '').replace(/^\/+|\/+$/g, ''),
  };
}
const keyIn = (store, path) => (store.prefix ? `${store.prefix}/${path}` : path);

// ---- S3 mit AWS Signature Version 4, path style ---------------------------------------------

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const encode = (text) => encodeURIComponent(text).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

async function request(store, method, objectKey, query, body, headers, ok = [200]) {
  const { endpoint, bucket, region, accessKey, secretKey } = store;
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
  let response;
  try {
    response = await fetch(url, { method, headers: sent, body: body.length > 0 ? body : undefined, signal: AbortSignal.timeout(120_000) });
  } catch (error) {
    fail(`${store.name} (${endpoint}) nicht erreichbar: ${error.cause?.message ?? error.message}`);
  }
  if (!ok.includes(response.status)) fail(`${method} ${path} bei ${store.name}: HTTP ${response.status}\n${(await response.text()).slice(0, 400)}`);
  return response;
}

// Was "das Neueste" sagt, darf Cloudflare nicht zwischenspeichern, sonst sehen Seite und Besucher eine neue Version spät.
const put = (store, objectKey, body, contentType, cacheControl) =>
  request(store, 'PUT', objectKey, {}, Buffer.isBuffer(body) ? body : Buffer.from(body), {
    'content-type': contentType,
    ...(cacheControl ? { 'cache-control': cacheControl } : {}),
  });

// ---- Wohin ----------------------------------------------------------------------------------

const target = loadStore(ENV_FILE, 'MeterBook-Store');
const checksum = sha256(apk);

// ---- Hochladen ------------------------------------------------------------------------------

const release = { version, published: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), notes: '', apk: { size: apk.length, sha256: checksum } };
const json = JSON.stringify(release, null, 2) + '\n';
const uploads = [
  [keyIn(target, `downloads/MeterBook-${version}.apk`), apk, 'application/vnd.android.package-archive'],
  [keyIn(target, `releases/${version}.json`), json, 'application/json', 'no-cache'],
  [keyIn(target, 'releases/latest.json'), json, 'application/json', 'no-cache'],
];

console.log(`MeterBook ${version} → ${target.name}: ${target.endpoint}/${target.bucket}`);
if (flag('--dry-run')) {
  for (const [k, body] of uploads) console.log(`  würde hochladen: ${k} (${Buffer.byteLength(body)} Bytes)`);
  process.exit(0);
}

// Die App zuerst, latest.json zuletzt: die Seite zeigt nie eine Version, deren APK noch fehlt.
for (const [k, body, type, cacheControl] of uploads) {
  await put(target, k, body, type, cacheControl);
  console.log(`  ${k}`);
}
console.log('Fertig.');
