#!/usr/bin/env bash
# Canonical AOSP download URL patterns, shared by every pipeline script.
#
# Keep in sync with FACTORY_RE / OTA_RE in .github/scripts/build-pages-data.mjs:
# build-pages-data.test.mjs asserts both sides are identical, so changing one
# without the other fails CI.
#
# Usage:
#   source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/url-patterns.sh"

readonly FACTORY_RE='^https://dl\.google\.com/dl/android/aosp/([a-z0-9._]+)-([A-Za-z0-9._]+)-factory-([0-9a-f]{8})\.zip$'
readonly OTA_RE='^https://dl\.google\.com/dl/android/aosp/([a-z0-9._]+)-ota-([A-Za-z0-9._]+)-([0-9a-f]{8})\.zip$'
readonly DRIVERS_RE='^https://dl\.google\.com/dl/android/aosp/[a-z0-9_]+-[A-Za-z0-9._-]+-[0-9a-f]{8}\.tgz$'
