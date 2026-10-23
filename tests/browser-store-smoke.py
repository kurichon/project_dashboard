"""Real Chromium DOM exercise with mocked extension APIs, NOT a Web Store/OAuth test."""
import asyncio
import json
from pathlib import Path
import re
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[1]
MOCK=r'''
(() => {
  window.__calls=[];
  window.__browserChecks=0;
  window.__releaseTag='v1.4.1';
  window.__browserStatus='no_update';
  const local={}; const session={};
  window.__local=local;
  function area(state) {return {
    async get(keys) { const list=Array.isArray(keys)?keys:[keys],r={}; for(const k of list) if(Object.hasOwn(state,k))r[k]=structuredClone(state[k]); return r; },
    async set(data) {Object.assign(state,structuredClone(data));},
    async remove(keys) {for(const k of (Array.isArray(keys)?keys:[keys]))delete state[k]}
  }}
  Object.assign(window.chrome || (window.chrome = {}),{
    runtime: {
      getManifest:()=>({version:'1.4.0'}),
      async requestUpdateCheck(){window.__browserChecks++;return {status:window.__browserStatus}}
    },
    identity: {
      getRedirectURL:()=> 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/',
      async launchWebAuthFlow({url}) {
        const u=new URL(url);
        return u.searchParams.get('redirect_uri')+'#access_token=MOCKTOKEN&expires_in=3600&state='+u.searchParams.get('state')+'&authuser=0';
      }
    },
    storage: {local:area(local),session:area(session)}
  });
  window.fetch=async url=>{
    window.__calls.push(url);
    if(String(url).startsWith('https://api.github.com/')){
      return {ok:true,status:200,json:async()=>({tag_name:window.__releaseTag,draft:false,prerelease:false})};
    }
    if(String(url).startsWith('https://sheets.googleapis.com/')){
      const history=[['Timestamp','Project'],['2026-10-23T00:00:00Z','Sample Project']];
      const projects=[['Project','Status','Next','Updated'],['Sample Project','In progress','Run end-to-end checks','2026-10-23T00:00:00Z']];
      return {ok:true,status:200,json:async()=>({values:decodeURIComponent(url).includes('History')?history:projects})};
    }
    throw Error('Unexpected mock URL '+url);
  };
})();
'''

async def run():
  async with async_playwright() as p:
    import os
    browser_path='/usr/bin/chromium' if os.path.exists('/usr/bin/chromium') else None
    browser=await p.chromium.launch(executable_path=browser_path,headless=True,args=['--no-sandbox'])
    context=await browser.new_context(viewport={'width':1280,'height':800},accept_downloads=True)
    page=await context.new_page()
    errors=[]
    page.on('pageerror',lambda x:errors.append(str(x)))
    html=re.sub(r'<script src="[^"]+"></script>','',(ROOT/'extension/newtab.html').read_text())
    await page.set_content(html)
    await page.add_style_tag(content=(ROOT/'extension/newtab.css').read_text())
    await page.evaluate(MOCK)
    for f in ('config.js','pulse-core.js','newtab.js'):
      await page.add_script_tag(content=(ROOT/'extension'/f).read_text())
    await page.wait_for_timeout(150)
    assert await page.locator('#settingsPanel').is_visible()
    assert await page.locator('#versionInfo').inner_text()=='v1.4.0'
    assert await page.evaluate('window.__browserChecks')==0,'No automatic forced store checks allowed'
    await page.locator('#spreadsheetInput').fill('1TEST_SHEET_PLACEHOLDER_ID_2026_EXAMPLE')
    await page.locator('#oauthClientInput').fill('12345-example.apps.googleusercontent.com')
    await page.locator('#saveSettingsBtn').click()
    await page.locator('#connectBtn').click()
    await page.wait_for_timeout(150)
    assert await page.locator('.card').count()==1
    assert 'Sample Project' in await page.locator('.card').inner_text()
    await page.screenshot(path=str(Path(__file__).resolve().parent/'store-preview-synthetic.png'))
    await page.locator('#settingsBtn').click()
    async with page.expect_download() as info:
      await page.locator('#exportSettingsBtn').click()
    download=await info.value
    assert download.suggested_filename=='project-dashboard-settings.json'
    f=str(Path(__file__).resolve().parent/'store-migration-test.json')
    await download.save_as(f)
    content=Path(f).read_text()
    data=json.loads(content)
    assert data['format']=='project-dashboard-settings'
    assert '1TEST_SHEET_PLACEHOLDER_ID' in content
    assert 'MOCKTOKEN' not in content
    assert 'cache' not in content.lower()
    # Change source, then import old configuration.
    await page.locator('#spreadsheetInput').fill('1ANOTHER_PLACEHOLDER_SPREADSHEET_ID_2026_EXAMPLE')
    await page.locator('#saveSettingsBtn').click()
    assert await page.locator('.card').count()==0
    await page.locator('#settingsBtn').click()
    page.once('dialog',lambda dialog:asyncio.create_task(dialog.accept()))
    await page.locator('#importSettingsFile').set_input_files(f)
    await page.wait_for_timeout(200)
    orig=await page.evaluate('chrome.storage.local.get("projectPulseSettingsV3").then(x=>x.projectPulseSettingsV3.spreadsheetId)')
    assert orig=='1TEST_SHEET_PLACEHOLDER_ID_2026_EXAMPLE',orig
    assert 'imported' in (await page.locator('#notice').inner_text()).lower()
    assert not await page.evaluate('chrome.storage.session.get("projectPulseAuthSessionV2").then(x=>!!x.projectPulseAuthSessionV2)')
    assert await page.locator('.card').count()==0
    # Invalid import must not mutate current settings.
    invalid=Path(__file__).resolve().parent/'invalid-settings.json'
    invalid.write_text('{"token":"bad"}')
    await page.locator('#settingsBtn').click()
    await page.locator('#importSettingsFile').set_input_files(str(invalid))
    await page.wait_for_timeout(120)
    assert 'not a supported' in (await page.locator('#settingsMessage').inner_text()).lower()
    assert orig==await page.evaluate('chrome.storage.local.get("projectPulseSettingsV3").then(x=>x.projectPulseSettingsV3.spreadsheetId)')
    # Manual confirmed GitHub release triggers *one* browser check. No GitHub code is loaded.
    await page.locator('#settingsBtn').click()
    await page.locator('#updateBtn').click()
    await page.wait_for_timeout(150)
    assert await page.evaluate('window.__browserChecks')==1
    assert 'not offered' in (await page.locator('#updateText').inner_text()).lower()
    assert not errors,errors
    Path(f).unlink(missing_ok=True)
    invalid.unlink(missing_ok=True)
    (Path(__file__).resolve().parent/'store-preview-synthetic.png').unlink(missing_ok=True)
    print('PASS: Chromium UI, cards, settings export/import, tokens excluded, invalid backup rejected, manual browser update check')
    await browser.close()

if __name__=='__main__':
  asyncio.run(run())