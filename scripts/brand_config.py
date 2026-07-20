#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""Read brand.config.json — supports single brand or compile-once + N variants."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def load(path: Path) -> dict:
    cfg = json.loads(path.read_text(encoding="utf-8"))

    # Backward compat: old single-brand shape
    if "compileId" not in cfg and "id" in cfg:
        cfg["compileId"] = cfg["id"]
        cfg["compileDisplayName"] = cfg.get("displayName") or cfg["id"]
        if "variants" not in cfg:
            cfg["variants"] = [
                {
                    "id": cfg["id"],
                    "displayName": cfg.get("displayName") or cfg["id"],
                    "profileDir": cfg.get("profileDir") or cfg.get("displayName") or cfg["id"],
                }
            ]

    if not cfg.get("compileId"):
        raise SystemExit("brand.config.json needs compileId (or legacy id)")
    if not cfg.get("vendor"):
        raise SystemExit("brand.config.json needs vendor")

    cfg.setdefault(
        "compileDisplayName",
        cfg.get("displayName") or cfg["compileId"],
    )
    cfg.setdefault("profileDir", cfg["compileDisplayName"])

    variants = cfg.get("variants")
    if not variants:
        raise SystemExit("brand.config.json needs variants[] (at least one)")

    for v in variants:
        if not v.get("id") or not v.get("displayName"):
            raise SystemExit(f"variant missing id/displayName: {v!r}")
        vid = v["id"]
        if not vid.replace("_", "").replace("-", "").isalnum() or not vid[0].islower():
            raise SystemExit(f"variant id must be lowercase ascii: {vid}")
        v.setdefault("profileDir", v["displayName"])

    # Aliases used by generate-branding / prepare-runtime
    cfg["id"] = cfg["compileId"]
    cfg["displayName"] = cfg["compileDisplayName"]
    return cfg


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument(
        "--config",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "brand.config.json",
    )
    p.add_argument(
        "query",
        choices=(
            "compile-id",
            "compile-display",
            "vendor",
            "profile-dir",
            "runtime-repository",
            "runtime-ref",
            "variant-ids",
            "variants-json",
            "json",
        ),
    )
    args = p.parse_args()
    cfg = load(args.config)

    if args.query == "compile-id":
        print(cfg["compileId"])
    elif args.query == "compile-display":
        print(cfg["compileDisplayName"])
    elif args.query == "vendor":
        print(cfg["vendor"])
    elif args.query == "profile-dir":
        print(cfg["profileDir"])
    elif args.query == "runtime-repository":
        print(cfg.get("runtimeRepository") or "Floorp-Projects/Floorp-Runtime")
    elif args.query == "runtime-ref":
        print(cfg.get("runtimeRef") or "")
    elif args.query == "variant-ids":
        print("\n".join(v["id"] for v in cfg["variants"]))
    elif args.query == "variants-json":
        json.dump(cfg["variants"], sys.stdout, ensure_ascii=False)
        print()
    elif args.query == "json":
        json.dump(cfg, sys.stdout, ensure_ascii=False, indent=2)
        print()


if __name__ == "__main__":
    main()
