"""Rendered Chromium UI with simulated extension APIs and Google/GitHub responses.
Does not prove live Google sign-in or installed Brave extension behavior.
"""
import asyncio
import json
import os
from pathlib import Path
import re
from playwright.async_api import async_playwright, expect

ROOT = Path(os.environ.get('PDASH_TEST_ROOT', Path(__file__).resolve().parents[1]))
SETTINGS = dict(spreadsheetId='1AUTH_TEST_SYNTHETIC_SHEET_ONLY_000000',
                projectsTab='Projects', historyTab='History',
                oauthClientId='12345-example.apps.googleusercontent.com', releaseRepo='kurichon/project_dashboard')
MOCK = r'''
({settings,version}) => {
  window.__authCalls = [];
  window.__authMode = 'success';
  const local={projectPulseSettingsV3:settings,projectPulseAuthPrefsV2:{authuser:'0',selectedByUser:true}};
  const session={projectPulseAuthSessionV2:{token:'SYNTHETIC_WRONG_ACCOUNT',expiresAt:Date.now()+3600000}};
  const store=target=>({
    async get(keys){const r={};for(const k of Array.isArray(keys)?keys:[keys]) if(k in target)r[k]=structuredClone(target[k]);return r;},
    async set(v){Object.assign(target,structuredClone(v));},
    async remove(keys){for(const k of Array.isArray(keys)?keys:[keys])delete target[k];}
  });
  window.chrome={
    runtime:{getManifest:()=>({version})},
    storage:{local:store(local),session:store(session)},
    identity:{
      getRedirectURL:()=> 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/',
      async launchWebAuthFlow(options){
        window.__authCalls.push(options);
        if(window.__authMode==='cancel')throw new Error('The user did not approve access.');
        const p=new URL(options.url).searchParams;
        const r=new URLSearchParams({state:p.get('state')});
        if(window.__authMode==='deny')r.set('error','access_denied');
        else {r.set('access_token','SYNTHETIC_SELECTED_ACCOUNT');r.set('expires_in','3600');r.set('authuser','1');}
        return p.get('redirect_uri')+'#'+r.toString();
      }
    }
  };
  window.fetch=async(url,options)=>{
    if(String(url).startsWith('https://api.github.com/'))return {ok:false,status:404};
    if(!String(url).startsWith('https://sheets.googleapis.com/'))throw new Error('Unexpected network boundary');
    if(options.headers.Authorization==='Bearer SYNTHETIC_WRONG_ACCOUNT')return {ok:false,status:403};
    if(options.headers.Authorization!=='Bearer SYNTHETIC_SELECTED_ACCOUNT')throw new Error('Unexpected token');
    const values=decodeURIComponent(url).includes('History')?[['Timestamp','Project']]:
      [['Project','Status','Next','Updated'],['Synthetic Project','Connected','Review work','2026-10-23']];
    return {ok:true,status:200,json:async()=>({values})};
  };
}
'''

async def run():
    async with async_playwright() as p:
        kwargs=dict(headless=True,args=['--no-sandbox'])
        if Path('/usr/bin/chromium').exists():kwargs['executable_path']='/usr/bin/chromium'
        browser=await p.chromium.launch(**kwargs)
        page=await browser.new_page(viewport={'width':1280,'height':800})
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        html=re.sub(r'<script src="[^"]+"></script>','',(ROOT/'extension/newtab.html').read_text())
        await page.set_content(html)
        await page.add_style_tag(content=(ROOT/'extension/newtab.css').read_text())
        version=json.loads((ROOT/'extension/manifest.json').read_text())['version']
        await page.evaluate(MOCK,{'settings':SETTINGS,'version':version})
        for src in ('config.js','pulse-core.js','newtab.js'):
            await page.add_script_tag(content=(ROOT/'extension'/src).read_text())
        await expect(page.locator('#notice')).to_contain_text('Google denied read access')
        await expect(page.locator('#accountBtn')).to_be_visible()
        await expect(page.locator('#accountBtn')).to_be_enabled()
        assert not await page.evaluate('chrome.storage.session.get("projectPulseAuthSessionV2")')
        assert not await page.evaluate('chrome.storage.local.get("projectPulseAuthPrefsV2")')
        await page.locator('#accountBtn').click()
        await expect(page.locator('#syncState')).to_have_text('Synced')
        await expect(page.locator('.card')).to_have_count(1)
        from urllib.parse import urlparse,parse_qs
        chosen=await page.evaluate('window.__authCalls[0]')
        assert chosen['interactive'] is True
        q=parse_qs(urlparse(chosen['url']).query)
        assert 'select_account' in q['prompt'][0].split()
        assert 'authuser' not in q and 'login_hint' not in q
        await page.evaluate('window.__authMode="cancel"')
        await page.locator('#accountBtn').click()
        await expect(page.locator('#notice')).to_contain_text('did not complete')
        await expect(page.locator('#accountBtn')).to_be_visible()
        await expect(page.locator('.card')).to_have_count(0)
        assert not await page.evaluate('chrome.storage.local.get("projectPulseCacheV2")')
        assert (await page.evaluate('chrome.storage.local.get("projectPulseSettingsV3")'))['projectPulseSettingsV3']==SETTINGS
        await page.evaluate('window.__authMode="deny"')
        await page.locator('#connectBtn').click()
        await expect(page.locator('#notice')).to_contain_text('Google denied authorization')
        await expect(page.locator('#accountBtn')).to_be_visible()
        await page.evaluate('window.__authMode="success"')
        await page.locator('#connectBtn').click()
        await expect(page.locator('#syncState')).to_have_text('Synced')
        n=await page.evaluate('window.__authCalls.length')
        await page.locator('#refreshBtn').click()
        await expect(page.locator('#syncState')).to_have_text('Synced')
        assert await page.evaluate('window.__authCalls.length')==n
        if os.environ.get('PDASH_SCREENSHOT'):
            await page.screenshot(path=os.environ['PDASH_SCREENSHOT'],full_page=True)
        assert not errors,errors
        await browser.close()
        print('PASS rendered Chromium auth recovery: 403, chooser parameters, cancellation/retry, OAuth denial, settings preservation and normal refresh. Browser APIs/Google simulated.')

if __name__=='__main__':asyncio.run(run())
