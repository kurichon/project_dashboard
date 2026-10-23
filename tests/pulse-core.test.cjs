const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname,'../extension/pulse-core.js'), 'utf8');
const sandbox = {URL, Date, console};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const P = sandbox.PulseCore;
const own = o => JSON.parse(JSON.stringify(o));

test('source selection accepts Google Sheets URL or ID', () => {
  const id = '1PULSE_TEST_SHEET_ID_ONLY_EXAMPLE_2026_00';
  assert.equal(P.parseSpreadsheetId(id), id);
  assert.equal(P.parseSpreadsheetId(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=2`), id);
  assert.equal(P.parseSpreadsheetId(`http://docs.google.com/spreadsheets/d/${id}/edit`), '');
  assert.equal(P.parseSpreadsheetId(`https://evil.com/spreadsheets/d/${id}/edit`), '');
  assert.equal(P.parseSpreadsheetId('https://drive.google.com/drive/folders/123abc'), '');
});

test('spreadsheet input cannot be a folder, random URL, or invalid ID', () => {
  for (const value of ['x', '../foo', 'https://docs.google.com/document/d/a/edit', 'https://github.com/foo/bar']) {
    assert.throws(() => P.validateSettings({...P.DEFAULTS, spreadsheetId:value}), /Spreadsheet/);
  }
});

test('validates and quotes custom tab names', () => {
  assert.equal(P.quoteTab("Jane's Projects"), "'Jane''s Projects'");
  for (const bad of ['Tab/X', 'A:B','Invalid[1]', '', '  ']) assert.equal(P.validTab(bad),false);
  assert.deepEqual(own(P.validateSettings({spreadsheetId:'',projectsTab:'Jane 2026',historyTab:'',releaseRepo:''})),
    {spreadsheetId:'',projectsTab:'Jane 2026',historyTab:'',oauthClientId:'',releaseRepo:''});
});

test('restricts releases to a canonical GitHub owner/repo', () => {
  assert.equal(P.parseReleaseRepo('my-org/pulse'), 'my-org/pulse');
  assert.equal(P.parseReleaseRepo('https://github.com/my-org/pulse/'), 'my-org/pulse');
  assert.equal(P.releaseApiUrl('my-org/pulse'), 'https://api.github.com/repos/my-org/pulse/releases/latest');
  for (const bad of ['https://github.com/a/b/issues', 'https://fakegithub.com/a/b', 'x', 'a/../b', 'http://github.com/a/b', 'a/b?foo=1']) {
    assert.equal(P.parseReleaseRepo(bad), '', bad);
  }
});

test('invalid oauth client IDs and GitHub repos are rejected', () => {
  assert.throws(() => P.validateSettings({...P.DEFAULTS, oauthClientId:'secret'}), /OAuth/);
  assert.throws(() => P.validateSettings({...P.DEFAULTS, releaseRepo:'https://not-github.com/x/y'}), /GitHub/);
});

test('keeps cache identities unique by spreadsheet and tab mapping', () => {
  const a = P.sourceIdentity({spreadsheetId:'foo',projectsTab:'Projects',historyTab:'History'});
  const b = P.sourceIdentity({spreadsheetId:'bar',projectsTab:'Projects',historyTab:'History'});
  const c = P.sourceIdentity({spreadsheetId:'foo',projectsTab:'Active',historyTab:'History'});
  assert.notEqual(a,b); assert.notEqual(a,c);
});

test('reads existing header rows without depending on column casing', () => {
  const rows = [['Project','Status','Next','Updated'],['Project One','In progress','Do it','2026-10-22 17:17 KST']];
  assert.doesNotThrow(() => P.headerCheck(rows, ['project','status','next','updated']));
  assert.deepEqual(own(P.rowsToObjects(rows))[0], {
    project:'Project One',status:'In progress',next:'Do it',updated:'2026-10-22 17:17 KST'
  });
  assert.throws(() => P.headerCheck([['Project','Status']], ['project','next']), /next/);
});

test('parses KST, UTC, offset, date-only and hour-only source dates', () => {
  assert.equal(P.parseSheetDate('2026-10-22 17:17 KST').toISOString(),'2026-10-22T08:17:00.000Z');
  assert.equal(P.parseSheetDate('2026-10-21 14 KST').toISOString(),'2026-10-21T05:00:00.000Z');
  assert.equal(P.parseSheetDate('2026-10-22T09:00:00Z').toISOString(),'2026-10-22T09:00:00.000Z');
  assert.equal(P.parseSheetDate('2026-10-22 18:30 +0900').toISOString(),'2026-10-22T09:30:00.000Z');
  assert.ok(P.parseSheetDate('2026-10-11') instanceof Date);
  assert.equal(P.parseSheetDate('SHIFTED_ROW_NOT_A_DATE'),null);
  assert.equal(P.parseSheetDate('2026-13-32 99:99 KST'),null);
});

test('history ignores malformed and future rows', () => {
  const now = Date.parse('2026-10-23T10:00:00+09:00');
  const sample = [
    {timestamp:'2026-10-22 17:17 KST',project:'A'},
    {timestamp:'2026-10-21 14 KST',project:'A'},
    {timestamp:'SHIFTED_ROW_NOT_A_DATE',project:'Long status shifted left'},
    {timestamp:'2026-10-10 10:00 KST',project:'A'},
    {timestamp:'2026-11-01 10:00 KST',project:'A'},
  ];
  const r=P.historyCounts(sample,now);
  assert.equal(r.counts.get('A'),2);
  assert.equal(r.rejected,1);
});

test('version comparison uses semantic numeric triples', () => {
  assert.equal(P.compareVersions('v1.3.10','1.3.9'),1);
  assert.equal(P.compareVersions('1.3.0','1.3.0'),0);
  assert.equal(P.compareVersions('1.2.9','1.3.0'),-1);
  assert.equal(P.compareVersions('1.3.0-beta.1','1.3.0'),null);
  assert.equal(P.compareVersions('garbage','1.3.0'),null);
});


test('public update repository is the distribution default; legacy storage keys remain stable', () => {
  assert.equal(P.DEFAULTS.releaseRepo, 'kurichon/project_dashboard');
  assert.equal(P.SETTINGS_KEY, 'projectPulseSettingsV3');
  assert.equal(P.CACHE_KEY, 'projectPulseCacheV2');
  assert.equal(P.UPDATE_KEY, 'projectPulseReleaseCheckV1');
});