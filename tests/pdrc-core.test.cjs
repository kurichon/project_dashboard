const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sandbox = {URL, Date};
vm.createContext(sandbox);
for (const name of ['pulse-core.js','pdrc-core.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension', name), 'utf8'), sandbox);
}
const P = sandbox.PDRCCore, Core = sandbox.PulseCore;
const sheet = id => 'https://docs.google.com/spreadsheets/d/' + id + '/edit';
const registry = [
  ['project_id','name','source_type','source_ref','contract_version','enabled','profile','migration_state'],
  ['alpha','Project Alpha','google_sheets',sheet('1TEST_PDRC_ALPHA_STANDARDIZED_2026'),'1.0',true,'feature_gates','staged'],
  ['beta','Project Beta','google_sheets',sheet('1TEST_PDRC_BETA_STANDARDIZED_2026'),'1.0',true,'milestones','staged']
];
const table = (headers, rows) => ({values: [headers,...rows]});
function data(id = 'alpha') {
  return [
    table(['project_id','name','lifecycle','phase','status_text','next_action','updated_at'],[
      [id,'Project Alpha','unknown','release_stabilization','Development preview','Qualify release','2026-10-27T09:00:00+09:00']
    ]),
    table(['id','kind','title','work_state','verification_state','required','target_date','completed_at'],[
      ['F01','feature','Native monitor','implemented','unknown',true,'',''],
      ['F02','feature','Mission progress','in_progress','unverified',true,'',''],
      ['F03','feature','Live client validation','unknown','unknown',true,'','']
    ]),
    table(['event_id','project_id','occurred_at','precision','event_type','status_text','next_action'],[
      ['one',id,'2026-10-25T10:00:00+09:00','minute','project_update','Code merged','Verify'],
      ['two',id,'2026-10-26T10:00:00+09:00','minute','project_update','Tests passed','Run live'],
      ['future',id,'2027-10-26T10:00:00+09:00','minute','project_update','Future','Ignore']
    ]),
    table(['id','target_id','kind','uri'],[]),
    table(['contract_version','project_id','source_type','source_ref'],[
      ['1.0',id,'github','https://github.com/example/provenance']
    ])
  ];
}

test('recognizes master registry while leaving legacy Projects alone', () => {
  assert.equal(P.isRegistryRows(registry), true);
  assert.equal(P.isRegistryRows([['Project','Status','Next','Updated']]), false);
  assert.equal(P.parseRegistry(registry, Core.parseSpreadsheetId).length, 2);
});
test('enforces unique IDs, enabled state, and trusted Google Sheet URLs', () => {
  assert.throws(() => P.parseRegistry([...registry,registry[1]],Core.parseSpreadsheetId), /duplicate/);
  const evil = [...registry.map(r=>[...r])];evil[1][3]='https://evil.example/secret';
  const entries=P.parseRegistry(evil,Core.parseSpreadsheetId);
  assert.equal(entries[0].sourceId,'');
  assert.match(entries[0].error,/Invalid Google Sheet/);
  evil[1][5]=false;
  assert.equal(P.parseRegistry(evil,Core.parseSpreadsheetId).length,1);
});
test('normalizes feature gates without confusing wired code with verified software', () => {
  const [entry]=P.parseRegistry(registry,Core.parseSpreadsheetId);
  const p=P.normalizeProject(entry,data(),Core.parseSheetDate,Date.parse('2026-10-27T12:00:00+09:00'));
  assert.equal(p.totalDeliverables,3);
  assert.equal(p.verified,0);
  assert.equal(p.workStates.implemented,1);
  assert.equal(p.workStates.in_progress,1);
  assert.equal(p.workStates.unknown,1);
  assert.equal(p.count,2);
  assert.equal(p.historyCount,3);
  assert.equal(p.events[0].id,'future');
  assert.equal(p.lifecycle,'unknown');
});
test('source provenance may differ from standardized reporting source', () => {
  const [entry]=P.parseRegistry(registry,Core.parseSpreadsheetId);
  assert.doesNotThrow(()=>P.normalizeProject(entry,data(),Core.parseSheetDate));
});
test('rejects project identity mismatches, unknown contract versions, duplicate history events', () => {
  const [entry]=P.parseRegistry(registry,Core.parseSpreadsheetId);
  assert.throws(()=>P.normalizeProject(entry,data('wrong'),Core.parseSheetDate),/identity/);
  const broken=data();broken[4].values[1][0]='2.0';
  assert.throws(()=>P.normalizeProject(entry,broken,Core.parseSheetDate),/contract version/);
  const dup=data();dup[2].values.push([...dup[2].values[1]]);
  const p=P.normalizeProject(entry,dup,Core.parseSheetDate);
  assert.equal(p.invalidHistory,1);
  assert.equal(p.historyCount,3);
});
test('empty structured deliverables is valid but does not imply completed or 0 percent', () => {
  const [entry]=P.parseRegistry(registry,Core.parseSpreadsheetId);
  const empty=data();empty[1].values=empty[1].values.slice(0,1);
  const p=P.normalizeProject(entry,empty,Core.parseSheetDate);
  assert.equal(p.totalDeliverables,0);
  assert.equal(p.lifecycle,'unknown');
});
