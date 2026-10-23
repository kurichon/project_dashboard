const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('manifest branding and no embedded identity',()=>{
  const manifest=JSON.parse(read('extension/manifest.json'));
  assert.equal(manifest.name,'Project Dashboard');
  assert.equal(manifest.version,'1.4.0');
  assert.ok(!manifest.key, 'Public manifest must not carry a personal key');
  const config=read('extension/config.js');
  assert.match(config,/oauthClientId:\s*''/);
  assert.match(config,/spreadsheetId:\s*''/);
});
test('stable preexisting browser storage keys survive branding rename',()=>{
  assert.match(read('extension/pulse-core.js'),/projectPulseSettingsV3/);
  assert.match(read('extension/pulse-core.js'),/projectPulseCacheV2/);
  assert.match(read('extension/newtab.js'),/PROJECT_PULSE_CONFIG/);
});
test('updater accepts old name and new name without requiring reinstall',()=>{
  const source=read('tools/upgrade-local.ps1');
  assert.match(source,/Project Pulse.*Project Dashboard/);
  assert.match(source,/Copy-Item.*oldConfig|Copy-Item\s+-LiteralPath\s+\$oldConfig/);
  assert.match(source,/Get-FileHash/);
});
test('store distribution files preserve legacy identity',()=>{
 const m=JSON.parse(read('extension/manifest.json'));
 assert.equal(m.background.service_worker,'background.js');
 assert.equal(m.icons['128'],'icons/icon128.png');
 assert.ok(fs.existsSync(path.join(root,'extension/icons/icon128.png')));
 assert.match(read('extension/newtab.js'),/exportSettingsBtn/);
});
