#!/usr/bin/env bash
set -Eeuo pipefail

# Scrapes Google's Android developer pages and updates the committed URL lists.
# Requires no external secrets; the devsite_wall_acks cookie is a TOS acknowledgement
# marker, not an authentication credential.

readonly FACTORY_URL='https://developers.google.com/android/images'
readonly OTA_URL='https://developers.google.com/android/ota'
readonly DRIVERS_URL='https://developers.google.com/android/drivers'
readonly WATCH_FACTORY_URL='https://developers.google.com/android/images-watch'
readonly WATCH_OTA_URL='https://developers.google.com/android/ota-watch'

# shellcheck source=lib/url-patterns.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/url-patterns.sh"

readonly MIN_FACTORY=100
readonly MIN_OTA=100
readonly MIN_DRIVERS=50
readonly MIN_WATCH_FACTORY=140
readonly MIN_WATCH_OTA=140
readonly MIN_WATCH_DEVICES=5

TMPDIR=""

cleanup() {
  [[ -n "$TMPDIR" ]] && rm -rf "$TMPDIR"
}
trap cleanup EXIT

log()  { echo "[$(date +%H:%M:%S)] $*"; }
fatal() { echo "[$(date +%H:%M:%S)] FATAL: $*" >&2; exit 1; }

scrape() {
  local page_url="$1" extract_re="$2" output="$3" label="${4:-scrape}"
  local raw="$TMPDIR/raw_${label}.html"

  curl --fail --silent --show-error --location --compressed \
    --retry 5 --retry-all-errors --retry-delay 5 \
    --connect-timeout 20 --max-time 180 \
    --user-agent 'Mozilla/5.0 (X11; Linux x86_64; rv:102.0) Gecko/20100101 Firefox/102.0' \
    --header 'x-devsite-partial-request: 1' \
    --cookie 'devsite_wall_acks=nexus-image-tos,nexus-ota-tos,watch-image-tos,watch-ota-tos' \
    "$page_url" > "$raw"

  local grep_rc=0
  grep -oE "$extract_re" "$raw" \
    | LC_ALL=C sort -u > "$output" \
    || grep_rc=$?

  if (( grep_rc > 1 )); then
    fatal "$label: grep extraction error (status $grep_rc)"
  fi
}

validate() {
  local output="$1" full_re="$2" min_count="$3" label="$4"

  local count
  count=$(wc -l < "$output")

  if (( count < min_count )); then
    fatal "$label: only $count URLs extracted (minimum $min_count required)"
  fi

  local invalid
  invalid=$(grep -cvE "$full_re" "$output" || true)
  if (( invalid > 0 )); then
    fatal "$label: $invalid lines failed regex validation"
  fi

  log "$label: $count URLs validated"
}

extract_devices() {
  local file line
  for file in "$@"; do
    while IFS= read -r line || [[ -n "$line" ]]; do
      line="${line%$'\r'}"
      if [[ "$line" =~ $FACTORY_RE ]]; then
        echo "${BASH_REMATCH[1]}"
      elif [[ "$line" =~ $OTA_RE ]]; then
        echo "${BASH_REMATCH[1]}"
      fi
    done < "$file"
  done
}

atomic_replace() {
  local src="$1" dst="$2"
  if diff -q "$src" "$dst" >/dev/null 2>&1; then
    log "$(basename "$dst"): unchanged, skipping"
  else
    cp -- "$src" "$dst"
    log "$(basename "$dst"): updated"
  fi
}

