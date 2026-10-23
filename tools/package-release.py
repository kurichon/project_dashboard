#!/usr/bin/env python3
"""Build a sanitized release ZIP. Never package local personal configuration."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ALLOWED = [
    "extension/manifest.json", "extension/config.js", "extension/newtab.css",
    "extension/newtab.html", "extension/newtab.js", "extension/pulse-core.js",
    "tools/upgrade-local.ps1", "README.md", "LICENSE", "PRIVACY.md",
    "SECURITY.md", "CHANGELOG.md",
]

def build(out: Path) -> tuple[Path, Path]:
    out.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((ROOT / "extension/manifest.json").read_text("utf-8"))
    config = (ROOT / "extension/config.js").read_text("utf-8")
    if manifest.get("name") != "Project Dashboard" or manifest.get("key"):
        raise ValueError("Release manifest must be Project Dashboard with no personal key")
    if not all(x in config for x in ("oauthClientId: ''", "spreadsheetId: ''")):
        raise ValueError("Release config.js must have blank personal settings")
    for rel in ALLOWED:
        if not (ROOT / rel).is_file():
            raise FileNotFoundError(rel)
    version = manifest["version"]
    path = out / f"project-dashboard-v{version}.zip"
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for rel in sorted(ALLOWED):
            info = zipfile.ZipInfo(rel, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            zf.writestr(info, (ROOT / rel).read_bytes())
    sums = out / "SHA256SUMS.txt"
    sums.write_text(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n", "utf-8")
    return path, sums

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=ROOT/"dist")
    args = parser.parse_args()
    for item in build(args.out):
        print(item)