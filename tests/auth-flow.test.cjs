/* Exercises shipped event handlers with simulated browser/Google boundaries.
 * No real Google credentials, browser profile, or network calls are used.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const root = process.env.PDASH_TEST_ROOT || path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const SETTINGS = 'projectPulseSettingsV3';
const SESSION = 'projectPulseAuthSessionV2';
const PREFS = 'projectPulseAuthPrefsV2';
const CACHE = 'projectPulseCacheV2';
const settings = {
  spreadsheetId: '1AUTH_TEST_SYNTHETIC_SHEET_ONLY_000000',
  projectsTab: 'Projects', historyTab: 'History',
  oauthClientId: '12345-example.apps.googleusercontent.com', releaseRepo: ''
};
const clone = x => JSON.parse(JSON.stringify(x));
const fresh = token => ({token, expiresAt: Date.now() + 3600000});

async function app({token, prefs, cache, sheetStatus = 200, oauthError = ''} = {}) {
  const local = {[SETTINGS]: clone(settings)};
  const session = {};
  if (token) session[SESSION] = fresh(token);
  if (prefs) local[PREFS] = clone(prefs);
  if (cache) local[CACHE] = clone(cache);
  const calls = {oauth: [], sheets: []};
  const mode = {sheetStatus, oauthError, returnedError: '', returnedState: '', correctToken: 'CHOSEN_ACCOUNT'};
  const elements = new Map();
  function element() {
    return {
      hidden: true, disabled: false, textContent: '', className: '', value: '', children: [], attrs: {}, handlers: {},
      setAttribute(k,v){ this.attrs[k] = v; }, removeAttribute(k){ delete this.attrs[k]; },
      replaceChildren(...children){ this.children = children; }, append(...children){ this.children.push(...children); },
      focus(){}, remove(){},
      addEventListener(name, fn){ this.handlers[name] = fn; },
      async click(){ if (this.disabled) return; return this.handlers.click?.({preventDefault(){}}); }
    };
  }
  const document = {
    querySelector(selector){ if (!elements.has(selector)) elements.set(selector, element()); return elements.get(selector); },
    createElement: element, createDocumentFragment: element, body: element()
  };
  const storage = target => ({
    async get(keys){ const out={}; for (const key of Array.isArray(keys)?keys:[keys]) if (key in target) out[key]=clone(target[key]); return out; },
    async set(values){ Object.assign(target, clone(values)); },
    async remove(keys){ for(const key of Array.isArray(keys)?keys:[keys]) delete target[key]; }
  });
  const chrome = {
    runtime: {getManifest: () => JSON.parse(read('extension/manifest.json'))},
    storage: {local: storage(local), session: storage(session)},
    identity: {
      getRedirectURL: () => 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/',
      async launchWebAuthFlow(options) {
        calls.oauth.push(clone(options));
        if (mode.oauthError) throw new Error(mode.oauthError);
        const p = new URL(options.url).searchParams;
        const returned = new URLSearchParams({state: mode.returnedState || p.get('state')});
        if (mode.returnedError) returned.set('error', mode.returnedError);
        else { returned.set('access_token', mode.correctToken); returned.set('expires_in','3600'); returned.set('authuser','1'); }
        return p.get('redirect_uri') + '#' + returned.toString();
      }
    }
  };
  const fetch = async (url, options) => {
    assert.ok(String(url).startsWith('https://sheets.googleapis.com/'), 'Unexpected network boundary');
    const bearer = options.headers.Authorization;
    calls.sheets.push({url, bearer});
    const status = bearer === 'Bearer WRONG_ACCOUNT' ? 403 : mode.sheetStatus;
    const values = decodeURIComponent(url).includes('History')
      ? [['Timestamp','Project']]
      : [['Project','Status','Next','Updated'],['Synthetic Project','Active','Next step','2026-10-23']];
    return {ok: status === 200, status, async json(){ return status === 200 ? {values} : {error:{message:'Test API failure'}}; }};
  };
  const context = vm.createContext({chrome, document, URL, URLSearchParams, Date, console, crypto:webcrypto, Uint8Array, fetch, setTimeout, Blob});
  context.window = context;
  vm.runInContext(read('extension/config.js'), context);
  vm.runInContext(read('extension/pulse-core.js'), context);
  // Await the real initialization promise, not a guessed timer.
  await vm.runInContext(read('extension/newtab.js'), context);
  return {local, session, calls, mode, context, get: s => document.querySelector(s)};
}

function assertChooser(call) {
  assert.ok(call, 'No OAuth chooser was launched');
  assert.equal(call.interactive, true);
  const p = new URL(call.url).searchParams;
  assert.ok(p.get('prompt').split(' ').includes('select_account'));
  assert.equal(p.has('authuser'), false);
  assert.equal(p.has('login_hint'), false);
  assert.equal(p.get('scope'), 'https://www.googleapis.com/auth/spreadsheets.readonly');
}

test('fresh installation waits for a user choice, never guesses the default Google account', async () => {
  const a = await app();
  assert.equal(a.calls.oauth.length, 0);
  assert.equal(a.calls.sheets.length, 0);
  assert.equal(a.get('#connectBtn').hidden, false);
  assert.equal(a.get('#accountBtn').hidden, false);
  await a.get('#connectBtn').click();
  assertChooser(a.calls.oauth[0]);
  assert.equal(a.get('#syncState').textContent,'Synced');
});

test('403 clears rejected token/account hint and leaves Change account usable', async () => {
  const a = await app({token:'WRONG_ACCOUNT',prefs:{authuser:'0',selectedByUser:true}});
  assert.equal(a.session[SESSION], undefined);
  assert.equal(a.local[PREFS], undefined);
  assert.equal(a.get('#accountBtn').hidden, false);
  assert.equal(a.get('#accountBtn').disabled, false);
  assert.match(a.get('#notice').textContent,/Change account/);
  await a.get('#accountBtn').click();
  assertChooser(a.calls.oauth[0]);
  assert.equal(a.get('#syncState').textContent,'Synced');
  assert.deepEqual(a.local[SETTINGS], settings);
});

test('Connect Google bypasses even an unexpired cached token and removes account hints', async () => {
  const a = await app({token:'CACHED_ACCOUNT',prefs:{authuser:'0'},sheetStatus:503});
  assert.equal(a.get('#connectBtn').hidden,false);
  a.mode.sheetStatus = 200;
  await a.get('#connectBtn').click();
  assertChooser(a.calls.oauth[0]);
  assert.equal(a.calls.sheets.at(-1).bearer,'Bearer CHOSEN_ACCOUNT');
});

test('denied account never recovers cached rows belonging to the previous account', async () => {
  const a = await app({token:'WORKING_ACCOUNT'});
  assert.ok(a.local[CACHE]);
  a.mode.sheetStatus = 403;
  await a.get('#accountBtn').click();
  assert.equal(a.local[CACHE],undefined);
  assert.equal(a.session[SESSION],undefined);
  assert.equal(a.get('#cards').children.length,0);
  assert.equal(a.get('#accountBtn').hidden,false);
  assert.deepEqual(a.local[SETTINGS],settings);
});

test('cancelled chooser keeps settings and allows another explicit attempt', async () => {
  const a = await app({token:'WORKING_ACCOUNT'});
  a.mode.oauthError = 'The user did not approve access.';
  await a.get('#accountBtn').click();
  assert.equal(a.session[SESSION],undefined);
  assert.equal(a.local[CACHE],undefined);
  assert.equal(a.get('#accountBtn').hidden,false);
  assert.equal(a.get('#connectBtn').disabled,false);
  assert.deepEqual(a.local[SETTINGS],settings);
  a.mode.oauthError='';
  await a.get('#connectBtn').click();
  assertChooser(a.calls.oauth.at(-1));
  assert.equal(a.get('#syncState').textContent,'Synced');
});

test('ordinary refresh reuses valid tokens without interrupting the user', async () => {
  const a=await app({token:'WORKING_ACCOUNT'});
  await a.get('#refreshBtn').click();
  assert.equal(a.calls.oauth.length,0);
  assert.equal(a.get('#syncState').textContent,'Synced');
});

test('silent renewal needs a previous explicit account selection and pinned account slot', async () => {
  const legacy=await app({prefs:{authuser:'0'}});
  assert.equal(legacy.calls.oauth.length,0,'legacy automatic selection was trusted');
  const unpinned=await app({prefs:{selectedByUser:true}});
  assert.equal(unpinned.calls.oauth.length,0,'unidentified default account was silently selected');
  const selected=await app({prefs:{authuser:'1',selectedByUser:true}});
  assert.equal(selected.calls.oauth.length,1);
  assert.equal(selected.calls.oauth[0].interactive,false);
  const params=new URL(selected.calls.oauth[0].url).searchParams;
  assert.equal(params.get('prompt'),'none');
  assert.equal(params.get('authuser'),'1');
});

test('OAuth access denial leaves an account chooser path, with no token or cache', async () => {
  const a=await app({token:'WORKING_ACCOUNT'});
  a.mode.returnedError='access_denied';
  await a.get('#accountBtn').click();
  assert.equal(a.session[SESSION],undefined);
  assert.equal(a.local[CACHE],undefined);
  assert.equal(a.get('#accountBtn').hidden,false);
  assert.match(a.get('#notice').textContent,/Change account/);
  a.mode.returnedError='';
  await a.get('#connectBtn').click();
  assert.equal(a.get('#syncState').textContent,'Synced');
});

test('OAuth state mismatch still rejects the response and stores no token', async () => {
  const a=await app({token:'WORKING_ACCOUNT'});
  a.mode.returnedState='NOT_THE_REQUEST_STATE';
  await a.get('#accountBtn').click();
  assert.equal(a.session[SESSION],undefined);
  assert.match(a.get('#notice').textContent,/state verification failed/);
});
