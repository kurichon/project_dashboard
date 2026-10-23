"""Browser UI smoke with fake extension APIs and intercepted Google/GitHub HTTP.
Not an actual Brave extension, OAuth, or online integration test.
"""
import asyncio
from pathlib import Path
import re
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[1]
MOCK_CHROME = r'''
(() => {
  window.__mockDenySheet = false;
  window.__calls = [];
  const read = () => {try {return JSON.parse(window.name || '{}')} catch(e) {return {}}};
  const write = state => {window.name=JSON.stringify(state)};
  const store = prefix => ({
    async get(key) {
      const keys = Array.isArray(key) ? key : [key];
      const o = read(),result = {};
      for (const k of keys) if (o[prefix+k] !== undefined) result[k]=o[prefix+k];
      return result;
    },
    async set(items) {const o=read();for(const [k,v] of Object.entries(items)) o[prefix+k]=v;write(o)},
    async remove(keys) {const o=read();for(const k of (Array.isArray(keys)?keys:[keys])) delete o[prefix+k];write(o)}
  });
  const fake = {
    runtime:{getManifest:()=>({version:'1.3.0'})},
    identity: {
      getRedirectURL: () => 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/',
      async launchWebAuthFlow({url}) {
        const u=new URL(url);const p=u.searchParams;
        return p.get('redirect_uri')+'#access_token=MOCKTOKEN&expires_in=3600&state='+p.get('state')+'&authuser=0';
      }
    },
    storage:{local:store('local:'),session:store('session:')}
  };
  Object.assign(window.chrome || (window.chrome = {}), fake);
  window.fetch = async url => {
    window.__calls.push(url);
    if(String(url).startsWith('https://api.github.com/')) {
      return {ok:true,status:200,json:async()=>({tag_name:'v1.3.2',draft:false,prerelease:false})};
    }
    if(window.__mockDenySheet) {
      return {ok:false,status:403,json:async()=>({error:{message:'mock denied'}})};
    }
    if(String(url).startsWith('https://sheets.googleapis.com/')) {
      const project=[['Project','Status','Next','Updated'],['Test Project','Working','Write tests','2026-10-22 17:17 KST'],['Second Project','Blocked','Get hardware','2026-10-21 09:00 KST']];
      const history=[['Timestamp','Project'],['2026-10-22 17:17 KST','Test Project'],['Test Project','shifted malformed status'],['2026-10-21 14 KST','Second Project']];
      return {ok:true,status:200,json:async()=>({values:decodeURIComponent(url).includes('History')?history:project})};
    }
    throw new Error('Unexpected network call '+url);
  };
})();
'''

