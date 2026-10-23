"""Synthetic Chromium UI wiring test. Not a Brave or real Google OAuth validation."""
import asyncio
from pathlib import Path
import re
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[1]
JS=r'''
(()=>{
  window.__release404=false;
  window.__calls=[];
  window.__store={};
  const makeStorage=(label)=>({
    async get(key) {
      const keys=Array.isArray(key)?key:[key];const found={};
      for(const k of keys)if(Object.prototype.hasOwnProperty.call(window.__store,label+k))found[k]=window.__store[label+k];
      return found;
    },
    async set(obj){for(const [k,v] of Object.entries(obj))window.__store[label+k]=v},
    async remove(keys){for(const k of Array.isArray(keys)?keys:[keys])delete window.__store[label+k]}
  });
  const chromeMock={
    runtime:{getManifest(){return {version:'1.4.0'};}},
    identity:{getRedirectURL(){return 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/';},
      async launchWebAuthFlow({url}){
        const params=new URL(url).searchParams;
        return params.get('redirect_uri')+'#access_token=SIMULATED&expires_in=3600&state='+params.get('state');
      }},
    storage:{local:makeStorage('local:'),session:makeStorage('session:')}
  };
  window.chrome=chromeMock;
  window.fetch=async(url)=>{
    window.__calls.push(url);
    const target=String(url);
    if(target.startsWith('https://api.github.com/')){
      if(window.__release404)return {ok:false,status:404};
      return {ok:true,status:200,json:async()=>({tag_name:'v1.4.1',draft:false,prerelease:false})};
    }
    if(target.startsWith('https://sheets.googleapis.com/')){
      return {ok:true,status:200,json:async()=>({values:target.includes('History')?
       [['Timestamp','Project'],['2026-10-22 17:17 KST','Demo Project']]:
       [['Project','Status','Next','Updated'],['Demo Project','Active','Review work','2026-10-22 17:17 KST']]})};
    }
    throw new Error('Unexpected URL '+url);
  };
})();
'''

async def run():
  async with async_playwright() as p:
    browser=await p.chromium.launch(**({'executable_path':'/usr/bin/chromium'} if Path('/usr/bin/chromium').exists() else {}),headless=True,args=['--no-sandbox'])
    context=await browser.new_context(viewport={'width':1200,'height':800},accept_downloads=True)
    page=await context.new_page()
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    html=(ROOT/'extension'/'newtab.html').read_text()
    html=re.sub(r'<script src="[^"]+"></script>', '', html)
    await page.set_content(html)
    await page.add_style_tag(content=(ROOT/'extension'/'newtab.css').read_text())
    await page.evaluate(JS)
    for src in ['config.js','pulse-core.js','newtab.js']:
      await page.add_script_tag(content=(ROOT/'extension'/src).read_text())
    await page.wait_for_timeout(150)
    assert await page.locator('#settingsPanel').is_visible()
    assert await page.locator('#versionInfo').inner_text()=='v1.4.0'
    assert 'kurichon/project_dashboard'==await page.locator('#releaseRepoInput').input_value()
    await page.locator('#spreadsheetInput').fill('1PROJECT_DASHBOARD_SYNTHETIC_SHEET_00000')
    await page.locator('#oauthClientInput').fill('12345-example.apps.googleusercontent.com')
    await page.locator('#saveSettingsBtn').click()
    assert await page.locator('#connectBtn').is_visible()
    await page.locator('#connectBtn').click()
    await page.wait_for_timeout(150)
    assert await page.locator('.card').count()==1,await page.locator('#notice').inner_text()
    assert 'Demo Project' in await page.locator('.card').inner_text()
    await page.locator('#updateBtn').click()
    await page.wait_for_timeout(200)
    assert 'v1.4.1' in await page.locator('#updateText').inner_text()
    assert 'Download the release ZIP' in await page.locator('#updateText').inner_text()
    assert await page.locator('#updateLink').get_attribute('href')=='https://github.com/kurichon/project_dashboard/releases/latest'
    assert await page.evaluate('typeof chrome.runtime.requestUpdateCheck === "undefined"')
    assert await page.evaluate('Object.keys(window.__store).some(k=>k.includes("projectPulseCacheV2"))')

    # Export settings; inspect the actual browser download.
    await page.locator('#settingsBtn').click()
    async with page.expect_download() as download_info:
      await page.locator('#exportSettingsBtn').click()
    dl=await download_info.value
    assert dl.suggested_filename=='project-dashboard-settings.json'
    import json
    backup=json.loads(Path(await dl.path()).read_text())
    assert backup['settings']['spreadsheetId']=='1PROJECT_DASHBOARD_SYNTHETIC_SHEET_00000'
    assert 'token' not in json.dumps(backup).lower()
    assert 'Demo Project' not in json.dumps(backup)

    # Bad import is rejected without clearing the dashboard.
    await page.locator('#importSettingsFile').set_input_files({'name':'bad.json','mimeType':'application/json','buffer':b'{bad json'})
    await page.wait_for_timeout(100)
    assert await page.locator('.card').count()==1
    assert 'not valid JSON' in await page.locator('#settingsMessage').inner_text()

    # Restoring a valid backup invalidates cache/auth, not user-configured settings.
    page.on('dialog',lambda dialog:asyncio.create_task(dialog.accept()))
    await page.locator('#importSettingsFile').set_input_files({'name':'config.json','mimeType':'application/json','buffer':json.dumps(backup).encode()})
    await page.wait_for_timeout(100)
    assert await page.locator('.card').count()==0
    restored=await page.evaluate('chrome.storage.local.get("projectPulseSettingsV3")')
    assert restored['projectPulseSettingsV3']['spreadsheetId']==backup['settings']['spreadsheetId']
    assert 'Settings imported' in await page.locator('#notice').inner_text()
    await page.locator('#connectBtn').click()
    await page.wait_for_timeout(100)
    assert await page.locator('.card').count()==1

    # If GitHub is unavailable, project data remains visible.
    await page.evaluate('window.__release404=true')
    await page.locator('#updateBtn').click()
    await page.wait_for_timeout(130)
    assert 'no published stable github releases' in (await page.locator('#updateText').inner_text()).lower()
    assert await page.locator('.card').count()==1
    assert not errors,errors
    await browser.close()
    print('PASS simulated GitHub-only update check, dashboard preservation and settings export/import')

if __name__=='__main__':asyncio.run(run())
