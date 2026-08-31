# google-factory-images-download

Automated archive of Google Pixel and Nexus firmware — factory images, full OTA updates, and driver binaries — mirrored from Google's official developer pages to GitHub Releases.

**[Firmware Browser →](https://google-firmware-browser.pages.dev)**

## How it works

```
Daily cron (03:17 UTC)
  └─ update-url-lists.yml
       ├─ Scrapes FactoryImages.txt / FullOTAImages.txt / DriverBinaries.txt from Google
       └─ Pushes changes → master
             ├─ publish-firmware-orchestrator.yml
             │    ├─ Detects changed devices (git diff)
             │    └─ Parallel jobs → publish-firmware.yml
             │         └─ Download → Verify → Split (>2 GB) → Upload to Releases
             └─ build-pages.yml
                  └─ Build Angular app → Deploy to Cloudflare Pages
```

## Firmware sources

| Type | Source |
|------|--------|
| Factory Images (phones/tablets) | https://developers.google.com/android/images |
| Full OTA Images (phones/tablets) | https://developers.google.com/android/ota |
| Factory Images (Pixel Watch) | https://developers.google.com/android/images-watch |
| Full OTA Images (Pixel Watch) | https://developers.google.com/android/ota-watch |
| Driver Binaries | https://developers.google.com/android/drivers |

## Releases

Each device/type combination has a dedicated GitHub Release:

- Tag format: `firmware-{codename}-{factory|ota}`
- Files exceeding GitHub's 2 GB asset limit are split into `.partNN` files with a `.sha256` manifest

**To reassemble split files manually:**
```bash
cat <filename>.part* > <filename>
sha256sum --check <filename>.sha256
```

The Firmware Browser also offers a **Download full image** action for sharded releases when the Cloudflare Pages merge Function has an allowlisted shard set. Chromium-based browsers stream the merged file directly to disk and verify SHA-256 when metadata is available; other browsers fall back to the native download manager. The original `.partNN` links and manifest remain available under **Show individual parts** for manual recovery.

## Setup

Required secrets:

| Secret | Purpose |
|--------|---------|
| `RELEASE_TOKEN` | PAT with `repo` scope — allows `update-url-lists.yml` pushes to trigger downstream workflows |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token with Pages Edit permission |

## Disclaimer

All firmware files are provided by Google Inc. This repository mirrors them as-is for archival and convenience. Google and Pixel are trademarks of Google LLC.

