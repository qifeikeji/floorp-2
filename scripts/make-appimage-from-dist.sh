#!/usr/bin/env bash
# SPDX-License-Identifier: MPL-2.0
#
# Build N Type-2 AppImages from ONE mach package (compile once → pack many).
#
# Usage:
#   ./scripts/make-appimage-from-dist.sh /path/to/obj-<compileId>/dist [output-dir]
#
# Reads brand.config.json variants[]. Shared icons from icons/.
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="${1:-}"
OUTPUT_DIR="$(readlink -f "${2:-$ROOT/dist}")"
[[ -n "$DIST" && -d "$DIST" ]] || { echo "Usage: $0 <mach-dist-dir> [out]" >&2; exit 1; }
DIST="$(readlink -f "$DIST")"

BC="$ROOT/scripts/brand_config.py"
COMPILE_ID="$(python3 "$BC" compile-id)"
COMPILE_DISPLAY="$(python3 "$BC" compile-display)"
VENDOR="$(python3 "$BC" vendor)"
# Upstream quick path: PACK_FROM_ID=firefox (binary still named firefox)
FROM_ID="${PACK_FROM_ID:-$COMPILE_ID}"
FROM_DISPLAY="${PACK_FROM_DISPLAY:-$COMPILE_DISPLAY}"
mapfile -t VARIANT_IDS < <(python3 "$BC" variant-ids)
VARIANTS_JSON="$(python3 "$BC" variants-json)"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
mkdir -p "$OUTPUT_DIR"
cd "$WORKDIR"

