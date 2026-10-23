"""Sanitized package contracts for GitHub legacy and the Chrome Web Store."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import zipfile
import importlib.util
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('package_release', ROOT/'tools'/'package-release.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
build = module.build

class Packages(unittest.TestCase):
    def test_packages_are_deterministic_distinct_and_sanitized(self):
        with tempfile.TemporaryDirectory() as d:
            out=Path(d)
            developer,store,sums=build(out)
            with zipfile.ZipFile(developer) as z:
                names=set(z.namelist())
                self.assertIn('tools/upgrade-local.ps1',names)
                self.assertIn('extension/manifest.json',names)
                self.assertNotIn('manifest.json',names)
            with zipfile.ZipFile(store) as z:
                names=set(z.namelist())
                self.assertIn('manifest.json',names)
                self.assertNotIn('tools/upgrade-local.ps1',names)
                self.assertNotIn('README.md',names)
                self.assertTrue(all(not n.endswith('.pem') for n in names))
                config=z.read('config.js').decode('utf-8')
                self.assertIn("oauthClientId: ''",config)
                self.assertIn("spreadsheetId: ''",config)
                manifest=json.loads(z.read('manifest.json'))
                self.assertNotIn('key',manifest)
                self.assertEqual(manifest['background']['service_worker'],'background.js')
                for size in ('16','48','128'):
                    icon=manifest['icons'][size]
                    self.assertIn(icon,names)
                    self.assertTrue(z.read(icon).startswith(b'\x89PNG\r\n\x1a\n'))
            checksums=sums.read_text()
            for archive in (developer,store):
                self.assertIn(f"{hashlib.sha256(archive.read_bytes()).hexdigest()}  {archive.name}", checksums)
                original=archive.read_bytes()
                build(out)
                self.assertEqual(original,archive.read_bytes())

if __name__=='__main__':unittest.main()
