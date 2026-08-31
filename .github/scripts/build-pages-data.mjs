// .github/scripts/build-pages-data.mjs
// Parses FactoryImages.txt + FullOTAImages.txt → site/data.json
//
// Canonical URL regexes — keep in sync with:
//   .github/scripts/extract-changed-devices.sh
//   .github/scripts/publish-firmware.sh
//   .github/scripts/update-url-lists.sh
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FACTORY_RE = /^https:\/\/dl\.google\.com\/dl\/android\/aosp\/([a-z0-9._]+)-([A-Za-z0-9._]+)-factory-([0-9a-f]{8})\.zip$/;
export const OTA_RE    = /^https:\/\/dl\.google\.com\/dl\/android\/aosp\/([a-z0-9._]+)-ota-([A-Za-z0-9._]+)-([0-9a-f]{8})\.zip$/;

const MIN_COUNT = 100;

// Returns a sort key for "dated" build IDs (e.g. bp3a.251105.015, ap4a.241205.013.b1).
// A dated ID has a six-digit YYMMDD second segment + numeric revision.
// Returns null for legacy IDs (e.g. GRK39F, JZO54K).
export function parseDateKey(buildId) {
  const m = buildId.match(/^[a-z]+[0-9][a-z]?\.(\d{6})\.(\d{3})(.*)/i);
  if (!m) return null;
  return { yymmdd: parseInt(m[1], 10), rev: parseInt(m[2], 10), suffix: m[3] };
}

function naturalDesc(a, b) {
  return b.toLowerCase().localeCompare(a.toLowerCase(), undefined, { numeric: true, sensitivity: 'base' });
}

// Newest-first comparator for build ID strings.
// Dated IDs sort before legacy IDs; within each group, newest first.
export function compareBuildIds(a, b) {
  const da = parseDateKey(a);
  const db = parseDateKey(b);
  if (da && db) {
    if (db.yymmdd !== da.yymmdd) return db.yymmdd - da.yymmdd;
    if (db.rev    !== da.rev)    return db.rev    - da.rev;
    const sc = naturalDesc(da.suffix, db.suffix);
    return sc !== 0 ? sc : naturalDesc(a, b);
  }
  if (da && !db) return -1;
  if (!da && db) return  1;
  return naturalDesc(a, b);
}

// Parses one URL list file. Returns array of { device, buildId, url }.
// Exits nonzero if parsed count < MIN_COUNT or an ambiguous duplicate is found.
export function parseUrlFile(content, regex, label) {
  const entries = new Map(); // `${device}:${buildId}` → { device, buildId, url }
  const warnedDups = new Set();
  let skipped = 0;

  for (const rawLine of content.split('\n')) {
    const line = rawLine.replace(/\r$/, '').trim();
    if (!line) continue;
    const m = line.match(regex);
    if (!m) { skipped++; continue; }

    const [, device, buildId] = m;
    const key = `${device}:${buildId}`;

    if (entries.has(key)) {
      if (entries.get(key).url === line) {
        if (!warnedDups.has(line)) {
          console.warn(`[WARN] ${label}: exact duplicate skipped — ${line}`);
          warnedDups.add(line);
        }
        continue;
      }
      console.error(`[FATAL] ${label}: same device+type+buildId with different URL`);
      console.error(`  existing : ${entries.get(key).url}`);
      console.error(`  conflict : ${line}`);
      process.exit(1);
    }
    entries.set(key, { device, buildId, url: line });
  }

  const parsed = entries.size;
  console.log(`[INFO] ${label}: ${parsed} parsed, ${skipped} skipped, ${warnedDups.size} exact dups`);
  if (parsed < MIN_COUNT) {
    console.error(`[FATAL] ${label}: only ${parsed} valid URLs (minimum ${MIN_COUNT}) — check URL format`);
    process.exit(1);
  }
  return [...entries.values()];
}

