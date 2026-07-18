#!/usr/bin/env bash
# SPDX-License-Identifier: MPL-2.0
#
# Download official Firefox → deep-brand (omni.ja) → Type-2 AppImage
# Usage: ./scripts/make-appimage.sh [output-dir]

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT_DIR="$(readlink -f "${1:-$ROOT/dist}")"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

CONFIG="$ROOT/brand.config.json"
[[ -f "$CONFIG" ]] || { echo "Missing $CONFIG" >&2; exit 1; }

read_json() {
  python3 - "$CONFIG" "$1" <<'PY'
import json, sys
cfg = json.load(open(sys.argv[1], encoding="utf-8"))
print(cfg.get(sys.argv[2], "") or "")
PY
}

BRAND_ID="$(read_json id)"
BRAND_DISPLAY_NAME="$(read_json displayName)"
BRAND_VENDOR="$(read_json vendor)"
FIREFOX_CHANNEL="$(read_json firefoxChannel)"
FIREFOX_LANG="$(read_json firefoxLang)"

BRAND_ID="${BRAND_ID:-mybrowser}"
BRAND_DISPLAY_NAME="${BRAND_DISPLAY_NAME:-My Browser}"
BRAND_VENDOR="${BRAND_VENDOR:-MyVendor}"
FIREFOX_CHANNEL="${FIREFOX_CHANNEL:-latest}"
FIREFOX_LANG="${FIREFOX_LANG:-zh-CN}"

if [[ ! "$BRAND_ID" =~ ^[a-z][a-z0-9_-]*$ ]]; then
  echo "brand.id must be lowercase [a-z][a-z0-9_-]*: $BRAND_ID" >&2
  exit 1
fi

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
echo "[brand] ${BRAND_DISPLAY_NAME} (${BRAND_ID})"
echo "[firefox] Downloading ${DOWNLOAD_URL}"
curl -fL --retry 3 -o firefox.tar.xz "$DOWNLOAD_URL"

echo "[firefox] Extracting"
tar -xf firefox.tar.xz
rm -f firefox.tar.xz
[[ -d firefox ]] || { echo "Expected firefox/ in archive" >&2; exit 1; }

mv firefox AppDir

echo "[brand] Patching omni.ja / icons / binary name (via unzip/zip)"
# Ensure zip tools exist (CI installs them; local may need apt/pacman)
command -v unzip >/dev/null && command -v zip >/dev/null || {
  echo "Need unzip+zip. e.g. sudo apt-get install -y unzip zip" >&2
  exit 1
}
python3 "$ROOT/scripts/patch_firefox_brand.py" AppDir \
  --id "$BRAND_ID" \
  --display-name "$BRAND_DISPLAY_NAME" \
  --vendor "$BRAND_VENDOR" \
  --icons "$ROOT/icons"

cd AppDir

VERSION="unknown"
if [[ -f application.ini ]]; then
  VERSION="$(awk -F= '/^Version=/{print $2; exit}' application.ini | tr -d '\r')"
fi
VERSION="${VERSION:-dev}"

BINARY_NAME="$BRAND_ID"
if [[ ! -x "./${BINARY_NAME}" ]]; then
  echo "Branded binary missing: ${BINARY_NAME}" >&2
  ls -la >&2
  exit 1
fi

# AppImage icon
ICON_SRC=""
for candidate in \
  "$ROOT/icons/default128.png" \
  ./browser/chrome/icons/default/default128.png \
  ./browser/chrome/icons/default/default64.png; do
  if [[ -f "$candidate" ]]; then
    ICON_SRC="$candidate"
    break
  fi
done
if [[ -n "$ICON_SRC" ]]; then
  cp -f "$ICON_SRC" "./${BRAND_ID}.png"
  cp -f "$ICON_SRC" ./.DirIcon
else
  printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82' > "./${BRAND_ID}.png"
  cp -f "./${BRAND_ID}.png" ./.DirIcon
fi

cat > "./${BRAND_ID}.desktop" <<EOF
[Desktop Entry]
Version=1.0
Name=${BRAND_DISPLAY_NAME}
GenericName=Web Browser
Comment=${BRAND_DISPLAY_NAME}
Exec=${BINARY_NAME} %u
Icon=${BRAND_ID}
Terminal=false
Type=Application
MimeType=text/html;text/xml;application/xhtml+xml;application/xml;application/vnd.mozilla.xul+xml;application/rss+xml;application/rdf+xml;image/gif;image/jpeg;image/png;x-scheme-handler/http;x-scheme-handler/https;
StartupNotify=true
Categories=Network;WebBrowser;
StartupWMClass=${BRAND_ID}
EOF

cat > ./AppRun <<EOF
#!/bin/sh
CURRENTDIR="\$(dirname "\$(readlink -f "\$0")")"
export PATH="\${CURRENTDIR}:\${PATH}"
export MOZ_LEGACY_PROFILES=1
export MOZ_APP_LAUNCHER="\${APPIMAGE}"
# Avoid leftover profile from stock Firefox name when possible
exec "\${CURRENTDIR}/${BINARY_NAME}" "\$@"
EOF
chmod +x ./AppRun

cd "$WORKDIR"

APPIMAGETOOL_URL="https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-${ARCH}.AppImage"
echo "[appimage] Downloading appimagetool"
curl -fL --retry 3 -o appimagetool.AppImage "$APPIMAGETOOL_URL"
chmod +x appimagetool.AppImage

APPIMAGE_NAME="${BRAND_ID}-${VERSION}-${ARCH}.AppImage"
echo "[appimage] Building ${APPIMAGE_NAME}"
VERSION="$VERSION" ARCH="$ARCH" \
  ./appimagetool.AppImage --appimage-extract-and-run ./AppDir "./${APPIMAGE_NAME}"

mv "./${APPIMAGE_NAME}" "$OUTPUT_DIR/"
[[ -f "./${APPIMAGE_NAME}.zsync" ]] && mv "./${APPIMAGE_NAME}.zsync" "$OUTPUT_DIR/" || true

cat > "$OUTPUT_DIR/brand.env" <<EOF
BRAND_ID=${BRAND_ID}
BRAND_DISPLAY_NAME=${BRAND_DISPLAY_NAME}
BRAND_VENDOR=${BRAND_VENDOR}
FIREFOX_VERSION=${VERSION}
EOF

echo "[done] ${OUTPUT_DIR}/${APPIMAGE_NAME}"
echo "[hint] 旧配置/欢迎页可能仍缓存「Firefox」文案：请删配置目录后重开，或用便携目录："
echo "       mkdir -p ${APPIMAGE_NAME}.home && APPIMAGE_EXTRACT_AND_RUN=1 ./${APPIMAGE_NAME}"
