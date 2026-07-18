#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""Patch official Firefox AppDir: brand.ftl, branding images, Firefox UI strings.

Mozilla omni.ja is a quirky ZIP that Python zipfile often cannot open
(Bad magic number for central directory). Use system unzip/zip instead.
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import tempfile
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


def patch_text_firefox(content: str, display_name: str) -> str:
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


def run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        check=True,
        text=True,
        capture_output=True,
        **kwargs,
    )


def ensure_tools() -> None:
    for tool in ("unzip", "zip"):
        if shutil.which(tool) is None:
            raise SystemExit(
                f"Missing required tool: {tool}. Install with: sudo apt-get install -y unzip zip"
            )


def fix_omni_zip(omni_path: Path) -> Path:
    """Return a path to a ZIP that unzip can read (may be a fixed copy)."""
    # Quick test
    test = subprocess.run(
        ["unzip", "-tqq", str(omni_path)],
        capture_output=True,
        text=True,
    )
    if test.returncode == 0:
        return omni_path

    print(f"[patch] {omni_path} failed unzip -t; trying zip -FF repair")
    fixed = omni_path.with_suffix(".ja.fixed")
    if fixed.exists():
        fixed.unlink()
    # zip -FF writes repaired archive; may prompt — feed newlines
    proc = subprocess.run(
        ["zip", "-FF", str(omni_path), "--out", str(fixed)],
        input="\n\n\n\n",
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0 or not fixed.is_file():
        raise RuntimeError(
            f"Cannot open or repair {omni_path}:\n"
            f"unzip: {test.stderr or test.stdout}\n"
            f"zip -FF: {proc.stderr or proc.stdout}"
        )
    test2 = subprocess.run(
        ["unzip", "-tqq", str(fixed)],
        capture_output=True,
        text=True,
    )
    if test2.returncode != 0:
        raise RuntimeError(f"Repaired archive still invalid: {fixed}")
    return fixed


def list_omni_members(omni_path: Path) -> list[str]:
    out = run(["unzip", "-Z1", str(omni_path)])
    return [line for line in out.stdout.splitlines() if line and not line.endswith("/")]


def should_patch_text_file(path: Path) -> bool:
    name = path.name.lower()
    rel = str(path).replace("\\", "/").lower()
    if not name.endswith(
        (".ftl", ".properties", ".dtd", ".xhtml", ".html", ".js")
    ):
        return False
    if name.endswith(".js") and "brand" not in rel and "about" not in rel:
        return False
    return (
        "/locale/" in rel
        or "/localization/" in rel
        or "branding" in rel
        or "about" in name
        or name.endswith((".ftl", ".properties"))
    )


def pick_icon(icons_dir: Path, *names: str) -> Path | None:
    for n in names:
        p = icons_dir / n
        if p.is_file():
            return p
    return None


def patch_extracted_tree(
    root: Path,
    display_name: str,
    vendor: str,
    icons_dir: Path,
) -> tuple[int, int, int]:
    brand_ftl = write_brand_ftl(display_name, vendor)
    brand_props = write_brand_properties(display_name, vendor)
    n_brand = n_text = n_icons = 0

    about = pick_icon(icons_dir, "about-logo.png", "default128.png")
    about2 = pick_icon(icons_dir, "about-logo@2x.png") or about
    icon128 = pick_icon(icons_dir, "default128.png") or about
    icon64 = pick_icon(icons_dir, "default64.png") or icon128
    icon32 = pick_icon(icons_dir, "default32.png", "default16.png") or icon64

    for path in root.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(root).as_posix()
        low = rel.lower()
        name = path.name

        if name == "brand.ftl":
            path.write_text(brand_ftl, encoding="utf-8")
            n_brand += 1
            continue
        if name == "brand.properties":
            path.write_text(brand_props, encoding="utf-8")
            n_brand += 1
            continue

        if low.endswith(".png") and (
            "branding" in low or "/icons/default/" in low
        ):
            src: Path | None = None
            if "about-logo@2x" in low:
                src = about2
            elif "about-logo" in low:
                src = about
            elif "128" in low or "default128" in low:
                src = icon128
            elif "64" in low or "default64" in low:
                src = icon64
            elif "32" in low or "16" in low or "default32" in low or "default16" in low:
                src = icon32
            else:
                src = about or icon128
            if src and src.is_file():
                shutil.copy2(src, path)
                n_icons += 1
            continue

        if should_patch_text_file(path):
            try:
                text = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            if "Firefox" not in text and "firefox" not in text:
                continue
            new_text = patch_text_firefox(text, display_name)
            if new_text != text:
                path.write_text(new_text, encoding="utf-8")
                n_text += 1

    return n_brand, n_text, n_icons


def repack_omni(
    omni_path: Path,
    display_name: str,
    vendor: str,
    icons_dir: Path,
) -> None:
    ensure_tools()
    readable = fix_omni_zip(omni_path)

    with tempfile.TemporaryDirectory(prefix="omni-patch-") as tmp:
        extract_dir = Path(tmp) / "out"
        extract_dir.mkdir()
        # -q quiet, -o overwrite
        run(["unzip", "-q", "-o", str(readable), "-d", str(extract_dir)])

        n_brand, n_text, n_icons = patch_extracted_tree(
            extract_dir, display_name, vendor, icons_dir
        )

        out_ja = Path(tmp) / "omni.new.ja"
        # Mozilla requires store-only (no compression)
        # zip from inside extract_dir so paths have no prefix
        subprocess.run(
            ["zip", "-0", "-X", "-r", str(out_ja), "."],
            cwd=extract_dir,
            check=True,
            capture_output=True,
            text=True,
        )
        shutil.move(str(out_ja), str(omni_path))

    if readable != omni_path and readable.exists():
        readable.unlink(missing_ok=True)

    print(
        f"[patch] {omni_path.name}: brand_files={n_brand} "
        f"text={n_text} icons={n_icons}"
    )


def patch_appdir(
    appdir: Path,
    display_name: str,
    vendor: str,
    brand_id: str,
    icons_dir: Path,
) -> None:
    ensure_tools()

    # Loose chrome icons (window / taskbar)
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

    app_ini = appdir / "application.ini"
    if app_ini.is_file():
        text = app_ini.read_text(encoding="utf-8", errors="replace")
        text = re.sub(r"(?m)^Name=.*$", f"Name={display_name}", text)
        text = re.sub(r"(?m)^RemotingName=.*$", f"RemotingName={brand_id}", text)
        text = re.sub(r"(?m)^Vendor=.*$", f"Vendor={vendor}", text)
        if not re.search(r"(?m)^RemotingName=", text):
            text = text.replace("[App]", f"[App]\nRemotingName={brand_id}", 1)
        app_ini.write_text(text, encoding="utf-8")

    for omni in (appdir / "browser" / "omni.ja", appdir / "omni.ja"):
        if omni.is_file():
            print(f"[patch] Processing {omni}")
            repack_omni(omni, display_name, vendor, icons_dir)

    # Prefer autoconfig prefs over policies.json.
    # policies.json triggers the "managed by your organization" banner — not a
    # remote org, just Firefox enterprise-policy UI. Floorp often shows the same.
    pref_dir = appdir / "defaults" / "pref"
    pref_dir.mkdir(parents=True, exist_ok=True)
    # Load unlocked autoconfig (obscure_value 0 = plain text cfg next to binary)
    (pref_dir / "autoconfig.js").write_text(
        f"""// Autoconfig bootstrap for {display_name}
pref("general.config.filename", "{brand_id}.cfg");
pref("general.config.obscure_value", 0);
pref("general.config.sandbox_enabled", false);
""",
        encoding="utf-8",
    )
    # CFG must start with a comment line (Mozilla requirement)
    (appdir / f"{brand_id}.cfg").write_text(
        f"""// {display_name} local prefs (not enterprise policy)
lockPref("app.update.enabled", false);
lockPref("app.update.auto", false);
lockPref("app.update.background.enabled", false);
lockPref("browser.shell.checkDefaultBrowser", false);
defaultPref("browser.startup.homepage_override.mstone", "ignore");
""",
        encoding="utf-8",
    )

    # Remove policies.json if a previous build left one (avoids org banner)
    policies = appdir / "distribution" / "policies.json"
    if policies.is_file():
        policies.unlink()

    firefox_bin = appdir / "firefox"
    target = appdir / brand_id
    if firefox_bin.exists():
        if target.exists():
            target.unlink()
        firefox_bin.rename(target)
    firefox_bin_real = appdir / "firefox-bin"
    target_bin = appdir / f"{brand_id}-bin"
    if firefox_bin_real.exists():
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
