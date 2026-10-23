const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const sandbox = { URL, Date };
vm.createContext(sandbox);
vm.runInContext(read('extension/pulse-core.js'), sandbox);
const Core = sandbox.PulseCore;
const own = x => JSON.parse(JSON.stringify(x));
const example = {
  spreadsheetId: '1TEST_SHEET_PLACEHOLDER_ID_2026_EXAMPLE',
  projectsTab: 'Projects', historyTab: 'History',
  oauthClientId: '12345-example.apps.googleusercontent.com',
  releaseRepo: 'kurichon/project_dashboard'
};

test('settings export has only five configuration fields, no sessions or cached content', () => {
  const backup = own(Core.createSettingsBackup({...example, token: 'SECRET', projects: [{name:'sensitive'}]}));
  assert.equal(backup.format, 'project-dashboard-settings');
  assert.equal(backup.version, 1);
  assert.deepEqual(backup.settings, example);
  assert.doesNotMatch(JSON.stringify(backup), /SECRET|sensitive|AuthSession|CacheV2/);
  assert.deepEqual(own(Core.parseSettingsBackup(JSON.stringify(backup))), example);
});

test('backup import refuses wrong format, version, extra fields and malformed JSON', () => {
  const backup=own(Core.createSettingsBackup(example));
  for (const item of [
    '{ invalid JSON',
    JSON.stringify({...backup, version: 99}),
    JSON.stringify({...backup, format: 'unknown'}),
    JSON.stringify({...backup, token: 'leak'}),
    JSON.stringify({...backup, settings: {...example, accessToken:'leak'}}),
    JSON.stringify({...backup, settings: {...example, oauthClientId:'malformed'}}),
    JSON.stringify({...backup, settings: {...example, spreadsheetId:'https://evil.example/a'}}),
    JSON.stringify({...backup, settings: {...example, projectsTab:''}}),
    JSON.stringify({...backup, settings: {spreadsheetId:example.spreadsheetId}})
  ]) assert.throws(()=>Core.parseSettingsBackup(item), undefined, `Invalid input should be rejected: ${item.slice(0,80)}`);
});

test('manifest declares browser-owned MV3 update events without new permissions', () => {
  const m=JSON.parse(read('extension/manifest.json'));
  assert.equal(m.name, 'Project Dashboard');
  assert.equal(m.version, '1.4.0');
  assert.deepEqual(m.background,{service_worker:'background.js'});
  assert.deepEqual(m.permissions,['identity','storage']);
  assert.equal(m.update_url,undefined);
  assert.equal(m.key,undefined);
  for(const size of [16,48,128]) assert.ok(fs.statSync(path.join(root,'extension/icons',`icon${size}.png`)).size>100);
});

test('background records pending and installed updates without touching settings', async () => {
  const listeners = {};
  const store = { projectPulseSettingsV3: {...example} };
  const chrome = {
    runtime: {
      onUpdateAvailable: {addListener(fn){listeners.available=fn}},
      onInstalled: {addListener(fn){listeners.installed=fn}},
      getManifest(){return {version:'1.4.0'}}
    },
    storage:{ local: {
      async set(data){Object.assign(store,data)},
      async remove(k){for(const p of (Array.isArray(k)?k:[k])) delete store[p]}
    }}
  };
  const context=vm.createContext({chrome,Date});
  vm.runInContext(read('extension/background.js'),context);
  listeners.available({version:'1.4.1'});
  await new Promise(r=>setImmediate(r));
  assert.equal(store[Core.UPDATE_PENDING_KEY].version,'1.4.1');
  listeners.installed({reason:'update',previousVersion:'1.3.0'});
  await new Promise(r=>setImmediate(r));
  assert.equal(store[Core.UPDATE_INSTALLED_KEY].from,'1.3.0');
  assert.equal(store[Core.UPDATE_INSTALLED_KEY].to,'1.4.0');
  assert.equal(store[Core.UPDATE_PENDING_KEY],undefined);
  assert.deepEqual(store.projectPulseSettingsV3,example);
});

test('update events and settings retain existing legacy storage keys',()=>{
  assert.equal(Core.SETTINGS_KEY,'projectPulseSettingsV3');
  assert.equal(Core.CACHE_KEY,'projectPulseCacheV2');
  assert.equal(Core.UPDATE_KEY,'projectPulseReleaseCheckV1');
  assert.match(read('extension/newtab.js'), /PROJECT_PULSE_CONFIG/);
});
