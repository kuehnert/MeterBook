#!/usr/bin/env node
// Lädt die Android-App in einen MeterBook-Store (RustFS, MinIO, Cloudflare R2 oder ein anderer
// S3-Speicher), aus dem kuehnert.online/meterbook den Download anbietet. Zwei Stores:
//
//   Staging     scripts/apk-store-staging.env      der RustFS im Heimnetz, für staging.kuehnert.online
//   Produktion  scripts/apk-store-production.env   der R2-Bucket, für kuehnert.online
//
//   node scripts/publish-apk.mjs [X.Y.Z] [--dry-run] [--setup]   nach Staging (macht auch assembleRelease)
//   node scripts/publish-apk.mjs [X.Y.Z] --production [--dry-run] [--force]
//
// Ohne Version gilt die versionName aus android/app/build.gradle.kts. Hochgeladen wird
// apk/meterbook-X.Y.Z.apk (das baut ./gradlew assembleRelease) als
//   downloads/MeterBook-X.Y.Z.apk   die App
//   releases/X.Y.Z.json             was zu dieser Version gehört
//   releases/latest.json            die neueste, die die Seite liest
//
// --production lädt nur hoch, was schon auf Staging liegt: dieselbe Version mit derselben
// Prüfsumme. So kommt in die Produktion genau die APK, die auf Staging ausprobiert wurde.
// --force lässt diese Prüfung aus (etwa wenn der Heimserver nicht erreichbar ist).
// --setup legt vorher den Bucket an und erlaubt anonymes Lesen (einmalig, nur RustFS/MinIO;
// bei R2 gibt es den Bucket und den öffentlichen Zugriff im Cloudflare-Dashboard).
// --dry-run zeigt nur, was hochgeladen würde.
// --env DATEI nimmt eine andere Datei als die des Stores.
//
// Zugangsdaten je Store in seiner Datei (nicht eingecheckt). Für Staging auch METERBOOK_STORE_ENV,
// einzelne Werte auch aus der Umgebung (die gelten dann für beide Stores):
//   STORE_ENDPOINT=http://192.168.168.2:9000   STORE_BUCKET=meterbook   STORE_REGION=auto
//   STORE_ACCESS_KEY=...                       STORE_SECRET_KEY=...
//   STORE_PREFIX=                              (optional: Ordner im Bucket)
// R2: STORE_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com, STORE_REGION=auto.
// Statt STORE_ENDPOINT/_ACCESS_KEY/_SECRET_KEY/_REGION gehen auch die ART_*-Namen aus
// Dungeon Remasters art_store.env; den Bucket nimmt das Skript aber nie von dort (Standard: meterbook).
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

const production = flag('--production');
const gradle = readFileSync(join(root, 'android/app/build.gradle.kts'), 'utf8');
const version = args.find((a, i) => /^\d+\.\d+\.\d+$/.test(a) && args[i - 1] !== '--env') ?? gradle.match(/versionName = "([^"]+)"/)?.[1];
if (!version) fail('Keine Version gefunden.');

const apkFile = join(root, 'apk', `meterbook-${version}.apk`);
if (!existsSync(apkFile)) fail(`${apkFile} fehlt – erst "./gradlew assembleRelease" in android/.`);
const apk = readFileSync(apkFile);

// ---- Zugangsdaten ---------------------------------------------------------------------------

const STAGING_ENV = process.env.METERBOOK_STORE_ENV ?? join(root, 'scripts', 'apk-store-staging.env');
const PRODUCTION_ENV = join(root, 'scripts', 'apk-store-production.env');

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

const target = production ? loadStore(option('--env') ?? PRODUCTION_ENV, 'Produktion') : loadStore(option('--env') ?? STAGING_ENV, 'Staging');
const checksum = sha256(apk);

// Produktion nur mit dem, was auf Staging liegt: gleiche Version, gleiche Prüfsumme.
if (production && !flag('--force')) {
  const staging = loadStore(STAGING_ENV, 'Staging');
  const response = await request(staging, 'GET', keyIn(staging, `releases/${version}.json`), {}, Buffer.alloc(0), {}, [200, 404]);
  if (response.status === 404) fail(`Version ${version} liegt noch nicht auf Staging. Erst dort veröffentlichen ("./gradlew assembleRelease" oder ohne --production), oder mit --force ohne diese Prüfung.`);
  const onStaging = await response.json();
  if (onStaging.apk?.sha256 !== checksum) {
    fail(`apk/meterbook-${version}.apk ist nicht die APK auf Staging (Prüfsumme ${checksum.slice(0, 12)}… statt ${String(onStaging.apk?.sha256).slice(0, 12)}…). Neu gebaut? Dann erst nach Staging, oder mit --force.`);
  }
  console.log(`Staging hat ${version} mit derselben Prüfsumme – geht in die Produktion.`);
}

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

if (flag('--setup')) {
  const created = await request(target, 'PUT', '', {}, Buffer.alloc(0), {}, [200, 409]);
  console.log(created.status === 409 ? '  Bucket gibt es schon' : '  Bucket angelegt');
  const policy = {
    Version: '2012-10-17',
    Statement: [{ Effect: 'Allow', Principal: { AWS: ['*'] }, Action: ['s3:GetObject'], Resource: [`arn:aws:s3:::${target.bucket}/*`] }],
  };
  await request(target, 'PUT', '', { policy: '' }, Buffer.from(JSON.stringify(policy)), { 'content-type': 'application/json' }, [200, 204]);
  console.log('  Anonymes Lesen erlaubt');
}

// Die App zuerst, latest.json zuletzt: die Seite zeigt nie eine Version, deren APK noch fehlt.
for (const [k, body, type, cacheControl] of uploads) {
  await put(target, k, body, type, cacheControl);
  console.log(`  ${k}`);
}
console.log('Fertig.');
