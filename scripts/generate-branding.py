#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""Generate browser/branding/<id>/ for a Gecko/Floorp-Runtime tree from brand.config.json.

This is what Floorp does at compile time: MOZ_APP_NAME becomes the Wayland app_id
and process/desktop identity — unlike patching an official Firefox tarball.
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path


def load_config(path: Path) -> dict:
    cfg = json.loads(path.read_text(encoding="utf-8"))
    for key in ("id", "displayName", "vendor"):
        if not cfg.get(key):
            raise SystemExit(f"brand.config.json missing {key}")
    bid = cfg["id"]
    if not bid.replace("_", "").replace("-", "").isalnum() or not bid[0].islower():
        raise SystemExit(f"id must be lowercase ascii identifier: {bid}")
    cfg.setdefault("profileDir", cfg["displayName"])
    return cfg


def minimal_png(size: int = 1) -> bytes:
    """1x1 PNG fallback when user has not provided icons yet."""
    # Precomputed 1x1 RGBA PNG
    return bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
        "0000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082"
    )


def copy_icon(icons: Path, name: str, dest: Path) -> None:
    src = icons / name
    dest.parent.mkdir(parents=True, exist_ok=True)
    if src.is_file():
        shutil.copy2(src, dest)
    else:
        # try default128 as fallback for other sizes / about-logo
        fb = icons / "default128.png"
        if fb.is_file():
            shutil.copy2(fb, dest)
        else:
            dest.write_bytes(minimal_png())


def write_brand_ftl(display: str, vendor: str) -> str:
    return f"""# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

-brand-shorter-name = {display}
-brand-short-name = {display}
-brand-shortcut-name = {display}
-brand-full-name = {display}
-brand-product-name = {display}
-vendor-short-name = {vendor}
-trademark-info =
    {display} and related marks are trademarks of {vendor}.
"""


def write_brand_properties(display: str, vendor: str) -> str:
    return f"""brandShorterName={display}
brandShortName={display}
brandFullName={display}
vendorShortName={vendor}
"""


def generate(cfg: dict, icons_dir: Path, out_dir: Path) -> Path:
    bid = cfg["id"]
    display = cfg["displayName"]
    vendor = cfg["vendor"]
    profile = cfg.get("profileDir") or display

    brand_root = out_dir / bid
    if brand_root.exists():
        shutil.rmtree(brand_root)
    brand_root.mkdir(parents=True)

    # configure.sh — read by Gecko branding machinery
    (brand_root / "configure.sh").write_text(
        f"""# Generated from brand.config.json — compile-time identity (like Floorp)
MOZ_APP_DISPLAYNAME="{display}"
MOZ_APP_VENDOR={vendor}
MOZ_APP_PROFILE={profile}
""",
        encoding="utf-8",
    )

    (brand_root / "moz.build").write_text(
        """# -*- Mode: python; indent-tabs-mode: nil; tab-width: 40 -*-
# vim: set filetype=python:
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

DIRS += ["content", "locales"]

DIST_SUBDIR = "browser"
export("DIST_SUBDIR")

include("../branding-common.mozbuild")
FirefoxBranding()
""",
        encoding="utf-8",
    )

    content = brand_root / "content"
    content.mkdir()
    (content / "moz.build").write_text(
        """# -*- Mode: python; indent-tabs-mode: nil; tab-width: 40 -*-
# vim: set filetype=python:

JAR_MANIFESTS += ["jar.mn"]
""",
        encoding="utf-8",
    )
    (content / "jar.mn").write_text(
        """#filter substitution
browser.jar:
% content branding %content/branding/ contentaccessible=yes
  content/branding/about-logo.png                 (about-logo.png)
  content/branding/about-logo@2x.png              (about-logo@2x.png)
  content/branding/about-wordmark.svg            (about-wordmark.svg)
  content/branding/document.ico                  (document.ico)
  content/branding/document.png                  (document.png)
""",
        encoding="utf-8",
    )

    # Wordmark placeholder SVG
    (content / "about-wordmark.svg").write_text(
        f"""<svg xmlns="http://www.w3.org/2000/svg" width="240" height="48" viewBox="0 0 240 48">
  <text x="0" y="36" font-family="sans-serif" font-size="32" fill="#111">{display}</text>
</svg>
""",
        encoding="utf-8",
    )

    locales = brand_root / "locales"
    locales.mkdir()
    (locales / "moz.build").write_text(
        """# -*- Mode: python; indent-tabs-mode: nil; tab-width: 40 -*-
# vim: set filetype=python:

JAR_MANIFESTS += ["jar.mn"]
""",
        encoding="utf-8",
    )
    (locales / "jar.mn").write_text(
        """#filter substitution
[localization] @AB_CD@.jar:
  branding                                          (%branding/**/*.ftl)

@AB_CD@.jar:
% locale branding @AB_CD@ %locale/branding/
  locale/branding/brand.properties                 (%brand.properties)
""",
        encoding="utf-8",
    )

    for loc in ("en-US", "zh-CN", "ja-JP"):
        loc_dir = locales / loc
        loc_dir.mkdir()
        branding_loc = loc_dir / "branding"
        branding_loc.mkdir()
        (branding_loc / "brand.ftl").write_text(
            write_brand_ftl(display, vendor), encoding="utf-8"
        )
        (loc_dir / "brand.properties").write_text(
            write_brand_properties(display, vendor), encoding="utf-8"
        )
        # also flat brand.ftl some trees expect
        (loc_dir / "brand.ftl").write_text(
            write_brand_ftl(display, vendor), encoding="utf-8"
        )

    # Icons at branding root (FirefoxBranding picks these up)
    for size in (16, 22, 24, 32, 48, 64, 128, 256):
        copy_icon(icons_dir, f"default{size}.png", brand_root / f"default{size}.png")
    copy_icon(icons_dir, "about-logo.png", brand_root / "about-logo.png")
    copy_icon(icons_dir, "about-logo@2x.png", brand_root / "about-logo@2x.png")
    copy_icon(icons_dir, "about-logo.png", content / "about-logo.png")
    copy_icon(icons_dir, "about-logo@2x.png", content / "about-logo@2x.png")
    copy_icon(icons_dir, "default128.png", content / "document.png")
    copy_icon(icons_dir, "default32.png", content / "document.ico")
    # Windows ico placeholder = copy png (Runtime linux build ignores)
    shutil.copy2(brand_root / "default128.png", brand_root / "firefox.ico")
    shutil.copy2(brand_root / "default64.png", brand_root / "Document.ico")

    # Export for mozconfig helpers
    meta = brand_root / "BRAND_META.json"
    meta.write_text(
        json.dumps(
            {
                "id": bid,
                "displayName": display,
                "vendor": vendor,
                "profileDir": profile,
                "brandingDir": f"browser/branding/{bid}",
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    print(f"[branding] Generated {brand_root}")
    return brand_root


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument(
        "--config",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "brand.config.json",
    )
    p.add_argument(
        "--icons",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "icons",
    )
    p.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "generated" / "branding",
    )
    args = p.parse_args()
    cfg = load_config(args.config)
    args.out.mkdir(parents=True, exist_ok=True)
    generate(cfg, args.icons, args.out)


if __name__ == "__main__":
    main()
