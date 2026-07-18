#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""Patch official Firefox AppDir: brand.ftl, branding images, hardcoded Firefox UI strings."""

from __future__ import annotations

import argparse
import io
import os
import re
import shutil
import tempfile
import zipfile
from pathlib import Path


def write_brand_ftl(display_name: str, vendor: str) -> str:
    return f"""# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

-brand-shorter-name = {display_name}
-brand-short-name = {display_name}
-brand-shortcut-name = {display_name}
-brand-full-name = {display_name}
-brand-product-name = {display_name}
-vendor-short-name = {vendor}
-trademark-info =
    {{display_name}} and related logos are trademarks of {vendor}.
"""


def write_brand_properties(display_name: str, vendor: str) -> str:
    return f"""brandShorterName={display_name}
brandShortName={display_name}
brandFullName={display_name}
vendorShortName={vendor}
"""


# Paths inside browser/omni.ja that commonly hold chrome branding art
BRANDING_PNG_CANDIDATES = [
    "chrome/browser/content/branding/about-logo.png",
    "chrome/browser/content/branding/about-logo@2x.png",
    "chrome/browser/content/branding/icon128.png",
    "chrome/browser/content/branding/icon64.png",
    "chrome/browser/content/branding/icon32.png",
    "chrome/branding/content/about-logo.png",
    "chrome/branding/content/about-logo@2x.png",
    "chrome/branding/content/icon128.png",
    "chrome/branding/content/icon64.png",
    "chrome/branding/content/icon32.png",
]


def patch_text_firefox(content: str, display_name: str) -> str:
    """Replace visible Firefox product strings; keep technical URLs/ids when possible."""
    # Order matters: longer phrases first
    replacements = [
        ("Mozilla Firefox Official Build", f"{display_name} Build"),
        ("欢迎使用 Firefox", f"欢迎使用 {display_name}"),
        ("关于 Firefox", f"关于 {display_name}"),
        ("Firefox 帮助", f"{display_name} 帮助"),
        ("Firefox 实验室", f"{display_name} 实验室"),
        ("将 Firefox 设为默认浏览器", f"将 {display_name} 设为默认浏览器"),
        ("Firefox 护您周全", f"{display_name} 护您周全"),
        ("Mozilla Firefox", display_name),
        ("Firefox", display_name),
    ]
    out = content
    for old, new in replacements:
        out = out.replace(old, new)
    return out


def should_patch_text_member(name: str) -> bool:
    lower = name.lower()
    if not (
        lower.endswith(".ftl")
        or lower.endswith(".properties")
        or lower.endswith(".dtd")
        or lower.endswith(".xhtml")
        or lower.endswith(".html")
        or lower.endswith(".js")
    ):
        return False
    # Avoid breaking protocol handlers / extension ids aggressively in large JS
    if lower.endswith(".js") and "brand" not in lower and "about" not in lower:
        return False
    return True


def repack_omni(
    omni_path: Path,
    display_name: str,
    vendor: str,
    icon_map: dict[str, Path],
) -> None:
    """Mozilla requires omni.ja entries stored (no compression)."""
    brand_ftl = write_brand_ftl(display_name, vendor)
    brand_props = write_brand_properties(display_name, vendor)

    tmp_fd, tmp_name = tempfile.mkstemp(suffix=".ja")
    os.close(tmp_fd)
    tmp_path = Path(tmp_name)

    patched_brand_ftl = 0
    patched_text = 0
    patched_icons = 0

    try:
        with zipfile.ZipFile(omni_path, "r") as zin, zipfile.ZipFile(
            tmp_path, "w", compression=zipfile.ZIP_STORED
        ) as zout:
            names = zin.namelist()
            for info in zin.infolist():
                name = info.filename
                data = zin.read(name)

                # brand.ftl / brand.properties
                base = Path(name).name
                if base == "brand.ftl":
                    data = brand_ftl.encode("utf-8")
                    patched_brand_ftl += 1
                elif base == "brand.properties":
                    data = brand_props.encode("utf-8")
                    patched_brand_ftl += 1
                elif name in icon_map and icon_map[name].is_file():
                    data = icon_map[name].read_bytes()
                    patched_icons += 1
                elif should_patch_text_member(name):
                    try:
                        text = data.decode("utf-8")
                    except UnicodeDecodeError:
                        text = None
                    if text is not None and ("Firefox" in text or "firefox" in text):
                        # Only touch locale/UI-ish files that mention Firefox as product
                        if (
                            "/locale/" in name
                            or "/localization/" in name
                            or "branding" in name
                            or "about" in name.lower()
                            or name.endswith(".ftl")
                            or name.endswith(".properties")
                        ):
                            new_text = patch_text_firefox(text, display_name)
                            if new_text != text:
                                data = new_text.encode("utf-8")
                                patched_text += 1

                # Preserve ZipInfo filename; force stored
                new_info = zipfile.ZipInfo(filename=name)
                new_info.compress_type = zipfile.ZIP_STORED
                new_info.external_attr = info.external_attr
                zout.writestr(new_info, data)

            # If branding png paths exist as empty missing, inject when we have icons
            existing = set(names)
            for dest, src in icon_map.items():
                if dest not in existing and src.is_file():
                    info = zipfile.ZipInfo(filename=dest)
                    info.compress_type = zipfile.ZIP_STORED
                    zout.writestr(info, src.read_bytes())
                    patched_icons += 1

        shutil.move(str(tmp_path), str(omni_path))
        print(
            f"[patch] {omni_path.name}: brand_files={patched_brand_ftl} "
            f"text={patched_text} icons={patched_icons}"
        )
    finally:
        if tmp_path.exists():
            tmp_path.unlink(missing_ok=True)


