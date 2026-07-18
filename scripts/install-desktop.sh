#!/usr/bin/env bash
# SPDX-License-Identifier: MPL-2.0
#
# Make GNOME (Wayland or X11) show 星辰 instead of "Mozilla Firefox".
#
# Why Wayland still shows Firefox:
#   Official Firefox reports Wayland app_id = "firefox", so GNOME always
#   loads /usr/share/applications/firefox.desktop for the panel title/icon.
#   Process rename does NOT change that.
#
# Fix (Wayland-native, no need to disable Wayland):
#   Install ~/.local/share/applications/firefox.desktop that OVERRIDES the
#   system one: same app_id match, but Name/Icon/Exec = 星辰 / xingchen.
#
# Usage:
#   ./scripts/install-desktop.sh /path/to/xingchen-app-dir
#
set -euo pipefail

SRC="${1:-}"
if [[ -z "$SRC" || ! -d "$SRC" ]]; then
  echo "Usage: $0 /path/to/xingchen-*-dir" >&2
  echo "  (AppImageLauncher extract dir, or squashfs-root after --appimage-extract)" >&2
  exit 1
fi
SRC="$(readlink -f "$SRC")"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$ROOT/brand.config.json"
ID="$(python3 -c "import json;print(json.load(open('$CONFIG'))['id'])")"
NAME="$(python3 -c "import json;print(json.load(open('$CONFIG'))['displayName'])")"

APP_LOCAL="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
ICON_LOCAL="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/128x128/apps"
mkdir -p "$APP_LOCAL" "$ICON_LOCAL"

ICON_SRC=""
for c in "$SRC/${ID}.png" "$SRC/browser/chrome/icons/default/default128.png" "$ROOT/icons/default128.png"; do
  if [[ -f "$c" ]]; then
    ICON_SRC="$c"
    break
  fi
done
if [[ -n "$ICON_SRC" ]]; then
  cp -f "$ICON_SRC" "$ICON_LOCAL/${ID}.png"
  # Also install as "firefox" icon name so overridden firefox.desktop can use Icon=firefox
  # pointing to our art — actually use Icon=${ID} in desktop files.
fi

BIN="$SRC/${ID}"
if [[ ! -x "$BIN" ]]; then
  if [[ -x "$SRC/AppRun" ]]; then
    BIN="$SRC/AppRun"
  else
    echo "No executable ${ID} or AppRun in $SRC" >&2
    exit 1
  fi
fi

# Shared Exec line: keep Wayland; remoting name helps some DEs
EXEC_LINE="env MOZ_APP_REMOTINGNAME=${ID} ${BIN} --name ${ID} --class ${ID} %u"

# 1) Native desktop id = brand id (works when WM_CLASS/app_id == xingchen)
cat > "$APP_LOCAL/${ID}.desktop" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=${NAME}
GenericName=Web Browser
Comment=${NAME}
Exec=${EXEC_LINE}
Icon=${ID}
Terminal=false
StartupNotify=true
Categories=Network;WebBrowser;
StartupWMClass=${ID}
EOF

# 2) Wayland fix: override system firefox.desktop (GNOME matches app_id "firefox")
cat > "$APP_LOCAL/firefox.desktop" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=${NAME}
GenericName=Web Browser
Comment=${NAME} (replaces system Firefox entry for panel matching)
Exec=${EXEC_LINE}
Icon=${ID}
Terminal=false
StartupNotify=true
Categories=Network;WebBrowser;
StartupWMClass=firefox
Actions=
EOF

update-desktop-database "$APP_LOCAL" 2>/dev/null || true

echo ""
echo "Installed:"
echo "  $APP_LOCAL/${ID}.desktop"
echo "  $APP_LOCAL/firefox.desktop   ← Wayland/GNOME panel uses this (overrides system Firefox name/icon)"
echo ""
echo "Next:"
echo "  1) Fully quit the browser"
echo "  2) Unpin 'Firefox' from the dock if pinned"
echo "  3) Start again from the AppImage / ${NAME} menu entry"
echo "  4) Panel should show: ${NAME}"
echo ""
echo "Note: the application menu entry named Firefox will now also launch ${NAME}."
echo "      System /usr/bin/firefox still exists; only the .desktop label/icon/Exec were overridden."
echo "Undo:  rm -f $APP_LOCAL/firefox.desktop $APP_LOCAL/${ID}.desktop && update-desktop-database $APP_LOCAL"
echo ""
