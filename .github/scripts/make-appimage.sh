#!/usr/bin/env bash
# SPDX-License-Identifier: MPL-2.0
#
# Build a standard Type-2 AppImage from a Floorp Linux tar.xz package.
# The result supports: ./Floorp-*.AppImage --appimage-extract

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: make-appimage.sh <input-tar.xz> [output-dir]

Creates a Type-2 AppImage that can be extracted with --appimage-extract.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" || $# -lt 1 ]]; then
  usage
  exit 1
fi

INPUT_TAR="$(readlink -f "$1")"
OUTPUT_DIR="$(readlink -f "${2:-.}")"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|aarch64) ;;
  arm64) ARCH="aarch64" ;;
  *)
    echo "Unsupported architecture: $ARCH" >&2
    exit 1
    ;;
esac

if [[ ! -f "$INPUT_TAR" ]]; then
  echo "Input archive not found: $INPUT_TAR" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
cd "$WORKDIR"

echo "[appimage] Extracting $INPUT_TAR"
tar -xJf "$INPUT_TAR"

APP_DIR=""
for candidate in floorp noraneko firefox; do
  if [[ -d "$candidate" ]]; then
    APP_DIR="$candidate"
    break
  fi
done

if [[ -z "$APP_DIR" ]]; then
  # Fallback: single top-level directory
  APP_DIR="$(find . -maxdepth 1 -mindepth 1 -type d | head -n 1)"
fi

if [[ -z "$APP_DIR" || ! -d "$APP_DIR" ]]; then
  echo "Could not locate browser directory inside archive" >&2
  tar -tJf "$INPUT_TAR" | head -20 >&2
  exit 1
fi

mv "$APP_DIR" AppDir
cd AppDir

# Resolve version from application.ini when available
VERSION="unknown"
if [[ -f application.ini ]]; then
  VERSION="$(awk -F= '/^Version=/{print $2; exit}' application.ini | tr -d '\r')"
fi
if [[ -z "$VERSION" || "$VERSION" == "unknown" ]]; then
  VERSION="${FLOORP_VERSION:-dev}"
fi

# Icon
ICON_SRC=""
for candidate in \
  ./browser/chrome/icons/default/default128.png \
  ./chrome/icons/default/default128.png \
  ./browser/chrome/icons/default/default64.png; do
  if [[ -f "$candidate" ]]; then
    ICON_SRC="$candidate"
    break
  fi
done

if [[ -n "$ICON_SRC" ]]; then
  cp -f "$ICON_SRC" ./floorp.png
  cp -f "$ICON_SRC" ./.DirIcon
else
  echo "[appimage] Warning: no icon found, creating placeholder" >&2
  # Minimal valid 1x1 PNG placeholder is not ideal; leave missing and rely on desktop entry
  touch ./floorp.png ./.DirIcon
fi

# Desktop entry (AppImage Type 2 requires one at AppDir root)
BINARY_NAME="floorp"
if [[ -x ./floorp ]]; then
  BINARY_NAME="floorp"
elif [[ -x ./noraneko ]]; then
  BINARY_NAME="noraneko"
elif [[ -x ./firefox ]]; then
  BINARY_NAME="firefox"
else
  echo "Browser binary not found in AppDir" >&2
  ls -la >&2
  exit 1
fi

cat > ./floorp.desktop <<EOF
[Desktop Entry]
Version=1.0
Name=Floorp
GenericName=Web Browser
Comment=Floorp Browser
Exec=${BINARY_NAME} %u
Icon=floorp
Terminal=false
Type=Application
MimeType=text/html;text/xml;application/xhtml+xml;application/xml;application/vnd.mozilla.xul+xml;application/rss+xml;application/rdf+xml;image/gif;image/jpeg;image/png;x-scheme-handler/http;x-scheme-handler/https;
StartupNotify=true
Categories=Network;WebBrowser;
StartupWMClass=floorp
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

# Disable in-app updater for portable AppImage installs
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

cd "$WORKDIR"

APPIMAGETOOL_URL="https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-${ARCH}.AppImage"
echo "[appimage] Downloading appimagetool (${ARCH})"
wget -q "$APPIMAGETOOL_URL" -O ./appimagetool.AppImage
chmod +x ./appimagetool.AppImage

APPIMAGE_NAME="Floorp-${VERSION}-${ARCH}.AppImage"
echo "[appimage] Building ${APPIMAGE_NAME} (Type 2)"
VERSION="$VERSION" ARCH="$ARCH" \
  ./appimagetool.AppImage --appimage-extract-and-run ./AppDir "./${APPIMAGE_NAME}"

mv "./${APPIMAGE_NAME}" "$OUTPUT_DIR/"
if [[ -f "./${APPIMAGE_NAME}.zsync" ]]; then
  mv "./${APPIMAGE_NAME}.zsync" "$OUTPUT_DIR/" || true
fi

echo "[appimage] Done: ${OUTPUT_DIR}/${APPIMAGE_NAME}"
echo "$VERSION" > "$OUTPUT_DIR/version.txt"
