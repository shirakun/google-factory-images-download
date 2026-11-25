#!/usr/bin/env bash
set -Eeuo pipefail

# Builds the GitHub Actions device matrix for the firmware pipeline.
#
#   build-device-matrix.sh --all [--type factory|ota] [--github-output]
#   build-device-matrix.sh --changed <base_sha> <head_sha> [--type ...] [--github-output]
#   build-device-matrix.sh --device <codename>[:factory|:ota] [--github-output]
#
# Prints {"include":[{"device":"...","type":"factory"}, ...]} unless
# --github-output is given, in which case matrix=/count= go to $GITHUB_OUTPUT.
# A missing git base (root commit or shallow checkout) diffs against the empty tree.

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/url-patterns.sh
source "$SCRIPT_DIR/lib/url-patterns.sh"

usage() {
  cat >&2 <<'EOF'
Usage:
  build-device-matrix.sh --all [--type factory|ota] [--github-output]
  build-device-matrix.sh --changed <base_sha> <head_sha> [--type factory|ota] [--github-output]
  build-device-matrix.sh --device <codename>[:factory|:ota] [--github-output]
EOF
  exit 1
}

mode=""
base_sha=""
head_sha=""
device_spec=""
type_filter="all"
github_output=false

while (( $# > 0 )); do
  case "$1" in
    --all)      mode="all"; shift ;;
    --changed)
      [[ $# -ge 3 ]] || { echo "--changed requires <base_sha> <head_sha>" >&2; exit 1; }
      mode="changed"; base_sha="$2"; head_sha="$3"; shift 3 ;;
    --device)
      [[ $# -ge 2 ]] || { echo "--device requires a codename" >&2; exit 1; }
      mode="device"; device_spec="$2"; shift 2 ;;
    --type)
      [[ $# -ge 2 ]] || { echo "--type requires factory|ota|all" >&2; exit 1; }
      type_filter="$2"; shift 2 ;;
    --github-output) github_output=true; shift ;;
    -h|--help) usage ;;
    *) echo "Unknown argument: $1" >&2; usage ;;
  esac
done

[[ -n "$mode" ]] || usage
case "$type_filter" in
  all|factory|ota) ;;
  *) echo "Invalid --type: '$type_filter' (expected factory, ota or all)" >&2; exit 1 ;;
esac

device_only=""
if [[ "$mode" == "device" ]]; then
  if [[ "$device_spec" =~ ^([a-z0-9._]+):(factory|ota)$ ]]; then
    device_only="${BASH_REMATCH[1]}"
    requested="${BASH_REMATCH[2]}"
    if [[ "$type_filter" != "all" && "$type_filter" != "$requested" ]]; then
      echo "Conflicting filters: --device '$device_spec' vs --type '$type_filter'" >&2
      exit 1
    fi
    type_filter="$requested"
  elif [[ "$device_spec" =~ ^[a-z0-9._]+$ ]]; then
    device_only="$device_spec"
  else
    echo "Invalid --device: '$device_spec' (expected DEVICE or DEVICE:factory|ota)" >&2
    exit 1
  fi
fi

repo_root=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$repo_root"

declare -A pairs=()

collect_pairs() {
  local line device type
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    if [[ "$line" =~ $FACTORY_RE ]]; then
      device="${BASH_REMATCH[1]}"
      type="factory"
    elif [[ "$line" =~ $OTA_RE ]]; then
      device="${BASH_REMATCH[1]}"
      type="ota"
    else
      continue
    fi
    if [[ -n "$device_only" && "$device" != "$device_only" ]]; then
      continue
    fi
    if [[ "$type_filter" != "all" && "$type" != "$type_filter" ]]; then
      continue
    fi
    pairs["$device:$type"]=1
  done
}

if [[ "$mode" == "changed" ]]; then
  [[ -n "$head_sha" ]] || { echo "--changed requires a head sha" >&2; exit 1; }
  empty_tree=$(git hash-object -t tree /dev/null)
  if [[ "$base_sha" == "0000000000000000000000000000000000000000" ]] || \
     ! git rev-parse --verify --quiet "$base_sha" >/dev/null 2>&1; then
    base_sha="$empty_tree"
  fi
  # Only added lines: a removed URL no longer needs publishing.
  collect_pairs < <(
    git diff --no-ext-diff --no-color --unified=0 "$base_sha" "$head_sha" \
      -- FactoryImages.txt FullOTAImages.txt 2>/dev/null \
    | awk 'substr($0,1,1)=="+" && substr($0,1,3)!="+++" { print substr($0,2) }'
  )
else
  [[ -f FactoryImages.txt && -f FullOTAImages.txt ]] || {
    echo "FactoryImages.txt and FullOTAImages.txt are required" >&2
    exit 1
  }
  collect_pairs < <(cat -- FactoryImages.txt FullOTAImages.txt)
fi

count=${#pairs[@]}
if (( count == 0 )); then
  json='{"include":[]}'
else
  json='{"include":['
  first=1
  while IFS= read -r key; do
    [[ -z "$key" ]] && continue
    if (( first )); then
      first=0
    else
      json+=','
    fi
    json+="{\"device\":\"${key%%:*}\",\"type\":\"${key#*:}\"}"
  done <<< "$(printf '%s\n' "${!pairs[@]}" | LC_ALL=C sort)"
  json+=']}'
fi

if [[ "$github_output" == "true" ]]; then
  [[ -n "${GITHUB_OUTPUT:-}" ]] || { echo "GITHUB_OUTPUT is not set" >&2; exit 1; }
  {
    echo "matrix=$json"
    echo "count=$count"
  } >> "$GITHUB_OUTPUT"
  echo "Detected $count device/type pairs"
else
  printf '%s\n' "$json"
fi