// Queries GitHub Releases and builds a map of part URLs for sharded firmware entries.
// Returns Map<"device:type:buildId", {urls, fileName, parts, expectedSize, manifestUrl}>.
// urls preserves the public data.json shape: .partNN URLs followed by the .sha256 manifest URL.
// Returns an empty Map when GITHUB_REPOSITORY is not set or the API is unreachable.
export async function fetchPartUrlMap(repo) {
  if (!repo) return new Map();
  const headers = { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'build-pages-data' };
  if (process.env.GITHUB_TOKEN) headers['Authorization'] = 'token ' + process.env.GITHUB_TOKEN;

  // partRe matches: {base}.partNN or {base}.sha256
  const partRe = /^(.+\.zip)\.(part(\d+)|sha256)$/;
  // buildIdRe extracts buildId from base filename for factory and ota
  const buildIdReFactory = /^[a-z0-9._]+-([A-Za-z0-9._]+)-factory-[0-9a-f]{8}\.zip$/;
  const buildIdReOta     = /^[a-z0-9._]+-ota-([A-Za-z0-9._]+)-[0-9a-f]{8}\.zip$/;

  const map = new Map();
  let page = 1;
  while (true) {
    let releases;
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`, { headers });
      if (!res.ok) { console.warn(`[WARN] Releases API ${res.status} — sharding detection unavailable`); break; }
      releases = await res.json();
    } catch (e) { console.warn('[WARN] Releases fetch failed — sharding detection unavailable:', e.message); break; }
    if (!releases.length) break;

    for (const rel of releases) {
      const tm = rel.tag_name.match(/^firmware-([a-z0-9._]+)-(factory|ota)$/);
      if (!tm) continue;
      const [, device, type] = tm;
      const buildIdRe = type === 'factory' ? buildIdReFactory : buildIdReOta;

      // Group assets by their base filename (the .zip stem before .partNN/.sha256)
      const groups = new Map(); // base → { parts: [{n, url, size, name}], manifest: {url, size, name}|null }
      for (const asset of rel.assets) {
        const pm = asset.name.match(partRe);
        if (!pm) continue;
        const base = pm[1];
        if (!groups.has(base)) groups.set(base, { parts: [], manifest: null });
        const g = groups.get(base);
        if (pm[2] === 'sha256') {
          g.manifest = { url: asset.browser_download_url, size: asset.size ?? 0, name: asset.name };
        } else {
          g.parts.push({
            n: parseInt(pm[3], 10),
            url: asset.browser_download_url,
            size: asset.size ?? 0,
            name: asset.name,
          });
        }
      }

      for (const [base, { parts, manifest }] of groups) {
        if (parts.length === 0 || !manifest) continue;
        const bm = base.match(buildIdRe);
        if (!bm) continue;
        const buildId = bm[1];
        parts.sort((a, b) => a.n - b.n);
        map.set(`${device}:${type}:${buildId}`, {
          urls: [...parts.map(p => p.url), manifest.url],
          fileName: base,
          parts,
          expectedSize: parts.reduce((sum, p) => sum + (Number.isFinite(p.size) ? p.size : 0), 0),
          manifestUrl: manifest.url,
        });
      }
    }
    if (releases.length < 100) break;
    page++;
  }
  console.log(`[INFO] GitHub Releases: ${map.size} sharded entries mapped`);
  return map;
}

// Reads FirmwareMetadata.json (produced by update-url-lists.sh via scrape-metadata.mjs).
// Returns Map<sourceUrl, { checksum: string|null, flashUrl: string|null }>.
// Returns an empty Map when the file is absent — allows pre-sidecar builds to succeed.
export function loadMetadata(metadataPath) {
  if (!existsSync(metadataPath)) return new Map();
  const raw = JSON.parse(readFileSync(metadataPath, 'utf8'));
  return new Map(Object.entries(raw));
}

// Constructs a GitHub Release download URL from components.
function buildGitHubReleaseUrl(repo, device, type, filename) {
  return `https://github.com/${repo}/releases/download/firmware-${device}-${type}/${filename}`;
}

// Builds the data.json output object from parsed entries + name map.
// repo: GITHUB_REPOSITORY value; when set, constructs GitHub Release URLs deterministically.
// partUrlMap: Map from fetchPartUrlMap — sharded entries get array of part+manifest URLs.
// allowlist: Map mutated with entries safe for the same-origin merge Function.
export function buildOutput(factoryEntries, otaEntries, nameMap, meta = {}, repo = '', partUrlMap = new Map(), metadataMap = new Map(), allowlist = new Map()) {
  const devices = {};

  const makeEntry = (device, type, buildId, googleUrl) => {
    // Attach metadata using the original Google URL as key (before any URL rewrite).
    const meta = metadataMap.get(googleUrl);
    const checksum = meta?.checksum ?? null;
    const flashUrl = meta?.flashUrl ?? null;

    if (!repo) return [buildId, googleUrl, checksum, flashUrl];
    const key = `${device}:${type}:${buildId}`;
    if (partUrlMap.has(key)) {
      const shard = partUrlMap.get(key);
      allowlist.set(key, {
        fileName: shard.fileName,
        parts: shard.parts,
        expectedSize: shard.expectedSize,
        expectedSha256: checksum,
        manifestUrl: shard.manifestUrl,
        originalUrl: googleUrl,
      });
      return [buildId, shard.urls, checksum, flashUrl];
    }
    const filename = googleUrl.split('/').pop();
    return [buildId, buildGitHubReleaseUrl(repo, device, type, filename), checksum, flashUrl];
  };

  for (const { device, buildId, url } of factoryEntries) {
    if (!devices[device]) devices[device] = { factory: [], ota: [] };
    devices[device].factory.push(makeEntry(device, 'factory', buildId, url));
  }
  for (const { device, buildId, url } of otaEntries) {
    if (!devices[device]) devices[device] = { factory: [], ota: [] };
    devices[device].ota.push(makeEntry(device, 'ota', buildId, url));
  }

  for (const dev of Object.values(devices)) {
    dev.factory.sort((a, b) => compareBuildIds(a[0], b[0]));
    dev.ota.sort((a, b) => compareBuildIds(a[0], b[0]));
  }

  const usedKeys = new Set();
  for (const [codename, dev] of Object.entries(devices)) {
    if (nameMap[codename]) {
      dev.name = `${nameMap[codename]} (${codename})`;
      usedKeys.add(codename);
    } else {
      console.warn(`[WARN] No marketing name for: ${codename}`);
      dev.name = codename;
    }
  }
  for (const k of Object.keys(nameMap)) {
    if (!usedKeys.has(k)) console.warn(`[WARN] Mapping key not in URL lists: ${k}`);
  }

  const factoryTotal = Object.values(devices).reduce((s, d) => s + d.factory.length, 0);
  const otaTotal     = Object.values(devices).reduce((s, d) => s + d.ota.length, 0);

  return {
    schemaVersion: 2,
    generatedAt:   meta.generatedAt   ?? new Date().toISOString(),
    sourceRevision: meta.sourceRevision ?? 'local',
    counts: { devices: Object.keys(devices).length, factory: factoryTotal, ota: otaTotal },
    devices,
  };
}

function writeAllowlist(jsonPath, modulePath, allowlist) {
  const object = Object.fromEntries([...allowlist.entries()].sort(([a], [b]) => a.localeCompare(b)));
  mkdirSync(dirname(jsonPath), { recursive: true });
  const json = JSON.stringify(object, null, 2) + '\n';

  const jsonTmp = jsonPath + '.tmp';
  writeFileSync(jsonTmp, json);
  JSON.parse(readFileSync(jsonTmp, 'utf8'));
  renameSync(jsonTmp, jsonPath);

  const moduleTmp = modulePath + '.tmp';
  writeFileSync(moduleTmp,
    '// Generated by .github/scripts/build-pages-data.mjs. Do not edit by hand.\n' +
    `export const FIRMWARE_ALLOWLIST = ${json};\n`
  );
  renameSync(moduleTmp, modulePath);

  console.log(`[INFO] Wrote ${jsonPath}: ${allowlist.size} sharded entries`);
}

// ── Entry point ─────────────────────────────────────────────────────────────

async function main() {
  const __dir    = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(__dir, '..', '..');
  const paths = {
    factory: resolve(repoRoot, 'FactoryImages.txt'),
    ota:     resolve(repoRoot, 'FullOTAImages.txt'),
    names:   resolve(repoRoot, 'site', 'device-names.json'),
    out:     resolve(repoRoot, 'site', 'data.json'),
    allowlistJson: resolve(repoRoot, 'site', 'functions', '_lib', 'firmware-allowlist.json'),
    allowlistModule: resolve(repoRoot, 'site', 'functions', '_lib', 'firmware-allowlist.js'),
  };

  for (const [key, p] of Object.entries(paths)) {
    if (key === 'out' || key === 'allowlistJson' || key === 'allowlistModule') continue;
    if (!existsSync(p)) { console.error(`[FATAL] Missing: ${p}`); process.exit(1); }
  }

  const nameMap        = JSON.parse(readFileSync(paths.names, 'utf8'));
  const factoryEntries = parseUrlFile(readFileSync(paths.factory, 'utf8'), FACTORY_RE, 'factory');
  const otaEntries     = parseUrlFile(readFileSync(paths.ota,     'utf8'), OTA_RE,     'ota');

  const repo       = process.env.GITHUB_REPOSITORY ?? '';
  const partUrlMap = await fetchPartUrlMap(repo);
  const metadataPath = resolve(repoRoot, 'FirmwareMetadata.json');
  const metadataMap  = loadMetadata(metadataPath);
  if (metadataMap.size > 0) {
    console.log(`[INFO] FirmwareMetadata.json: ${metadataMap.size} entries loaded`);
  } else {
    console.warn('[WARN] FirmwareMetadata.json not found — checksum and Flash data will be null');
  }
  const allowlist = new Map();
  const output = buildOutput(factoryEntries, otaEntries, nameMap, {
    sourceRevision: process.env.GITHUB_SHA ?? 'local',
  }, repo, partUrlMap, metadataMap, allowlist);

  // Warn for any device codename that has no release date entry.
  const releaseDatesPath = resolve(repoRoot, 'site', 'device-release-dates.json');
  if (existsSync(releaseDatesPath)) {
    const releaseDates = JSON.parse(readFileSync(releaseDatesPath, 'utf8'));
    for (const codename of Object.keys(output.devices)) {
      if (!Object.hasOwn(releaseDates, codename)) console.warn(`[WARN] No release date for: ${codename}`);
    }
  } else {
    console.warn('[WARN] site/device-release-dates.json not found — release date coverage not checked');
  }

  if (output.counts.devices === 0 || output.counts.factory === 0) {
    console.error('[FATAL] Zero devices or factory entries after build — aborting');
    process.exit(1);
  }

  const tmp = paths.out + '.tmp';
  writeFileSync(tmp, JSON.stringify(output));
  JSON.parse(readFileSync(tmp, 'utf8')); // verify round-trip parse succeeds
  renameSync(tmp, paths.out);
  writeAllowlist(paths.allowlistJson, paths.allowlistModule, allowlist);

  const { devices: dc, factory: fc, ota: oc } = output.counts;
  console.log(`[INFO] Wrote ${paths.out}: ${dc} devices, ${fc} factory, ${oc} OTA`);

  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    writeFileSync(summary,
      `## data.json build\n| Metric | Count |\n|---|---|\n` +
      `| Devices | ${dc} |\n| Factory URLs | ${fc} |\n| OTA URLs | ${oc} |\n` +
      `| Sharded merge entries | ${allowlist.size} |\n`,
      { flag: 'a' });
  }
}

// Only run when executed directly (not when imported by tests)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