main() {
  TMPDIR=$(mktemp -d)

  local repo_root
  repo_root=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
  cd "$repo_root"

  log "Scraping factory images..."
  scrape "$FACTORY_URL" 'https://dl\.google\.com/dl/android/aosp/[^"]+\.zip' "$TMPDIR/factory_phone.txt" "FactoryImages"
  validate "$TMPDIR/factory_phone.txt" "$FACTORY_RE" "$MIN_FACTORY" "FactoryImages"

  log "Scraping watch factory images..."
  scrape "$WATCH_FACTORY_URL" 'https://dl\.google\.com/dl/android/aosp/[^"]+\.zip' "$TMPDIR/factory_watch.txt" "WatchImages"
  validate "$TMPDIR/factory_watch.txt" "$FACTORY_RE" "$MIN_WATCH_FACTORY" "WatchImages"

  LC_ALL=C sort -u "$TMPDIR/factory_phone.txt" "$TMPDIR/factory_watch.txt" > "$TMPDIR/factory.txt"

  log "Scraping OTA images..."
  scrape "$OTA_URL" 'https://dl\.google\.com/dl/android/aosp/[^"]+\.zip' "$TMPDIR/ota_phone.txt" "FullOTAImages"
  validate "$TMPDIR/ota_phone.txt" "$OTA_RE" "$MIN_OTA" "FullOTAImages"

  log "Scraping watch OTA images..."
  scrape "$WATCH_OTA_URL" 'https://dl\.google\.com/dl/android/aosp/[^"]+\.zip' "$TMPDIR/ota_watch.txt" "WatchOTAImages"
  validate "$TMPDIR/ota_watch.txt" "$OTA_RE" "$MIN_WATCH_OTA" "WatchOTAImages"

  LC_ALL=C sort -u "$TMPDIR/ota_phone.txt" "$TMPDIR/ota_watch.txt" > "$TMPDIR/ota.txt"

  log "Scraping driver binaries..."
  scrape "$DRIVERS_URL" 'https://dl\.google\.com/dl/android/aosp/[^"]+\.tgz' "$TMPDIR/drivers.txt" "DriverBinaries"
  validate "$TMPDIR/drivers.txt" "$DRIVERS_RE" "$MIN_DRIVERS" "DriverBinaries"

  log "Collecting watch device codenames..."
  extract_devices "$TMPDIR/factory_watch.txt" "$TMPDIR/ota_watch.txt" \
    | LC_ALL=C sort -u > "$TMPDIR/watch_devices.txt"

  local watch_count invalid_devices
  watch_count=$(wc -l < "$TMPDIR/watch_devices.txt")
  if (( watch_count < MIN_WATCH_DEVICES )); then
    fatal "WatchDevices: only $watch_count device codenames (minimum $MIN_WATCH_DEVICES required)"
  fi
  invalid_devices=$(grep -cvE '^[a-z0-9._]+$' "$TMPDIR/watch_devices.txt" || true)
  if (( invalid_devices > 0 )); then
    fatal "WatchDevices: $invalid_devices invalid codenames"
  fi
  log "WatchDevices: $watch_count device codenames validated"

  atomic_replace "$TMPDIR/factory.txt" "FactoryImages.txt"
  atomic_replace "$TMPDIR/ota.txt" "FullOTAImages.txt"
  atomic_replace "$TMPDIR/drivers.txt" "DriverBinaries.txt"
  atomic_replace "$TMPDIR/watch_devices.txt" "WatchDevices.txt"

  log "Building generated device-name map..."
  node --input-type=module <<NODEEOF
import { readFileSync, writeFileSync } from 'node:fs';
const files = [
  '$TMPDIR/raw_FactoryImages.html',
  '$TMPDIR/raw_WatchImages.html',
  '$TMPDIR/raw_FullOTAImages.html',
  '$TMPDIR/raw_WatchOTAImages.html',
];
const names = {};
for (const file of files) {
  let html;
  try {
    html = readFileSync(file, 'utf8');
  } catch (e) {
    process.stderr.write('[WARN] device names skipped for ' + file + ': ' + e.message + '\\n');
    continue;
  }
  for (const m of html.matchAll(/<h2 id="([a-z0-9._]+)"[^>]*data-text="[^"]*?for ([^"&]+)"/g)) {
    names[m[1]] = m[2].trim();
  }
}
const sorted = Object.fromEntries(Object.entries(names).sort(([a], [b]) => a.localeCompare(b)));
if (Object.keys(sorted).length < 50) {
  console.error('[FATAL] device-names.generated.json: only ' + Object.keys(sorted).length + ' names (expected 50+)');
  process.exit(1);
}
writeFileSync('$TMPDIR/device-names.generated.json', JSON.stringify(sorted, null, 2) + '\\n');
process.stderr.write('[INFO] device-names.generated.json: ' + Object.keys(sorted).length + ' entries\\n');
NODEEOF

  atomic_replace "$TMPDIR/device-names.generated.json" "site/device-names.generated.json"

  log "Building firmware metadata sidecar..."
  node --input-type=module <<NODEEOF
import { parseRows } from './.github/scripts/scrape-metadata.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
const labels = ['FactoryImages', 'WatchImages', 'FullOTAImages', 'WatchOTAImages'];
const merged = {};
for (const label of labels) {
  try {
    const html = readFileSync('$TMPDIR/raw_' + label + '.html', 'utf8');
    Object.assign(merged, parseRows(html));
  } catch (e) {
    process.stderr.write('[WARN] metadata scrape skipped for ' + label + ': ' + e.message + '\\n');
  }
}
writeFileSync('$TMPDIR/FirmwareMetadata.json', JSON.stringify(merged));
process.stderr.write('[INFO] FirmwareMetadata.json: ' + Object.keys(merged).length + ' entries\\n');
NODEEOF
  atomic_replace "$TMPDIR/FirmwareMetadata.json" "FirmwareMetadata.json"

  log "Done"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
