// Validates site/data.json after the build step.
// Called from build-pages.yml; exits nonzero on failure.
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dir, '..', '..');
const fromRoot = (...segments) => resolve(repoRoot, ...segments);

const d = JSON.parse(readFileSync(fromRoot('site', 'data.json'), 'utf8'));
const fail = (msg) => { console.error('[FATAL]', msg); process.exit(1); };

if (d.schemaVersion !== 2)  fail('schemaVersion !== 2');
if (d.counts.devices === 0) fail('counts.devices === 0');
if (d.counts.factory < 100) fail('counts.factory too low: ' + d.counts.factory);
if (d.counts.ota < 100)     fail('counts.ota too low: ' + d.counts.ota);

const SHA256_RE = /^[0-9a-f]{64}$/;
const FLASH_RE  = /^https:\/\/flash\.android\.com\//;
const repo = process.env.GITHUB_REPOSITORY ?? '';
const GH_URL_RE = /^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\//;
let googleCount = 0;
const shardedKeys = new Set();

for (const [k, v] of Object.entries(d.devices)) {
  if (!Array.isArray(v.factory) || !Array.isArray(v.ota))
    fail('device ' + k + ' missing factory or ota array');
  for (const [type, entries] of [['factory', v.factory], ['ota', v.ota]]) {
    for (const entry of entries) {
      // entry[2]: checksum — null or 64-hex lowercase string
      if (entry[2] !== null && (typeof entry[2] !== 'string' || !SHA256_RE.test(entry[2])))
        fail('device ' + k + ': entry[2] must be null or 64-hex lowercase checksum, got: ' + entry[2]);
      // entry[3]: flashUrl — null or https://flash.android.com/... string
      if (entry[3] !== null && (typeof entry[3] !== 'string' || !FLASH_RE.test(entry[3])))
        fail('device ' + k + ': entry[3] must be null or https://flash.android.com/ URL, got: ' + entry[3]);

      const urlOrParts = entry[1];
      if (Array.isArray(urlOrParts)) {
        if (urlOrParts.length < 2) fail('device ' + k + ': sharded entry has fewer than 2 URLs');
        const manifest = urlOrParts[urlOrParts.length - 1];
        if (!manifest.endsWith('.sha256')) fail('device ' + k + ': last sharded URL must end with .sha256, got: ' + manifest);
        for (const part of urlOrParts.slice(0, -1)) {
          if (!/\.part\d+$/.test(part)) fail('device ' + k + ': sharded part URL must end with .partNN, got: ' + part);
        }
        shardedKeys.add(`${k}:${type}:${entry[0]}`);
        if (repo) {
          for (const u of urlOrParts) {
            if (u.includes('dl.google.com')) googleCount++;
            if (!GH_URL_RE.test(u)) fail('device ' + k + ': expected GitHub Release URL in sharded array, got: ' + u);
          }
        }
      } else {
        if (typeof urlOrParts !== 'string') fail('device ' + k + ': entry[1] must be string or array');
        if (urlOrParts.includes('dl.google.com')) googleCount++;
        if (repo && !GH_URL_RE.test(urlOrParts))
          fail('device ' + k + ': expected GitHub Release URL, got: ' + urlOrParts);
      }
    }
  }
}

if (repo && googleCount > 0) fail(`${googleCount} dl.google.com URLs found — all URLs must use GitHub Release`);

const allowlistPath = fromRoot('site', 'functions', '_lib', 'firmware-allowlist.json');
if (!existsSync(allowlistPath)) fail('missing site/functions/_lib/firmware-allowlist.json');
const allowlist = JSON.parse(readFileSync(allowlistPath, 'utf8'));
const allowlistKeys = Object.keys(allowlist);

for (const key of shardedKeys) {
  if (!Object.hasOwn(allowlist, key)) fail('sharded data entry missing from allowlist: ' + key);
}
for (const key of allowlistKeys) {
  if (!shardedKeys.has(key)) fail('allowlist entry has no matching sharded data entry: ' + key);
  const entry = allowlist[key];
  if (!entry || typeof entry !== 'object') fail('allowlist entry must be object: ' + key);
  if (typeof entry.fileName !== 'string' || !entry.fileName.endsWith('.zip')) fail('allowlist fileName must end with .zip: ' + key);
  if (!Array.isArray(entry.parts) || entry.parts.length === 0) fail('allowlist parts missing: ' + key);
  if (typeof entry.manifestUrl !== 'string' || !entry.manifestUrl.endsWith('.sha256')) fail('allowlist manifestUrl invalid: ' + key);
  if (entry.expectedSha256 !== null && (typeof entry.expectedSha256 !== 'string' || !SHA256_RE.test(entry.expectedSha256))) {
    fail('allowlist expectedSha256 invalid: ' + key);
  }

  let previous = 0;
  let computedSize = 0;
  for (const part of entry.parts) {
    if (!Number.isInteger(part.n) || part.n <= previous) fail('allowlist parts must be sorted by n: ' + key);
    previous = part.n;
    if (typeof part.url !== 'string' || !part.url.endsWith('.part' + String(part.n).padStart(2, '0'))) {
      fail('allowlist part URL must end with sorted .partNN: ' + key);
    }
    if (part.url.endsWith('.sha256')) fail('allowlist part includes manifest: ' + key);
    if (repo && !GH_URL_RE.test(part.url)) fail('allowlist expected GitHub Release URL: ' + key);
    if (!Number.isFinite(part.size) || part.size < 0) fail('allowlist part size invalid: ' + key);
    computedSize += part.size;
  }
  if (!Number.isFinite(entry.expectedSize) || entry.expectedSize < 0) fail('allowlist expectedSize invalid: ' + key);
  if (entry.expectedSize !== computedSize) fail('allowlist expectedSize mismatch: ' + key);
}

console.log('[OK]', d.counts.devices, 'devices,', d.counts.factory, 'factory,', d.counts.ota, 'OTA,', allowlistKeys.length, 'sharded merge entries');
