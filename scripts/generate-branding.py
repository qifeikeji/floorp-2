#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""Generate browser/branding/<id>/ for a Gecko/Floorp-Runtime tree from brand.config.json.

This is what Floorp does at compile time: MOZ_APP_NAME becomes the Wayland app_id
and process/desktop identity — unlike patching an official Firefox tarball.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import shutil
from pathlib import Path


def load_config(path: Path) -> dict:
    """Load via brand_config.py (compileId + variants) with legacy fallback."""
    helper = Path(__file__).resolve().parent / "brand_config.py"
    spec = importlib.util.spec_from_file_location("brand_config", helper)
    if spec is None or spec.loader is None:
        raise SystemExit(f"Cannot load {helper}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.load(path)


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
trademarkInfo = {{ " " }}
"""


def write_brand_properties(display: str, vendor: str) -> str:
    return f"""brandShorterName={display}
brandShortName={display}
brandFullName={display}
vendorShortName={vendor}
"""


def write_wordmark_svg(display: str) -> str:
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="240" height="48" viewBox="0 0 240 48">
  <text x="0" y="36" font-family="sans-serif" font-size="32" fill="#111">{display}</text>
</svg>
"""


def write_logo_svg(display: str) -> str:
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="24" fill="#1a73e8"/>
  <text x="64" y="76" text-anchor="middle" font-family="sans-serif" font-size="36" fill="#fff">{display[:1]}</text>
</svg>
"""


def write_pdf_svg() -> str:
    return """<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="4" fill="#d93025"/>
  <text x="16" y="21" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#fff">PDF</text>
</svg>
"""


def write_firefox_branding_js() -> str:
    # Required by FirefoxBranding() via JS_PREFERENCE_FILES.
    return """/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Branding-specific prefs (updater disabled in mozconfig).
pref("startup.homepage_override_url", "");
pref("startup.homepage_welcome_url", "");
pref("startup.homepage_welcome_url.additional", "");
pref("app.update.interval", 86400);
pref("app.update.promptWaitTime", 86400);
pref("app.update.url.manual", "");
pref("app.update.url.details", "");
pref("app.update.checkInstallTime.days", 2);
pref("app.update.badgeWaitTime", 0);
pref("devtools.selfxss.count", 5);
"""


def write_about_dialog_css() -> str:
    return """/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#rightBox {
  background-size: auto 44px;
  margin-inline: 30px;
  padding-top: 64px;
}

#bottomBox {
  padding: 15px 10px;
}
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

    # configure.sh — only options allowed from branding confvars (modern Gecko).
    # MOZ_APP_VENDOR / MOZ_APP_PROFILE are "implied" and must NOT be set here.
    (brand_root / "configure.sh").write_text(
        f"""# Generated from brand.config.json — compile-time identity (like Floorp)
MOZ_APP_DISPLAYNAME="{display}"
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

    # Required by FirefoxBranding()
    pref = brand_root / "pref"
    pref.mkdir()
    (pref / "firefox-branding.js").write_text(
        write_firefox_branding_js(), encoding="utf-8"
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
    # Match mozilla-firefox unofficial branding content/jar.mn shape
    (content / "jar.mn").write_text(
        """browser.jar:
% content branding %content/branding/ contentaccessible=yes
  content/branding/about.png                        (about.png)
  content/branding/about-logo.png                   (about-logo.png)
  content/branding/about-logo.svg                   (about-logo.svg)
  content/branding/about-logo@2x.png                (about-logo@2x.png)
  content/branding/about-wordmark.svg               (about-wordmark.svg)
  content/branding/about-logo-private.png           (about-logo-private.png)
  content/branding/about-logo-private@2x.png        (about-logo-private@2x.png)
  content/branding/document.ico                     (../document.ico)
  content/branding/document_pdf.svg                 (document_pdf.svg)
  content/branding/firefox-wordmark.svg             (firefox-wordmark.svg)
  content/branding/icon16.png                       (../default16.png)
  content/branding/icon32.png                       (../default32.png)
  content/branding/icon48.png                       (../default48.png)
  content/branding/icon64.png                       (../default64.png)
  content/branding/icon128.png                      (../default128.png)
  content/branding/aboutDialog.css                  (aboutDialog.css)
""",
        encoding="utf-8",
    )

    (content / "about-wordmark.svg").write_text(
        write_wordmark_svg(display), encoding="utf-8"
    )
    (content / "firefox-wordmark.svg").write_text(
        write_wordmark_svg(display), encoding="utf-8"
    )
    (content / "about-logo.svg").write_text(write_logo_svg(display), encoding="utf-8")
    (content / "document_pdf.svg").write_text(write_pdf_svg(), encoding="utf-8")
    (content / "aboutDialog.css").write_text(write_about_dialog_css(), encoding="utf-8")

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
  branding (en-US/**/*.ftl)

@AB_CD@.jar:
% locale branding @AB_CD@ %locale/branding/
  locale/branding/brand.properties (en-US/brand.properties)
""",
        encoding="utf-8",
    )

    en_us = locales / "en-US"
    en_us.mkdir()
    (en_us / "brand.ftl").write_text(write_brand_ftl(display, vendor), encoding="utf-8")
    (en_us / "brand.properties").write_text(
        write_brand_properties(display, vendor), encoding="utf-8"
    )

    # Icons at branding root (FirefoxBranding / gtk FINAL_TARGET_FILES)
    for size in (16, 22, 24, 32, 48, 64, 128, 256):
        copy_icon(icons_dir, f"default{size}.png", brand_root / f"default{size}.png")
    copy_icon(icons_dir, "about-logo.png", brand_root / "about-logo.png")
    copy_icon(icons_dir, "about-logo@2x.png", brand_root / "about-logo@2x.png")
    copy_icon(icons_dir, "about-logo.png", content / "about.png")
    copy_icon(icons_dir, "about-logo.png", content / "about-logo.png")
    copy_icon(icons_dir, "about-logo@2x.png", content / "about-logo@2x.png")
    copy_icon(icons_dir, "about-logo.png", content / "about-logo-private.png")
    copy_icon(icons_dir, "about-logo@2x.png", content / "about-logo-private@2x.png")
    # document.ico at branding root (jar.mn references ../document.ico)
    shutil.copy2(brand_root / "default32.png", brand_root / "document.ico")
    shutil.copy2(brand_root / "default128.png", brand_root / "firefox.ico")
    shutil.copy2(brand_root / "default64.png", brand_root / "Document.ico")

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
