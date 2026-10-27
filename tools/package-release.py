#!/usr/bin/env python3
"""Build exactly one deterministic, privacy-sanitized GitHub Release ZIP."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import zipfile

ROOT = Path(__file__).resolve().parents[1]
EXT = ROOT / 'extension'
EXTENSION_FILES = (
    'manifest.json','config.js','newtab.css','newtab.html','newtab.js','pulse-core.js',
    'pdrc-core.js','pdrc-view.js',
    'icons/icon16.png','icons/icon48.png','icons/icon128.png',
)
EXTRAS = (
    'Update Project Dashboard.cmd', 'tools/upgrade-local.ps1','tools/update-from-github.ps1',
    'README.md','LICENSE','PRIVACY.md','SECURITY.md','CHANGELOG.md','docs/GITHUB_RELEASES.md',
    'docs/PDRC_V1.md',
)


def verify():
    manifest=json.loads((EXT/'manifest.json').read_text('utf-8'))
    config=(EXT/'config.js').read_text('utf-8')
    if manifest.get('name') != 'Project Dashboard' or manifest.get('key'):
        raise ValueError('Distribution manifest must be Project Dashboard with no private key')
    if 'background' in manifest or 'update_url' in manifest:
        raise ValueError('GitHub-only unpacked extension must not claim browser-managed updates')
    if not all(p in config for p in ("oauthClientId: ''", "spreadsheetId: ''")):
        raise ValueError('Public config.js must contain blank private configuration')
    for rel in EXTENSION_FILES:
        if not (EXT/rel).is_file(): raise FileNotFoundError(str(EXT/rel))
    for rel in EXTRAS:
        if not (ROOT/rel).is_file(): raise FileNotFoundError(rel)
    for size in (16,48,128):
        icon=f'icons/icon{size}.png'
        if manifest.get('icons',{}).get(str(size)) != icon: raise ValueError(f'Icon mapping missing: {size}')
        if not (EXT/icon).read_bytes().startswith(b'\x89PNG\r\n\x1a\n'): raise ValueError(f'Invalid PNG: {icon}')
    version=manifest['version']
    if not isinstance(version,str) or len(version.split('.')) != 3 or not all(p.isdigit() for p in version.split('.')):
        raise ValueError('Version must be X.Y.Z')
    return version


def build(out):
    version=verify()
    out=Path(out)
    out.mkdir(parents=True,exist_ok=True)
    archive=out/f'project-dashboard-v{version}.zip'
    entries=[(f'extension/{rel}',(EXT/rel).read_bytes()) for rel in EXTENSION_FILES]
    entries.extend((rel,(ROOT/rel).read_bytes()) for rel in EXTRAS)
    with zipfile.ZipFile(archive,'w') as zf:
        for rel,content in sorted(entries):
            parts=PurePosixPath(rel).parts
            if '..' in parts or rel.startswith('/') or '\\' in rel: raise ValueError('Unsafe entry path')
            info=zipfile.ZipInfo(rel,date_time=(2026,1,1,0,0,0))
            info.compress_type=zipfile.ZIP_DEFLATED
            info.external_attr=0o644 << 16
            zf.writestr(info,content)
    sums=out/'SHA256SUMS.txt'
    sums.write_text(f'{hashlib.sha256(archive.read_bytes()).hexdigest()}  {archive.name}\n',encoding='utf-8')
    return archive,sums

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--out',type=Path,default=ROOT/'dist')
    args=parser.parse_args()
    for item in build(args.out): print(item)