# --- extract package once ---
TARBALL=""
for pattern in \
  "$DIST/${FROM_ID}"*.tar.xz \
  "$DIST/${COMPILE_ID}"*.tar.xz \
  "$DIST"/*"${COMPILE_ID}"*.tar.xz \
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

TEMPLATE="$WORKDIR/template"
mkdir -p "$TEMPLATE"
if [[ -n "$TARBALL" ]]; then
  echo "[appimage] Using tarball $TARBALL"
  tar -xJf "$TARBALL" -C "$TEMPLATE"
else
  for d in "$DIST/$FROM_ID" "$DIST/$COMPILE_ID" "$DIST/firefox" "$DIST/floorp"; do
    if [[ -d "$d" ]]; then
      cp -a "$d" "$TEMPLATE/$(basename "$d")"
      break
    fi
  done
fi

APP_SRC=""
for candidate in "$FROM_ID" "$COMPILE_ID" firefox floorp; do
  if [[ -d "$TEMPLATE/$candidate" ]]; then
    APP_SRC="$TEMPLATE/$candidate"
    break
  fi
done
# tarball may extract files directly into TEMPLATE
if [[ -z "$APP_SRC" ]]; then
  for candidate in "$FROM_ID" "$COMPILE_ID" firefox floorp; do
    if [[ -x "$TEMPLATE/$candidate" ]]; then
      APP_SRC="$TEMPLATE"
      break
    fi
  done
fi
[[ -n "$APP_SRC" ]] || { echo "No app dir in package" >&2; ls -la "$TEMPLATE" >&2; exit 1; }

VERSION="unknown"
if [[ -f "$APP_SRC/application.ini" ]]; then
  VERSION="$(awk -F= '/^Version=/{print $2; exit}' "$APP_SRC/application.ini" | tr -d '\r')"
fi
VERSION="${VERSION:-dev}"

ARCH="$(uname -m)"
case "$ARCH" in
  arm64) ARCH=aarch64 ;;
esac

echo "[appimage] Downloading appimagetool once"
curl -fL --retry 3 \
  "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-${ARCH}.AppImage" \
  -o "$WORKDIR/appimagetool.AppImage"
chmod +x "$WORKDIR/appimagetool.AppImage"

ICON_SRC=""
for c in \
  "$ROOT/icons/default128.png" \
  "$APP_SRC/browser/chrome/icons/default/default128.png" \
  "$APP_SRC/chrome/icons/default/default128.png"; do
  [[ -f "$c" ]] && ICON_SRC="$c" && break
done

variant_field() {
  local id="$1" field="$2"
  python3 -c "
import json, sys
variants = json.loads(sys.argv[1])
vid = sys.argv[2]
field = sys.argv[3]
for v in variants:
    if v['id'] == vid:
        print(v.get(field, '') or '')
        break
else:
    sys.exit(f'unknown variant {vid}')
" "$VARIANTS_JSON" "$id" "$field"
}

echo "[appimage] from=${FROM_ID} compileId=${COMPILE_ID} → ${#VARIANT_IDS[@]} variants"

for VID in "${VARIANT_IDS[@]}"; do
  VDISPLAY="$(variant_field "$VID" displayName)"
  VPROFILE="$(variant_field "$VID" profileDir)"
  echo ""
  echo "[appimage] === Packaging ${VID} (${VDISPLAY}) ==="

  VARIANT_WORK="$WORKDIR/pack-$VID"
  rm -rf "$VARIANT_WORK"
  mkdir -p "$VARIANT_WORK"
  cp -a "$APP_SRC" "$VARIANT_WORK/AppDir"
  APPDIR="$VARIANT_WORK/AppDir"

  python3 "$ROOT/scripts/patch_firefox_brand.py" "$APPDIR" \
    --id "$VID" \
    --display-name "$VDISPLAY" \
    --vendor "$VENDOR" \
    --icons "$ROOT/icons" \
    --from-id "$FROM_ID" \
    --from-display "$FROM_DISPLAY" \
    --profile-dir "$VPROFILE"

  BINARY_NAME="$VID"
  if [[ ! -x "$APPDIR/$BINARY_NAME" ]]; then
    echo "[appimage] ERROR: missing binary $APPDIR/$BINARY_NAME" >&2
    ls -la "$APPDIR" >&2
    exit 1
  fi

  if [[ -n "$ICON_SRC" ]]; then
    cp -f "$ICON_SRC" "$APPDIR/${VID}.png"
    cp -f "$ICON_SRC" "$APPDIR/.DirIcon"
  fi

  cat > "$APPDIR/${VID}.desktop" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=${VDISPLAY}
GenericName=Web Browser
Comment=${VDISPLAY}
Exec=${BINARY_NAME} %u
Icon=${VID}
Terminal=false
StartupNotify=true
Categories=Network;WebBrowser;
StartupWMClass=${VID}
EOF

  cat > "$APPDIR/AppRun" <<EOF
#!/bin/sh
CURRENTDIR="\$(dirname "\$(readlink -f "\$0")")"
export PATH="\${CURRENTDIR}:\${PATH}"
export MOZ_LEGACY_PROFILES=1
export MOZ_APP_LAUNCHER="\${APPIMAGE}"
export MOZ_APP_REMOTINGNAME="${VID}"

# Wayland by default. Optional: XINGCHEN_FORCE_X11=1
if [ "\${XINGCHEN_FORCE_X11:-}" = "1" ]; then
  export MOZ_ENABLE_WAYLAND=0
  export GDK_BACKEND=x11
elif [ -n "\${WAYLAND_DISPLAY:-}" ] || [ "\${XDG_SESSION_TYPE:-}" = "wayland" ]; then
  export MOZ_ENABLE_WAYLAND=1
  case "\${GDK_BACKEND:-}" in
    x11) export GDK_BACKEND=wayland ;;
  esac
fi

exec "\${CURRENTDIR}/${BINARY_NAME}" \\
  --name "${VID}" \\
  --class "${VID}" \\
  "\$@"
EOF
  chmod +x "$APPDIR/AppRun"

  OUT_SUB="$OUTPUT_DIR/$VID"
  mkdir -p "$OUT_SUB"
  APPIMAGE_NAME="${VID}-${VERSION}-${ARCH}.AppImage"

  (
    cd "$VARIANT_WORK"
    VERSION="$VERSION" ARCH="$ARCH" \
      "$WORKDIR/appimagetool.AppImage" --appimage-extract-and-run ./AppDir "./${APPIMAGE_NAME}"
  )
  mv "$VARIANT_WORK/${APPIMAGE_NAME}" "$OUT_SUB/"
  # Small sidecar for humans browsing Actions artifacts
  cat > "$OUT_SUB/README.txt" <<EOF
id=${VID}
displayName=${VDISPLAY}
vendor=${VENDOR}
profileDir=${VPROFILE}
compileId=${COMPILE_ID}
version=${VERSION}
EOF
  echo "[done] $OUT_SUB/$APPIMAGE_NAME"
done

echo ""
echo "[done] Packaged ${#VARIANT_IDS[@]} AppImages under $OUTPUT_DIR"
echo "[note] Wayland app_id is compile-time '${COMPILE_ID}' for all variants;"
echo "       UI name / binary / .desktop / RemotingName differ per constellation."
