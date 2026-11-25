// .github/scripts/build-pages-data.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDateKey, compareBuildIds, parseUrlFile, buildOutput, fetchPartUrlMap, findMissingAssets, loadMetadata, mergeNameMaps, FACTORY_RE, OTA_RE } from './build-pages-data.mjs';
import { readFileSync } from 'node:fs';
import { parseRows } from './scrape-metadata.mjs';

// ── parseDateKey ─────────────────────────────────────────────────────────────

test('parseDateKey: returns key for modern build ID', () => {
  const k = parseDateKey('bp3a.251105.015');
  assert.equal(k.yymmdd, 251105);
  assert.equal(k.rev, 15);
  assert.equal(k.suffix, '');
});

test('parseDateKey: parses suffix like .b1', () => {
  const k = parseDateKey('ap4a.241205.013.b1');
  assert.equal(k.yymmdd, 241205);
  assert.equal(k.rev, 13);
  assert.equal(k.suffix, '.b1');
});

test('parseDateKey: returns null for legacy build ID', () => {
  assert.equal(parseDateKey('GRK39F'), null);
  assert.equal(parseDateKey('JZO54K'), null);
  assert.equal(parseDateKey('NOU'),    null);
});

// ── compareBuildIds ──────────────────────────────────────────────────────────

test('compareBuildIds: newer dated ID sorts first', () => {
  assert.ok(compareBuildIds('bp3a.251105.015', 'ap4a.241205.013') < 0);
});

test('compareBuildIds: higher revision sorts first (same date)', () => {
  assert.ok(compareBuildIds('bp1a.250305.019', 'bp1a.250305.007') < 0);
});

test('compareBuildIds: dated before legacy', () => {
  assert.ok(compareBuildIds('bp3a.251105.015', 'GRK39F') < 0);
});

test('compareBuildIds: two legacy IDs are ordered deterministically', () => {
  const result = compareBuildIds('JZO54K', 'GRK39F');
  assert.ok(typeof result === 'number');
  // reversed order is opposite sign
  assert.ok(compareBuildIds('GRK39F', 'JZO54K') === -result || result === 0);
});

test('compareBuildIds: suffix .b1 vs no suffix, same date+rev', () => {
  const r = compareBuildIds('ap4a.241205.013.b1', 'ap4a.241205.013');
  assert.ok(typeof r === 'number');
});

// ── parseUrlFile ─────────────────────────────────────────────────────────────

const F = (device, buildId) =>
  `https://dl.google.com/dl/android/aosp/${device}-${buildId}-factory-abcd1234.zip`;
const O = (device, buildId) =>
  `https://dl.google.com/dl/android/aosp/${device}-ota-${buildId}-abcd1234.zip`;

test('parseUrlFile: parses valid factory lines', () => {
  const content = [F('akita', 'bp3a.251105.015'), F('akita', 'ap4a.241205.013')].join('\n');
  // pad to meet MIN_COUNT
  const padded = Array.from({ length: 98 }, (_, i) => F(`dev${i}`, `bp1a.250101.00${i < 10 ? '0' : ''}${i}`)).join('\n');
  const entries = parseUrlFile(content + '\n' + padded, FACTORY_RE, 'factory');
  assert.ok(entries.some(e => e.device === 'akita' && e.buildId === 'bp3a.251105.015'));
});

test('parseUrlFile: skips malformed lines', () => {
  const valid   = Array.from({ length: 100 }, (_, i) => F(`dev${i}`, `bp1a.250101.001`)).join('\n');
  const entries = parseUrlFile('not-a-url\n' + valid, FACTORY_RE, 'factory');
  assert.ok(entries.every(e => e.url.startsWith('https://')));
});

test('parseUrlFile: strips CRLF', () => {
  const valid = Array.from({ length: 100 }, (_, i) => F(`dev${i}`, `bp1a.250101.001`)).join('\r\n');
  const entries = parseUrlFile(valid, FACTORY_RE, 'factory');
  assert.equal(entries.length, 100);
});

test('parseUrlFile: deduplicates exact URL duplicate with warning', () => {
  const url = F('akita', 'bp3a.251105.015');
  const base = Array.from({ length: 99 }, (_, i) => F(`dev${i}`, `bp1a.250101.001`)).join('\n');
  const entries = parseUrlFile(url + '\n' + url + '\n' + base, FACTORY_RE, 'factory');
  const akitaEntries = entries.filter(e => e.device === 'akita');
  assert.equal(akitaEntries.length, 1);
});

