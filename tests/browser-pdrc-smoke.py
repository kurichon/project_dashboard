"""Read-only PDRC browser smoke with private Sheet HTTP fully mocked.
This tests UI controls and the current newtab wiring, not live Google access.
"""
import asyncio
from pathlib import Path
import re
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
MOCK = r"""
(() => {
  const master = '1TEST_MASTER_PDRC_BROWSERSMOKE_2026';
  const alpha = '1TEST_PDRC_ALPHA_SHEET_2026_BROWSERSMOKE';
  const beta = '1TEST_PDRC_BETA_SHEET_2026_BROWSERSMOKE';
  window.__mock = {denyId: '', denyMaster: false, calls: [], alpha, beta};
  const local = {'projectPulseSettingsV3': {
    spreadsheetId: master, projectsTab:'Registry', historyTab:'',
    oauthClientId:'12345-pdrc.apps.googleusercontent.com', releaseRepo:''
  }};
  const session = {'projectPulseAuthSessionV2': {token:'MOCK_PDRC_TOKEN', expiresAt: Date.now() + 3600000}};
  const store = items => ({
    async get(k) {
      const keys = Array.isArray(k) ? k : [k], out = {};
      for (const x of keys) if (Object.prototype.hasOwnProperty.call(items,x)) out[x] = JSON.parse(JSON.stringify(items[x]));
      return out;
    },
    async set(kv) { Object.assign(items, JSON.parse(JSON.stringify(kv))); },
    async remove(k) { for (const x of Array.isArray(k) ? k : [k]) delete items[x]; }
  });
  window.chrome = {
    runtime: {getManifest: () => ({version:'1.4.1'})},
    identity: {
      getRedirectURL: () => 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/',
      async launchWebAuthFlow({url}) {
        const qs=new URL(url).searchParams;
        return qs.get('redirect_uri')+'#state='+qs.get('state')+'&access_token=MOCK_PDRC_TOKEN&expires_in=3600&authuser=0';
      }
    },
    storage:{local:store(local),session:store(session)}
  };
  window.__mock.local=local; window.__mock.session=session;
  function valuesFor(id) {
    return [
      {values:[['project_id','name','lifecycle','phase','status_text','next_action','updated_at'],
        [id, id=== 'alpha'?'Project Alpha':'Project Beta','unknown','implementation',
          'In progress','Verify live', '2026-10-27T09:00:00+09:00']]},
      {values:[['id','kind','title','work_state','verification_state'],
        [id+'-01','feature','Working UI','implemented','unknown'],
        [id+'-02','feature','Operational validation','in_progress','unverified']]},
      {values:[['event_id','project_id','occurred_at','event_type','status_text','next_action'],
        [id+'-e',id,'2026-10-26T10:00:00+09:00','project_update','Implementation completed','Test next']]},
      {values:[['id','target_id','kind','uri']]},
      {values:[['contract_version','project_id','source_type','source_ref'],
        ['1.0',id,'github','https://github.com/example/provenance']]}
    ];
  }
  window.fetch = async (input,options) => {
    const url=String(input);
    window.__mock.calls.push(url);
    const spreadsheetId=url.match(/spreadsheets\/([^/]+)\/values/)?.[1];
    if (!spreadsheetId) throw Error('Unexpected endpoint '+url);
    let status=200,body;
    if (spreadsheetId===master) {
      status=window.__mock.denyMaster ? 403 : 200;
      body={values:[['project_id','name','source_type','source_ref','contract_version','enabled','profile'],
        ['alpha','Project Alpha','google_sheets','https://docs.google.com/spreadsheets/d/'+alpha+'/edit','1.0',true,'feature_gates'],
        ['beta','Project Beta','google_sheets','https://docs.google.com/spreadsheets/d/'+beta+'/edit','1.0',true,'feature_gates']]};
    } else if(spreadsheetId===alpha || spreadsheetId===beta) {
      if (!url.includes('values:batchGet')) throw Error('Per-project requests must use batchGet');
      if (url.match(/ranges=/g)?.length!==5) throw Error('All five PDRC interfaces must be fetched');
      status=window.__mock.denyId===spreadsheetId?403:200;
      body={valueRanges: valuesFor(spreadsheetId===alpha?'alpha':'beta')};
    } else throw Error('Unregistered Sheet accessed '+spreadsheetId);
    return {ok:status===200,status,async json(){return status===200?body:{error:{message:'mock access denied'}}}};
  };
})();
"""

async def main():
  async with async_playwright() as playwright:
    kw = {'executable_path':'/usr/bin/chromium'} if Path('/usr/bin/chromium').exists() else {}
    browser = await playwright.chromium.launch(**kw,headless=True,args=['--no-sandbox'])
    page=await browser.new_page(viewport={'width':1260,'height':920})
    errors=[]
    page.on('pageerror', lambda error: errors.append(str(error)))
    html=re.sub(r'<script src="[^"]+"></script>','',(ROOT/'extension/newtab.html').read_text())
    await page.set_content(html)
    await page.add_style_tag(content=(ROOT/'extension/newtab.css').read_text())
    await page.evaluate(MOCK)
    for file in ('config.js','pulse-core.js','pdrc-core.js','pdrc-view.js','newtab.js'):
      await page.add_script_tag(content=(ROOT/'extension'/file).read_text())
    await page.wait_for_function("document.querySelector('#syncState').textContent==='Synced'")
    assert await page.locator('.card').count()==2,await page.locator('#notice').inner_text()
    assert '2 deliverables' in await page.locator('.card').first.inner_text()
    assert 'Project Alpha' in await page.locator('.card').first.inner_text()
    await page.locator('.card').first.get_by_role('button',name='View details').click()
    assert await page.locator('#projectDetails').is_visible()
    assert await page.locator('#projectDetails .detail-table tbody tr').count()==2
    detail=await page.locator('#projectDetails').inner_text()
    assert 'Operational validation' in detail
    assert 'Unknown' in detail and 'Unverified' in detail
    assert 'Open authoritative project sheet' in detail
    await page.screenshot(path=str(ROOT/'tests/pdrc-browser-preview.png'),full_page=True)
    # One linked Sheet fails; keep its previous values and do not clear account/session.
    await page.evaluate("window.__mock.denyId=window.__mock.beta")
    await page.locator('#refreshBtn').click()
    await page.wait_for_function("document.querySelector('#syncState').textContent==='Partial sync'")
    assert await page.locator('.card').count()==2
    assert 'Cached' in await page.locator('.card').nth(1).inner_text()
    assert '2 deliverables' in await page.locator('.card').nth(1).inner_text()
    assert await page.evaluate("Boolean(window.__mock.session.projectPulseAuthSessionV2)")
    # Wrong-account 403 at root must remove the prior account's snapshot.
    await page.evaluate("window.__mock.denyMaster=true")
    await page.locator('#accountBtn').click()
    await page.wait_for_function("document.querySelector('#syncState').textContent==='Not connected'")
    assert await page.locator('.card').count()==0
    assert not await page.evaluate("Boolean(window.__mock.local.projectDashboardPDRCCacheV1)")
    assert await page.locator('#accountBtn').is_visible()
    assert not errors,errors
    await browser.close()
    print('PASS PDRC mocked Chromium: master registry, linked sources, detail view, per-source cache fallback, account isolation')

if __name__ == '__main__':
  asyncio.run(main())
