#!/usr/bin/env bash
# SPDX-License-Identifier: MPL-2.0
#
# Build Type-2 AppImage from a mach package output directory
# (obj-*/dist containing <id>.tar.xz or an extracted <id>/ folder).
#
# Usage:
#   ./scripts/make-appimage-from-dist.sh /path/to/obj-xingchen/dist [output-dir]
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="${1:-}"
OUTPUT_DIR="$(readlink -f "${2:-$ROOT/dist}")"
[[ -n "$DIST" && -d "$DIST" ]] || { echo "Usage: $0 <mach-dist-dir> [out]" >&2; exit 1; }
DIST="$(readlink -f "$DIST")"

ID="$(python3 -c "import json;print(json.load(open('$ROOT/brand.config.json'))['id'])")"
DISPLAY="$(python3 -c "import json;print(json.load(open('$ROOT/brand.config.json'))['displayName'])")"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
mkdir -p "$OUTPUT_DIR"
cd "$WORKDIR"

# Find tarball from mach package
TARBALL=""
for pattern in \
  "$DIST/${ID}"*.tar.xz \
  "$DIST"/*"${ID}"*.tar.xz \
  "$DIST"/firefox-*.tar.xz \
  "$DIST"/floorp-*.tar.xz \
  "$DIST"/*.tar.xz; do
  for f in $pattern; do
    if [[ -f "$f" ]]; then
      TARBALL="$f"
      break 2
    fi
  done
done

if [[ -n "$TARBALL" ]]; then
  echo "[appimage] Using tarball $TARBALL"
  tar -xJf "$TARBALL"
else
  # Already extracted dir
  for d in "$DIST/$ID" "$DIST/firefox" "$DIST/floorp"; do
    if [[ -d "$d" ]]; then
      cp -a "$d" "./$(basename "$d")"
      break
    fi
  done
fi

APP_DIR=""
for candidate in "$ID" firefox floorp; do
  if [[ -d "$candidate" ]]; then
    APP_DIR="$candidate"
    break
  fi
done
[[ -n "$APP_DIR" ]] || { echo "No app dir in package" >&2; ls -la >&2; exit 1; }

mv "$APP_DIR" AppDir
cd AppDir

# Ensure binary name matches id (Runtime build with --with-app-name should already)
if [[ -x ./$ID ]]; then
  BINARY_NAME="$ID"
elif [[ -x ./firefox ]]; then
  mv ./firefox "./$ID"
  BINARY_NAME="$ID"
elif [[ -x ./floorp ]]; then
  mv ./floorp "./$ID"
  BINARY_NAME="$ID"
else
  echo "Browser binary not found" >&2
  ls -la >&2
  exit 1
fi

VERSION="unknown"
if [[ -f application.ini ]]; then
  VERSION="$(awk -F= '/^Version=/{print $2; exit}' application.ini | tr -d '\r')"
fi
VERSION="${VERSION:-dev}"

ICON_SRC=""
for c in \
  "$ROOT/icons/default128.png" \
  ./browser/chrome/icons/default/default128.png \
  ./chrome/icons/default/default128.png; do
  [[ -f "$c" ]] && ICON_SRC="$c" && break
done
if [[ -n "$ICON_SRC" ]]; then
  cp -f "$ICON_SRC" "./${ID}.png"
  cp -f "$ICON_SRC" ./.DirIcon
fi

cat > "./${ID}.desktop" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=${DISPLAY}
GenericName=Web Browser
Comment=${DISPLAY}
Exec=${BINARY_NAME} %u
Icon=${ID}
Terminal=false
StartupNotify=true
Categories=Network;WebBrowser;
StartupWMClass=${ID}
EOF

cat > ./AppRun <<EOF
#!/bin/sh
CURRENTDIR="\$(dirname "\$(readlink -f "\$0")")"
export PATH="\${CURRENTDIR}:\${PATH}"
export MOZ_LEGACY_PROFILES=1
export MOZ_APP_LAUNCHER="\${APPIMAGE}"
export MOZ_APP_REMOTINGNAME="${ID}"
exec "\${CURRENTDIR}/${BINARY_NAME}" "\$@"
EOF
chmod +x ./AppRun

cd "$WORKDIR"
ARCH="$(uname -m)"
case "$ARCH" in
  arm64) ARCH=aarch64 ;;
esac

curl -fL --retry 3 \
  "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-${ARCH}.AppImage" \
  -o appimagetool.AppImage
chmod +x appimagetool.AppImage

APPIMAGE_NAME="${ID}-${VERSION}-${ARCH}.AppImage"
VERSION="$VERSION" ARCH="$ARCH" \
  ./appimagetool.AppImage --appimage-extract-and-run ./AppDir "./${APPIMAGE_NAME}"

mv "./${APPIMAGE_NAME}" "$OUTPUT_DIR/"
echo "[done] $OUTPUT_DIR/$APPIMAGE_NAME"
echo "[note] Wayland app_id should be '${ID}' (compile-time MOZ_APP_NAME) — GNOME panel matches ${ID}.desktop"