def build_icon_map(icons_dir: Path, member_names: set[str]) -> dict[str, Path]:
    mapping: dict[str, Path] = {}
    local = {
        "about-logo.png": icons_dir / "about-logo.png",
        "about-logo@2x.png": icons_dir / "about-logo@2x.png",
        "default128.png": icons_dir / "default128.png",
        "default64.png": icons_dir / "default64.png",
        "default32.png": icons_dir / "default32.png",
    }
    # Prefer about-logo, else default128
    about = local["about-logo.png"] if local["about-logo.png"].is_file() else local["default128.png"]
    about2 = (
        local["about-logo@2x.png"]
        if local["about-logo@2x.png"].is_file()
        else about
    )
    icon128 = local["default128.png"] if local["default128.png"].is_file() else about
    icon64 = local["default64.png"] if local["default64.png"].is_file() else icon128
    icon32 = local["default32.png"] if local["default32.png"].is_file() else icon64

    for path in BRANDING_PNG_CANDIDATES:
        if path not in member_names and "about-logo@2x" not in path and "about-logo" not in path:
            # still map if we want inject — handled in repack
            pass
        if "about-logo@2x" in path:
            mapping[path] = about2
        elif "about-logo" in path:
            mapping[path] = about
        elif "icon128" in path:
            mapping[path] = icon128
        elif "icon64" in path:
            mapping[path] = icon64
        elif "icon32" in path:
            mapping[path] = icon32
    return {k: v for k, v in mapping.items() if v.is_file()}


def patch_appdir(appdir: Path, display_name: str, vendor: str, brand_id: str, icons_dir: Path) -> None:
    # Loose chrome icons
    if icons_dir.is_dir():
        dest_dir = appdir / "browser" / "chrome" / "icons" / "default"
        dest_dir.mkdir(parents=True, exist_ok=True)
        for size in (16, 32, 48, 64, 128):
            src = icons_dir / f"default{size}.png"
            if src.is_file():
                shutil.copy2(src, dest_dir / f"default{size}.png")
        for name in ("about-logo.png", "about-logo@2x.png"):
            src = icons_dir / name
            if src.is_file():
                shutil.copy2(src, dest_dir / name)

    # application.ini
    app_ini = appdir / "application.ini"
    if app_ini.is_file():
        text = app_ini.read_text(encoding="utf-8", errors="replace")
        text = re.sub(r"(?m)^Name=.*$", f"Name={display_name}", text)
        text = re.sub(r"(?m)^RemotingName=.*$", f"RemotingName={brand_id}", text)
        text = re.sub(r"(?m)^Vendor=.*$", f"Vendor={vendor}", text)
        if not re.search(r"(?m)^RemotingName=", text):
            text = text.replace("[App]", f"[App]\nRemotingName={brand_id}", 1)
        app_ini.write_text(text, encoding="utf-8")

    # Patch browser/omni.ja (and root omni.ja if present)
    for omni in (appdir / "browser" / "omni.ja", appdir / "omni.ja"):
        if not omni.is_file():
            continue
        with zipfile.ZipFile(omni, "r") as zf:
            members = set(zf.namelist())
        icon_map = build_icon_map(icons_dir, members)
        # Also map any existing branding png members to our icons
        for m in list(members):
            low = m.lower()
            if not low.endswith(".png"):
                continue
            if "branding" not in low and "/icons/default/" not in low:
                continue
            if "128" in low or "about-logo@2x" in low:
                src = icons_dir / "default128.png"
            elif "64" in low:
                src = icons_dir / "default64.png"
                if not src.is_file():
                    src = icons_dir / "default128.png"
            elif "32" in low or "16" in low:
                src = icons_dir / "default32.png"
                if not src.is_file():
                    src = icons_dir / "default128.png"
            else:
                src = icons_dir / "about-logo.png"
                if not src.is_file():
                    src = icons_dir / "default128.png"
            if src.is_file():
                icon_map[m] = src
        repack_omni(omni, display_name, vendor, icon_map)

    # distribution policies: skip first-run welcome that says Firefox
    dist = appdir / "distribution"
    dist.mkdir(parents=True, exist_ok=True)
    (dist / "policies.json").write_text(
        """{
  "policies": {
    "DisableAppUpdate": true,
    "AppAutoUpdate": false,
    "BackgroundAppUpdate": false,
    "OverrideFirstRunPage": "",
    "OverridePostUpdatePage": "",
    "DontCheckDefaultBrowser": true
  }
}
""",
        encoding="utf-8",
    )

    # Rename binaries: no firefox symlink (task manager was showing firefox)
    firefox_bin = appdir / "firefox"
    target = appdir / brand_id
    if firefox_bin.is_file() or firefox_bin.is_symlink():
        if target.exists():
            target.unlink()
        firefox_bin.rename(target)
    firefox_bin_real = appdir / "firefox-bin"
    target_bin = appdir / f"{brand_id}-bin"
    if firefox_bin_real.is_file() or firefox_bin_real.is_symlink():
        if target_bin.exists():
            target_bin.unlink()
        firefox_bin_real.rename(target_bin)

    print(f"[patch] AppDir branded as {display_name!r} id={brand_id}")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("appdir", type=Path)
    p.add_argument("--id", required=True)
    p.add_argument("--display-name", required=True)
    p.add_argument("--vendor", required=True)
    p.add_argument("--icons", type=Path, required=True)
    args = p.parse_args()
    patch_appdir(args.appdir, args.display_name, args.vendor, args.id, args.icons)


if __name__ == "__main__":
    main()