test('parseUrlFile: parses uppercase legacy build IDs verbatim', () => {
  const url = F('soju', 'GRK39F');
  const base = Array.from({ length: 99 }, (_, i) => F(`dev${i}`, `bp1a.250101.001`)).join('\n');
  const entries = parseUrlFile(url + '\n' + base, FACTORY_RE, 'factory');
  const e = entries.find(e => e.device === 'soju');
  assert.equal(e.buildId, 'GRK39F');
});

// ── buildOutput ──────────────────────────────────────────────────────────────

test('buildOutput: factory-only device has empty ota array', () => {
  const factory = [{ device: 'akita', buildId: 'bp3a.251105.015', url: F('akita','bp3a.251105.015') }];
  const out = buildOutput(factory, [], { akita: 'Pixel 8a' }, { generatedAt: 'T', sourceRevision: 'abc' }, '', new Map());
  assert.deepEqual(out.devices.akita.ota, []);
  assert.equal(out.devices.akita.factory.length, 1);
});

test('buildOutput: missing mapping falls back to codename', () => {
  const factory = [{ device: 'unknown42', buildId: 'bp1a.250101.001', url: F('unknown42','bp1a.250101.001') }];
  const out = buildOutput(factory, [], {}, { generatedAt: 'T', sourceRevision: 'abc' }, '', new Map());
  assert.equal(out.devices.unknown42.name, 'unknown42');
});

test('buildOutput: known mapping produces "Name (codename)"', () => {
  const factory = [{ device: 'akita', buildId: 'bp1a.250101.001', url: F('akita','bp1a.250101.001') }];
  const out = buildOutput(factory, [], { akita: 'Pixel 8a' }, { generatedAt: 'T', sourceRevision: 'abc' }, '', new Map());
  assert.equal(out.devices.akita.name, 'Pixel 8a (akita)');
});

test('buildOutput: counts match array lengths', () => {
  const factory = [
    { device: 'akita', buildId: 'bp3a.251105.015', url: F('akita','bp3a.251105.015') },
    { device: 'akita', buildId: 'ap4a.241205.013', url: F('akita','ap4a.241205.013') },
  ];
  const ota = [{ device: 'akita', buildId: 'bp3a.251105.015', url: O('akita','bp3a.251105.015') }];
  const out = buildOutput(factory, ota, {}, { generatedAt: 'T', sourceRevision: 'abc' }, '', new Map());
  assert.equal(out.counts.factory, 2);
  assert.equal(out.counts.ota, 1);
  assert.equal(out.counts.devices, 1);
});

test('buildOutput: versions are newest-first', () => {
  const factory = [
    { device: 'akita', buildId: 'ap4a.241205.013', url: F('akita','ap4a.241205.013') },
    { device: 'akita', buildId: 'bp3a.251105.015', url: F('akita','bp3a.251105.015') },
  ];
  const out = buildOutput(factory, [], {}, { generatedAt: 'T', sourceRevision: 'abc' }, '', new Map());
  assert.equal(out.devices.akita.factory[0][0], 'bp3a.251105.015');
});

// ── GitHub Release URL construction ──────────────────────────────────────────

test('buildOutput: constructs GitHub Release URL when repo is set', () => {
  const factory = [{ device: 'akita', buildId: 'bp3a.251105.015', url: F('akita','bp3a.251105.015') }];
  const out = buildOutput(factory, [], {}, { generatedAt: 'T', sourceRevision: 'abc' }, 'owner/repo', new Map());
  const [buildId, url] = out.devices.akita.factory[0];
  assert.equal(buildId, 'bp3a.251105.015');
  assert.ok(url.startsWith('https://github.com/owner/repo/releases/download/firmware-akita-factory/'));
  assert.ok(url.endsWith('.zip'));
});

test('buildOutput: falls back to Google URL when repo is empty', () => {
  const factory = [{ device: 'akita', buildId: 'bp3a.251105.015', url: F('akita','bp3a.251105.015') }];
  const out = buildOutput(factory, [], {}, { generatedAt: 'T', sourceRevision: 'abc' }, '', new Map());
  const [, url] = out.devices.akita.factory[0];
  assert.ok(url.startsWith('https://dl.google.com'));
});

