"""Privacy, update package layout and deterministic GitHub Release assets."""
import importlib.util
import json
import hashlib
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('packaging',ROOT/'tools'/'package-release.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class GitHubPackage(unittest.TestCase):
    def test_single_package_and_deterministic_hash(self):
        with tempfile.TemporaryDirectory() as folder:
            archive,checksums=module.build(Path(folder))
            self.assertEqual(archive.name,'project-dashboard-v1.4.1.zip')
            self.assertEqual(checksums.name,'SHA256SUMS.txt')
            self.assertEqual(len(list(Path(folder).glob('*.zip'))),1)
            with ZipFile(archive) as z:
                names=set(z.namelist())
                self.assertIn('extension/manifest.json',names)
                self.assertIn('extension/pdrc-core.js',names)
                self.assertIn('extension/pdrc-view.js',names)
                self.assertIn('tools/upgrade-local.ps1',names)
                self.assertIn('tools/update-from-github.ps1',names)
                self.assertIn('Update Project Dashboard.cmd',names)
                self.assertIn('LICENSE',names)
                self.assertIn('docs/GITHUB_RELEASES.md',names)
                self.assertIn('docs/PDRC_V1.md',names)
                self.assertNotIn('manifest.json',names)
                self.assertNotIn('docs/WEB_STORE_RELEASE.md',names)
                self.assertNotIn('extension/background.js',names)
                self.assertTrue(all(not name.endswith(('.pem','.p12','.pfx','.key')) for name in names))
                manifest=json.loads(z.read('extension/manifest.json'))
                self.assertNotIn('key',manifest)
                self.assertNotIn('background',manifest)
                config=z.read('extension/config.js').decode()
                self.assertIn("oauthClientId: ''",config)
                self.assertIn("spreadsheetId: ''",config)
                for size in (16,48,128):
                    icon=manifest['icons'][str(size)]
                    self.assertTrue(z.read('extension/'+icon).startswith(b'\x89PNG\r\n\x1a\n'))
            content=archive.read_bytes()
            self.assertEqual(checksums.read_text(),f'{hashlib.sha256(content).hexdigest()}  {archive.name}\n')
            module.build(Path(folder))
            self.assertEqual(archive.read_bytes(),content)

if __name__=='__main__': unittest.main()