async def load_app(page, legacy_config=None):
    html=(ROOT/'extension'/'newtab.html').read_text()
    html=re.sub(r'<script src="[^"]+"></script>', '', html)
    await page.set_content(html)
    await page.add_style_tag(content=(ROOT/'extension'/'newtab.css').read_text())
    await page.evaluate(MOCK_CHROME)
    if legacy_config:
        await page.add_script_tag(content=legacy_config)
    else:
        await page.add_script_tag(content=(ROOT/'extension'/'config.js').read_text())
    for name in ('pulse-core.js','newtab.js'):
        await page.add_script_tag(content=(ROOT/'extension'/name).read_text())


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path='/usr/bin/chromium', headless=True,args=['--no-sandbox'])
        context = await browser.new_context(viewport={'width':1250,'height':900})
        page = await context.new_page()
        errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        await load_app(page)
        await page.wait_for_timeout(500)
        assert await page.locator('#settingsPanel').is_visible(), 'initial settings should open'
        assert await page.title() == 'Project Dashboard', 'public application branding changed'
        assert 'PROJECT DASHBOARD' in await page.locator('.eyebrow').inner_text()
        assert await page.locator('#releaseRepoInput').input_value() == 'kurichon/project_dashboard'
        assert 'Setup required' in await page.locator('#syncState').inner_text()
        assert await page.locator('#spreadsheetInput').input_value() == ''
        await page.locator('#spreadsheetInput').fill('https://docs.google.com/spreadsheets/d/1PULSE_TEST_SHEET_ID_ONLY_EXAMPLE_2026_00/edit')
        await page.locator('#oauthClientInput').fill('123-abc.apps.googleusercontent.com')
        await page.locator('#releaseRepoInput').fill('example/pulse')
        await page.locator('#saveSettingsBtn').click()
        assert 'Settings saved' in await page.locator('#notice').inner_text()
        assert await page.locator('#connectBtn').is_visible()
        await page.locator('#connectBtn').click()
        await page.wait_for_timeout(500)
        assert await page.locator('.card').count()==2, await page.locator('#notice').inner_text()
        assert '1 invalid History row' in await page.locator('#notice').inner_text()
        assert 'Test Project' in await page.locator('.card').first.inner_text()
        assert 'Write tests' in await page.locator('.card').first.inner_text()
        await page.screenshot(path=str(ROOT/'tests'/'ui-success-preview.png'),full_page=True)
        await page.locator('#updateBtn').click()
        await page.wait_for_timeout(300)
        assert 'v1.3.2' in await page.locator('#updateText').inner_text(),await page.locator('#updateText').inner_text()
        assert await page.locator('#updateLink').get_attribute('href') == 'https://github.com/example/pulse/releases/latest'
        # Update-only configuration changes must not wipe the current dashboard.
        await page.locator('#settingsBtn').click()
        await page.locator('#releaseRepoInput').fill('example/pulse-v2')
        await page.locator('#saveSettingsBtn').click()
        assert await page.locator('.card').count() == 2, 'release config change wiped active data'
        # Changing the connected Sheet must clear the old project's offline cache.
        await page.locator('#settingsBtn').click()
        await page.locator('#spreadsheetInput').fill('1PULSE_TEST_OTHER_SHEET_ID_EXAMPLE_2026_00')
        await page.locator('#saveSettingsBtn').click()
        assert await page.locator('.card').count() == 0, 'source change displayed stale prior Sheet data'
        assert await page.evaluate("chrome.storage.local.get('projectPulseCacheV2').then(o => !o.projectPulseCacheV2)"), 'source change left old cache'
        await page.locator('#connectBtn').click()
        await page.wait_for_timeout(300)
        assert await page.locator('.card').count()==2, 'new source failed mock connect'
        # Switch Google accounts: must never show the previous account's cached rows if new account cannot read the Sheet.
        await page.evaluate('window.__mockDenySheet=true')
        await page.locator('#accountBtn').click()
        await page.wait_for_timeout(400)
        assert await page.locator('.card').count()==0, 'cached data survived account change'
        assert 'denied' in (await page.locator('#notice').inner_text()).lower()
        await page.screenshot(path=str(ROOT/'tests'/'ui-preview.png'),full_page=True)
        assert not errors, errors
        # Persistence: source ID stays in local storage across tab reloads.
        # Read browser-persistent settings without invoking a real navigation.
        assert await page.evaluate("chrome.storage.local.get('projectPulseSettingsV3').then(o=>o.projectPulseSettingsV3.spreadsheetId)") == '1PULSE_TEST_OTHER_SHEET_ID_EXAMPLE_2026_00'
        await page.locator('#settingsBtn').click()
        assert await page.locator('#spreadsheetInput').input_value() == '1PULSE_TEST_OTHER_SHEET_ID_EXAMPLE_2026_00'
        assert await page.locator('#releaseRepoInput').input_value() == 'example/pulse-v2'
        migration_page = await context.new_page()
        await load_app(migration_page, legacy_config="const PROJECT_PULSE_CONFIG={spreadsheetId:'1PULSE_LEGACY_EXAMPLE_SPREADSHEET_ID_2000',oauthClientId:'321-legacy.apps.googleusercontent.com'};")
        await migration_page.wait_for_timeout(350)
        legacy_settings = await migration_page.evaluate("chrome.storage.local.get('projectPulseSettingsV3').then(o=>o.projectPulseSettingsV3)")
        assert legacy_settings['spreadsheetId'] == '1PULSE_LEGACY_EXAMPLE_SPREADSHEET_ID_2000', legacy_settings
        assert legacy_settings['oauthClientId'] == '321-legacy.apps.googleusercontent.com', legacy_settings
        assert await migration_page.locator('.card').count() == 2, 'legacy migrated source not usable with mock OAuth'
        print('PASS simulated browser smoke: onboarding, source/tab selection, malformed history, cards, release checks, account/cache isolation, settings persistence, legacy migration')
        await browser.close()

if __name__=='__main__':
    asyncio.run(main())