test('buildOutput: sharded entry uses part URL array', () => {
  const factory = [{ device: 'tokay', buildId: 'ad1a.240530.030', url: F('tokay','ad1a.240530.030') }];
  const base = 'https://github.com/owner/repo/releases/download/firmware-tokay-factory/tokay-ad1a.240530.030-factory-abcd1234.zip';
  const urls = [base + '.part01', base + '.part02', base + '.sha256'];
  const partMap = new Map([
    ['tokay:factory:ad1a.240530.030', {
      urls,
      fileName: 'tokay-ad1a.240530.030-factory-abcd1234.zip',
      parts: [
        { n: 1, url: urls[0], size: 100, name: 'tokay.zip.part01' },
        { n: 2, url: urls[1], size: 100, name: 'tokay.zip.part02' },
      ],
      expectedSize: 200,
      manifestUrl: urls[2],
    }],
  ]);
  const out = buildOutput(factory, [], {}, { generatedAt: 'T', sourceRevision: 'abc' }, 'owner/repo', partMap);
  const entry = out.devices.tokay.factory[0];
  assert.equal(entry[0], 'ad1a.240530.030');
  assert.deepEqual(entry[1], urls);
  assert.equal(entry[2], null);
  assert.equal(entry[3], null);
});

test('fetchPartUrlMap: parts sorted numerically, manifest appended last', async () => {
  const base = 'https://github.com/r/releases/download/firmware-tokay-factory/tokay-ad1a.240530.030-factory-abcd1234.zip';
  const releases = [{
    tag_name: 'firmware-tokay-factory',
    assets: [
      { name: 'tokay-ad1a.240530.030-factory-abcd1234.zip.sha256', browser_download_url: base + '.sha256', size: 64 },
      { name: 'tokay-ad1a.240530.030-factory-abcd1234.zip.part10', browser_download_url: base + '.part10', size: 10 },
      { name: 'tokay-ad1a.240530.030-factory-abcd1234.zip.part02', browser_download_url: base + '.part02', size: 20 },
      { name: 'tokay-ad1a.240530.030-factory-abcd1234.zip.part01', browser_download_url: base + '.part01', size: 30 },
    ],
  }];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(releases), { status: 200 });
  try {
    const { byKey: partMap, assetNames } = await fetchPartUrlMap('owner/repo');
    const shard = partMap.get('tokay:factory:ad1a.240530.030');
    assert.ok(shard, 'expected a shard entry');
    assert.ok(assetNames.has('tokay-ad1a.240530.030-factory-abcd1234.zip.part01'));
    assert.ok(assetNames.has('tokay-ad1a.240530.030-factory-abcd1234.zip.sha256'));
    assert.deepEqual(shard.urls, [base + '.part01', base + '.part02', base + '.part10', base + '.sha256']);
    assert.equal(shard.expectedSize, 60);

    const factory = [{ device: 'tokay', buildId: 'ad1a.240530.030', url: F('tokay','ad1a.240530.030') }];
    const out = buildOutput(factory, [], {}, {}, 'owner/repo', partMap);
    assert.deepEqual(out.devices.tokay.factory[0][1], shard.urls);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('buildOutput: non-sharded entry has checksum and flashUrl at indices 2 and 3', () => {
  const factory = [{ device: 'akita', buildId: 'bp3a.251105.015', url: F('akita','bp3a.251105.015') }];
  const out = buildOutput(factory, [], {}, { generatedAt: 'T', sourceRevision: 'abc' }, 'owner/repo', new Map());
  const entry = out.devices.akita.factory[0];
  assert.equal(entry.length, 4);
  assert.equal(typeof entry[1], 'string');
  // no metadata supplied → null
  assert.equal(entry[2], null);
  assert.equal(entry[3], null);
});

// ── scrape-metadata: parseRows ────────────────────────────────────────────────

const FACTORY_ROW_4 = `<tr id="akitabp3a.251105.015">
  <td>16.0.0 (BP3A.251105.015, Nov 2025)</td>
  <td><a href="https://flash.android.com/build/99999999?target=akita-user&amp;signed">Flash</a></td>
  <td><a href="https://dl.google.com/dl/android/aosp/akita-bp3a.251105.015-factory-abcd1234.zip">Link</a></td>
  <td>abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234</td>
</tr>`;

const FACTORY_ROW_3 = `<tr id="yakjujzo54k">
  <td>4.1.1 (JZO54K, Jul 2012)</td>
  <td><a href="https://dl.google.com/dl/android/aosp/yakju-jzo54k-factory-d75228cf.zip">Link</a></td>
  <td>d75228cfd75228cfd75228cfd75228cfd75228cfd75228cfd75228cfd75228cf</td>
</tr>`;

const OTA_ROW = `<tr id="akitabp3a.251105.015">
  <td>16.0.0 (BP3A.251105.015, Nov 2025)</td>
  <td><a href="https://dl.google.com/dl/android/aosp/akita-ota-bp3a.251105.015-abcd1234.zip">Link</a></td>
  <td>abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234</td>
</tr>`;

const WRAPPED_ROW = `<tr
  id="akitabp3a.251105.015"
  class="some-class">
  <td>16.0.0</td>
  <td><a
    href="https://flash.android.com/build/77777777?target=akita-user&amp;signed"
    rel="noopener">Flash</a></td>
  <td><a
    href="https://dl.google.com/dl/android/aosp/akita-bp3a.251105.015-factory-abcd1234.zip"
    class="link">Link</a></td>
  <td>
    abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234
  </td>
</tr>`;

test('parseRows: factory row with Flash extracts all three fields', () => {
  const result = parseRows(FACTORY_ROW_4);
  const url = 'https://dl.google.com/dl/android/aosp/akita-bp3a.251105.015-factory-abcd1234.zip';
  assert.ok(result[url]);
  assert.equal(result[url].checksum, 'abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234');
  assert.ok(result[url].flashUrl.startsWith('https://flash.android.com/build/99999999'));
});

test('parseRows: factory row without Flash has null flashUrl', () => {
  const result = parseRows(FACTORY_ROW_3);
  const url = 'https://dl.google.com/dl/android/aosp/yakju-jzo54k-factory-d75228cf.zip';
  assert.ok(result[url]);
  assert.ok(result[url].checksum !== null);
  assert.equal(result[url].flashUrl, null);
});

test('parseRows: OTA row has no flashUrl', () => {
  const result = parseRows(OTA_ROW);
  const url = 'https://dl.google.com/dl/android/aosp/akita-ota-bp3a.251105.015-abcd1234.zip';
  assert.ok(result[url]);
  assert.equal(result[url].flashUrl, null);
  assert.ok(result[url].checksum !== null);
});

test('parseRows: wrapped attributes/whitespace produce same result', () => {
  const result = parseRows(WRAPPED_ROW);
  const url = 'https://dl.google.com/dl/android/aosp/akita-bp3a.251105.015-factory-abcd1234.zip';
  assert.ok(result[url]);
  assert.ok(result[url].flashUrl.startsWith('https://flash.android.com/build/77777777'));
  assert.equal(result[url].checksum, 'abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234');
});

test('parseRows: row without firmware URL produces no entry', () => {
  const html = '<tr><td>Header row</td><td>No download</td></tr>';
  const result = parseRows(html);
  assert.equal(Object.keys(result).length, 0);
});

// ── buildOutput: metadata enrichment ─────────────────────────────────────────

test('buildOutput: attaches checksum and flashUrl from metadata map', () => {
  const googleUrl = F('akita', 'bp3a.251105.015');
  const factory = [{ device: 'akita', buildId: 'bp3a.251105.015', url: googleUrl }];
  const metaMap = new Map([[googleUrl, {
    checksum: 'abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234',
    flashUrl: 'https://flash.android.com/build/12345678?target=akita-user&signed',
  }]]);
  const out = buildOutput(factory, [], {}, {}, '', new Map(), metaMap);
  const entry = out.devices.akita.factory[0];
  assert.equal(entry[2], 'abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234');
  assert.ok(entry[3].startsWith('https://flash.android.com/build/12345678'));
});

test('buildOutput: missing metadata produces null fields', () => {
  const factory = [{ device: 'akita', buildId: 'bp3a.251105.015', url: F('akita','bp3a.251105.015') }];
  const out = buildOutput(factory, [], {}, {}, '', new Map(), new Map());
  const entry = out.devices.akita.factory[0];
  assert.equal(entry[2], null);
  assert.equal(entry[3], null);
});

test('buildOutput: omitting metadataMap parameter defaults to empty (backward compat)', () => {
  const factory = [{ device: 'akita', buildId: 'bp3a.251105.015', url: F('akita','bp3a.251105.015') }];
  const out = buildOutput(factory, [], {}, {}, '', new Map());
  const entry = out.devices.akita.factory[0];
  assert.equal(entry.length, 4);
  assert.equal(entry[2], null);
  assert.equal(entry[3], null);
});

test('buildOutput: marks watch codenames from WatchDevices.txt', () => {
  const factory = [
    { device: 'goteria', buildId: 'cd5a.260611.008', url: F('goteria', 'cd5a.260611.008') },
    { device: 'akita',   buildId: 'bp3a.251105.015', url: F('akita', 'bp3a.251105.015') },
  ];
  const out = buildOutput(factory, [], {}, {}, '', new Map(), new Map(), new Set(['goteria']));
  assert.equal(out.devices.goteria.watch, true);
  assert.equal(out.devices.akita.watch, false);
});

// ── mirror asset check ───────────────────────────────────────────────────────

test('findMissingAssets: reports a bare link that has no Release asset', () => {
  const output = { devices: { tokay: { name: 'Pixel 9', factory: [
    ['b1', 'https://github.com/o/r/releases/download/firmware-tokay-factory/tokay-b1-factory-aaaaaaaa.zip'],
  ], ota: [] } } };
  const problems = findMissingAssets(output, new Set());
  assert.equal(problems.length, 1);
  assert.match(problems[0], /missing Release asset tokay-b1-factory-aaaaaaaa\.zip$/);
});

test('findMissingAssets: flags a bare link that exists only as shards', () => {
  const output = { devices: { tokay: { name: 'Pixel 9', factory: [
    ['b1', 'https://github.com/o/r/releases/download/firmware-tokay-factory/tokay-b1-factory-aaaaaaaa.zip'],
  ], ota: [] } } };
  const problems = findMissingAssets(output, new Set(['tokay-b1-factory-aaaaaaaa.zip.part01']));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /emitted the bare file/);
});

test('findMissingAssets: passes when every URL exists', () => {
  const output = { devices: { tokay: { name: 'Pixel 9', factory: [
    ['b1', 'https://github.com/o/r/releases/download/firmware-tokay-factory/tokay-b1-factory-aaaaaaaa.zip'],
    ['b2', [
      'https://github.com/o/r/releases/download/firmware-tokay-factory/tokay-b2-factory-bbbbbbbb.zip.part01',
      'https://github.com/o/r/releases/download/firmware-tokay-factory/tokay-b2-factory-bbbbbbbb.zip.sha256',
    ]],
  ], ota: [] } } };
  const names = new Set([
    'tokay-b1-factory-aaaaaaaa.zip',
    'tokay-b2-factory-bbbbbbbb.zip.part01',
    'tokay-b2-factory-bbbbbbbb.zip.sha256',
  ]);
  assert.deepEqual(findMissingAssets(output, names), []);
});

// ── name map merge ───────────────────────────────────────────────────────────

test('mergeNameMaps: generated names fill gaps', () => {
  const merged = mergeNameMaps({ cubs: 'Pixel 11' }, {});
  assert.equal(merged.cubs, 'Pixel 11');
});

test('mergeNameMaps: curated names override generated duplicates', () => {
  const merged = mergeNameMaps(
    { aurora: 'Google Pixel Watch 2 (Bluetooth/Wi-Fi)', cubs: 'Pixel 11' },
    { aurora: 'Pixel Watch 2 (Bluetooth/Wi-Fi)' },
  );
  assert.equal(merged.aurora, 'Pixel Watch 2 (Bluetooth/Wi-Fi)');
  assert.equal(merged.cubs, 'Pixel 11');
});

// ── shell/JS regex parity ────────────────────────────────────────────────────

test('shell url patterns match the JS canonical patterns', () => {
  const shell = readFileSync(new URL('./lib/url-patterns.sh', import.meta.url), 'utf8');
  const grab = (name) => {
    const m = shell.match(new RegExp(`^readonly ${name}='([^']+)'$`, 'm'));
    assert.ok(m, `${name} not found in lib/url-patterns.sh`);
    return m[1];
  };
  const unescapeSlashes = (s) => s.replaceAll('\\/', '/');
  assert.equal(unescapeSlashes(FACTORY_RE.source), grab('FACTORY_RE'));
  assert.equal(unescapeSlashes(OTA_RE.source), grab('OTA_RE'));
});
