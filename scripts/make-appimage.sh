#!/usr/bin/env bash
# SPDX-License-Identifier: MPL-2.0
#
# Download official Firefox (linux64), apply brand name + icons, build Type-2 AppImage.
# Usage:
#   ./scripts/make-appimage.sh [output-dir]
#
# Config: brand.config.json (id, displayName, vendor, firefoxChannel, firefoxLang)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT_DIR="$(readlink -f "${1:-$ROOT/dist}")"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

CONFIG="$ROOT/brand.config.json"
if [[ ! -f "$CONFIG" ]]; then
  echo "Missing $CONFIG" >&2
  exit 1
fi

# Minimal JSON read without jq dependency for core fields
read_json() {
  local key="$1"
  python3 - "$CONFIG" "$key" <<'PY'
import json, sys
cfg = json.load(open(sys.argv[1], encoding="utf-8"))
key = sys.argv[2]
val = cfg.get(key, "")
if val is None:
    val = ""
print(val)
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
  *)
    echo "Unsupported arch: $ARCH" >&2
    exit 1
    ;;
esac

mkdir -p "$OUTPUT_DIR"
cd "$WORKDIR"

# product=firefox-latest-ssl | firefox-beta-latest-ssl | firefox-nightly-latest-ssl
case "$FIREFOX_CHANNEL" in
  latest|release|"") PRODUCT="firefox-latest-ssl" ;;
  beta) PRODUCT="firefox-beta-latest-ssl" ;;
  nightly) PRODUCT="firefox-nightly-latest-ssl" ;;
  *) PRODUCT="firefox-latest-ssl" ;;
esac

DOWNLOAD_URL="https://download.mozilla.org/?product=${PRODUCT}&os=${MOZ_OS}&lang=${FIREFOX_LANG}"
echo "[brand] ${BRAND_DISPLAY_NAME} (${BRAND_ID})"
echo "[firefox] Downloading ${DOWNLOAD_URL}"
curl -fL --retry 3 -o firefox.tar.xz "$DOWNLOAD_URL"

echo "[firefox] Extracting"
tar -xf firefox.tar.xz
rm -f firefox.tar.xz

if [[ ! -d firefox ]]; then
  echo "Expected top-level firefox/ directory in archive" >&2
  ls -la >&2
  exit 1
fi

mv firefox AppDir
cd AppDir

# Version from application.ini
VERSION="unknown"
if [[ -f application.ini ]]; then
  VERSION="$(awk -F= '/^Version=/{print $2; exit}' application.ini | tr -d '\r')"
  # Patch display identity (加法: 名称)
  sed -i \
    -e "s/^Name=.*/Name=${BRAND_DISPLAY_NAME}/" \
    -e "s/^RemotingName=.*/RemotingName=${BRAND_ID}/" \
    -e "s/^Vendor=.*/Vendor=${BRAND_VENDOR}/" \
    application.ini || true
  # Some builds use [App] Name=Firefox only
  if ! grep -q "^Name=" application.ini; then
    echo "Name=${BRAND_DISPLAY_NAME}" >> application.ini
  fi
fi
VERSION="${VERSION:-dev}"

# Overlay icons if provided
ICONS_DIR="$ROOT/icons"
overlay_icon() {
  local src="$1" dest="$2"
  if [[ -f "$src" ]]; then
    mkdir -p "$(dirname "$dest")"
    cp -f "$src" "$dest"
    echo "[icon] $src → $dest"
  fi
}

if [[ -d "$ICONS_DIR" ]]; then
  for size in 16 32 48 64 128; do
    overlay_icon \
      "$ICONS_DIR/default${size}.png" \
      "./browser/chrome/icons/default/default${size}.png"
  done
  overlay_icon "$ICONS_DIR/about-logo.png" "./browser/chrome/icons/default/about-logo.png"
  overlay_icon "$ICONS_DIR/about-logo@2x.png" "./browser/chrome/icons/default/about-logo@2x.png"
fi

# AppImage icon
ICON_SRC=""
for candidate in \
  "$ICONS_DIR/default128.png" \
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
  echo "[icon] Warning: no icon found; AppImage will have a placeholder" >&2
  # 1x1 PNG
  printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82' > "./${BRAND_ID}.png"
  cp -f "./${BRAND_ID}.png" ./.DirIcon
fi

# Rename binary for process list / Exec
if [[ -x ./firefox ]]; then
  mv ./firefox "./${BRAND_ID}"
  ln -sf "$BRAND_ID" ./firefox
fi
if [[ -x ./firefox-bin ]]; then
  mv ./firefox-bin "./${BRAND_ID}-bin"
  ln -sf "${BRAND_ID}-bin" ./firefox-bin
fi

BINARY_NAME="$BRAND_ID"
if [[ ! -x "./${BINARY_NAME}" ]]; then
  echo "Binary not found after rename" >&2
  ls -la >&2
  exit 1
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
exec "\${CURRENTDIR}/${BINARY_NAME}" "\$@"
EOF
chmod +x ./AppRun

# Portable: disable in-app updater (加法: 策略)
mkdir -p ./distribution
cat > ./distribution/policies.json <<'EOF'
{
  "policies": {
    "DisableAppUpdate": true,
    "AppAutoUpdate": false,
    "BackgroundAppUpdate": false
  }
}
EOF

# Profile directory hint via env in wrapper (optional)
# MOZ_APP_PROFILE is compile-time; for portable use, AppImage portable home works via
# sibling "${APPIMAGE}.home" — documented in README.

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

# Write resolved brand for CI artifacts
cat > "$OUTPUT_DIR/brand.env" <<EOF
BRAND_ID=${BRAND_ID}
BRAND_DISPLAY_NAME=${BRAND_DISPLAY_NAME}
BRAND_VENDOR=${BRAND_VENDOR}
FIREFOX_VERSION=${VERSION}
EOF

echo "[done] ${OUTPUT_DIR}/${APPIMAGE_NAME}"
echo "[done] Type-2 AppImage: ./${APPIMAGE_NAME} --appimage-extract"
