#!/usr/bin/env python3
"""Create separate sanitized GitHub/developer and Chrome Web Store ZIPs.

GitHub ZIP keeps the offline legacy updater. The Web Store ZIP has manifest.json
at its root and contains only code/assets required by the extension. No private
config, signed CRX key, Sheet rows, tokens or browser profiles are ever packaged.
"""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
EXT = ROOT / "extension"
EXTENSION_FILES = (
    "manifest.json", "config.js", "newtab.css", "newtab.html", "newtab.js",
    "pulse-core.js", "background.js",
    "icons/icon16.png", "icons/icon48.png", "icons/icon128.png",
)
DEVELOPER_EXTRAS = (
    "tools/upgrade-local.ps1", "README.md", "LICENSE", "PRIVACY.md",
    "SECURITY.md", "CHANGELOG.md", "docs/WEB_STORE_RELEASE.md",
)


def verify() -> str:
    manifest = json.loads((EXT / "manifest.json").read_text("utf-8"))
    config = (EXT / "config.js").read_text("utf-8")
    if manifest.get("name") != "Project Dashboard" or manifest.get("key"):
        raise ValueError("Public manifest must be Project Dashboard with no personal key")
    if not all(x in config for x in ("oauthClientId: ''", "spreadsheetId: ''")):
        raise ValueError("Public config.js must have blank personal settings")
    if not manifest.get("background", {}).get("service_worker") == "background.js":
        raise ValueError("Store extension must include its update event worker")
    for rel in EXTENSION_FILES:
        if not (EXT / rel).is_file():
            raise FileNotFoundError(str(EXT / rel))
    for size in (16, 48, 128):
        name = f"icons/icon{size}.png"
        if manifest.get("icons", {}).get(str(size)) != name:
            raise ValueError(f"Missing manifest icon mapping: {size}")
        if not (EXT / name).read_bytes().startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError(f"Invalid PNG icon: {name}")
    for rel in DEVELOPER_EXTRAS:
        if not (ROOT / rel).is_file():
            raise FileNotFoundError(rel)
    version = str(manifest["version"])
    if len(version.split(".")) != 3 or not all(p.isdigit() for p in version.split(".")):
        raise ValueError("Manifest version must be a numeric triple")
    return version


def add(zf: zipfile.ZipFile, name: str, content: bytes):
    entry = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
    entry.compress_type = zipfile.ZIP_DEFLATED
    entry.external_attr = 0o644 << 16
    zf.writestr(entry, content)


def build(out: Path):
    version = verify()
    out.mkdir(parents=True, exist_ok=True)
    developer = out / f"project-dashboard-v{version}.zip"
    store = out / f"project-dashboard-webstore-v{version}.zip"
    with zipfile.ZipFile(developer, "w") as zf:
        for rel in sorted(EXTENSION_FILES):
            add(zf, f"extension/{rel}", (EXT / rel).read_bytes())
        for rel in sorted(DEVELOPER_EXTRAS):
            add(zf, rel, (ROOT / rel).read_bytes())
    with zipfile.ZipFile(store, "w") as zf:
        for rel in sorted(EXTENSION_FILES):
            add(zf, rel, (EXT / rel).read_bytes())
    for archive in (developer, store):
        with zipfile.ZipFile(archive) as zf:
            names = zf.namelist()
            if any(".." in Path(name).parts or Path(name).is_absolute() for name in names):
                raise ValueError("Unsafe ZIP entry path")
            if archive == store and ("manifest.json" not in names or any(name.startswith("tools/") for name in names)):
                raise ValueError("Chrome Web Store ZIP must have a root manifest, no updater")
    sums = out / "SHA256SUMS.txt"
    sums.write_text("".join(
        f"{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}\n" for p in (developer, store)
    ), "utf-8")
    return developer, store, sums


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=ROOT / "dist")
    args = parser.parse_args()
    for path in build(args.out):
        print(path)
