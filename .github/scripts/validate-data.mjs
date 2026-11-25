// Validates site/data.json after the build step.
// Called from build-pages.yml; exits nonzero on failure.
import { readFileSync } from 'node:fs';
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
        // sharded entry: parts + manifest are expected to be GitHub Release URLs
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

console.log('[OK]', d.counts.devices, 'devices,', d.counts.factory, 'factory,', d.counts.ota, 'OTA');
