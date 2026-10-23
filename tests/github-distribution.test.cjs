const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const sandbox = {URL, Date};
vm.createContext(sandbox);
vm.runInContext(read('extension/pulse-core.js'),sandbox);
const P = sandbox.PulseCore;
const own = x => JSON.parse(JSON.stringify(x));
const example = {spreadsheetId:'1PROJECT_DASHBOARD_SYNTHETIC_SHEET_00000',projectsTab:'Projects',historyTab:'History',oauthClientId:'12345-example.apps.googleusercontent.com',releaseRepo:'kurichon/project_dashboard'};

test('GitHub-only manifest with stable settings identity',()=>{
  const m=JSON.parse(read('extension/manifest.json'));
  assert.equal(m.name,'Project Dashboard');
  assert.equal(m.version,'1.4.1');
  assert.equal(m.manifest_version,3);
  assert.deepEqual(m.permissions,['identity','storage']);
  assert.ok(!m.background && !m.update_url && !m.key);
  assert.equal(P.SETTINGS_KEY,'projectPulseSettingsV3');
  assert.equal(P.CACHE_KEY,'projectPulseCacheV2');
  assert.equal(P.UPDATE_KEY,'projectPulseReleaseCheckV1');
  for(const size of [16,48,128])assert.ok(fs.existsSync(path.join(root, `extension/icons/icon${size}.png`)));
});

test('release check uses stable GitHub REST and does not attempt store install',()=>{
 assert.equal(P.releaseApiUrl('kurichon/project_dashboard'),'https://api.github.com/repos/kurichon/project_dashboard/releases/latest');
 assert.equal(P.releasePageUrl('kurichon/project_dashboard'),'https://github.com/kurichon/project_dashboard/releases/latest');
 const src=read('extension/newtab.js');
 assert.match(src,/Download the release ZIP/);
 assert.match(src,/checkUpdates\(true\)/);
 assert.doesNotMatch(src,/requestUpdateCheck|showBrowserUpdateState|Chrome Web Store|store rollout/i);
 assert.doesNotMatch(JSON.stringify(JSON.parse(read('extension/manifest.json'))),/background.js/);
});

test('backup includes settings only, and import rejects unexpected fields',()=>{
 const b=own(P.createSettingsBackup({...example,secret:'UNSAFE_SECRET',cache:[{project:'sensitive'}]}));
 assert.equal(b.format,'project-dashboard-settings');
 assert.deepEqual(b.settings,example);
 assert.doesNotMatch(JSON.stringify(b),/UNSAFE_SECRET|sensitive/);
 assert.deepEqual(own(P.parseSettingsBackup(JSON.stringify(b))),example);
 assert.throws(()=>P.parseSettingsBackup(JSON.stringify({...b,token:'oops'})),/unexpected/i);
 assert.throws(()=>P.parseSettingsBackup('{not json'),/valid JSON/i);
});

test('GitHub downloader is explicit and hash-validating; no install from browser',()=>{
 const downloader=read('tools/update-from-github.ps1');
 const offline=read('tools/upgrade-local.ps1');
 assert.match(downloader,/releases\/latest/);
 assert.match(downloader,/SHA256SUMS\.txt/);
 assert.match(downloader,/Get-FileHash/);
 assert.match(downloader,/upgrade-local\.ps1/);
 assert.match(downloader,/\$env:LOCALAPPDATA/);
 assert.match(downloader,/\$release\.prerelease/);
 assert.match(offline,/\$old\.key/);
 assert.match(offline,/Copy-Item.*\$oldConfig/);
 assert.ok(fs.existsSync(path.join(root,'Update Project Dashboard.cmd')));
});
