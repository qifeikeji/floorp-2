#!/usr/bin/env bash
# SPDX-License-Identifier: MPL-2.0
#
# Quick path: download official Firefox ONCE → brand N constellation AppImages.
# Usage: ./scripts/make-appimage.sh [output-dir]
#
# Prefer Runtime full build (make-appimage-from-dist.sh) for real MOZ_APP_NAME.
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT_DIR="$(readlink -f "${1:-$ROOT/dist}")"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

CONFIG="$ROOT/brand.config.json"
[[ -f "$CONFIG" ]] || { echo "Missing $CONFIG" >&2; exit 1; }

BC="$ROOT/scripts/brand_config.py"
VENDOR="$(python3 "$BC" vendor)"

read_optional() {
  python3 - "$CONFIG" "$1" <<'PY'
import json, sys
cfg = json.load(open(sys.argv[1], encoding="utf-8"))
print(cfg.get(sys.argv[2], "") or "")
PY
}

FIREFOX_CHANNEL="$(read_optional firefoxChannel)"
FIREFOX_LANG="$(read_optional firefoxLang)"
FIREFOX_CHANNEL="${FIREFOX_CHANNEL:-latest}"
FIREFOX_LANG="${FIREFOX_LANG:-zh-CN}"

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64) MOZ_OS="linux64" ;;
  aarch64|arm64) MOZ_OS="linux64-aarch64"; ARCH="aarch64" ;;
  *) echo "Unsupported arch: $ARCH" >&2; exit 1 ;;
esac

case "$FIREFOX_CHANNEL" in
  latest|release|"") PRODUCT="firefox-latest-ssl" ;;
  beta) PRODUCT="firefox-beta-latest-ssl" ;;
  nightly) PRODUCT="firefox-nightly-latest-ssl" ;;
  *) PRODUCT="firefox-latest-ssl" ;;
esac

mkdir -p "$OUTPUT_DIR"
cd "$WORKDIR"

DOWNLOAD_URL="https://download.mozilla.org/?product=${PRODUCT}&os=${MOZ_OS}&lang=${FIREFOX_LANG}"
echo "[firefox] Downloading ${DOWNLOAD_URL} (once → N variants)"
curl -fL --retry 3 -o firefox.tar.xz "$DOWNLOAD_URL"

mkdir -p "$WORKDIR/dist-src"
tar -xf firefox.tar.xz -C "$WORKDIR/dist-src"
rm -f firefox.tar.xz
[[ -d "$WORKDIR/dist-src/firefox" ]] || {
  echo "Expected firefox/ in archive" >&2
  ls -la "$WORKDIR/dist-src" >&2
  exit 1
}

command -v unzip >/dev/null && command -v zip >/dev/null || {
  echo "Need unzip+zip. e.g. sudo apt-get install -y unzip zip" >&2
  exit 1
}

echo "[brand] vendor=${VENDOR}; packing all variants from brand.config.json"
PACK_FROM_ID=firefox PACK_FROM_DISPLAY="Firefox" \
  "$ROOT/scripts/make-appimage-from-dist.sh" "$WORKDIR/dist-src" "$OUTPUT_DIR"

echo "[done] upstream multi-brand under ${OUTPUT_DIR}"
