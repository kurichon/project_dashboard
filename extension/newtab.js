'use strict';
const Core = globalThis.PulseCore;
const AUTH_SESSION_KEY = 'projectPulseAuthSessionV2';
const AUTH_PREFS_KEY = 'projectPulseAuthPrefsV2';
const LEGACY_CACHE_KEY = 'projectPulseCacheV1';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const TOKEN_SKEW_MS = 2 * 60 * 1000;
const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const APP_VERSION = chrome.runtime.getManifest().version;

const $ = selector => document.querySelector(selector);
const ui = {
  cards: $('#cards'), empty: $('#empty'), notice: $('#notice'),
  settingsPanel: $('#settingsPanel'), settingsBtn: $('#settingsBtn'), closeSettingsBtn: $('#closeSettingsBtn'),
  settingsForm: $('#settingsForm'), spreadsheetInput: $('#spreadsheetInput'),
  projectsTabInput: $('#projectsTabInput'), historyTabInput: $('#historyTabInput'),
  oauthClientInput: $('#oauthClientInput'), releaseRepoInput: $('#releaseRepoInput'),
  redirectUrl: $('#redirectUrl'), settingsMessage: $('#settingsMessage'), saveSettingsBtn: $('#saveSettingsBtn'),
  connectBtn: $('#connectBtn'), accountBtn: $('#accountBtn'), refreshBtn: $('#refreshBtn'),
  syncState: $('#syncState'), lastSync: $('#lastSync'), updateBtn: $('#updateBtn'),
  updateNotice: $('#updateNotice'), updateText: $('#updateText'), updateLink: $('#updateLink')
};
let settings = Core.normalizeSettings(Core.DEFAULTS);
let busy = false;
let checkingUpdates = false;

function setNotice(text = '', error = false) {
  ui.notice.textContent = text;
  ui.notice.className = `notice${error ? ' error' : ''}`;
  ui.notice.hidden = !text;
}
function setSettingsMessage(text = '', error = false) {
  ui.settingsMessage.textContent = text;
  ui.settingsMessage.className = `settings-message${error ? ' error' : ''}`;
}
function updateMessage(text = '', url = '') {
  ui.updateText.textContent = text;
  ui.updateNotice.hidden = !text;
  ui.updateLink.hidden = !url;
  if (url) ui.updateLink.href = url;
  else ui.updateLink.removeAttribute('href');
}
function setBusy(isBusy) {
  busy = isBusy;
  for (const button of [ui.connectBtn, ui.accountBtn, ui.refreshBtn, ui.saveSettingsBtn]) button.disabled = isBusy;
  if (isBusy) ui.syncState.textContent = 'Syncing…';
}
function canConnect() { return Boolean(settings.spreadsheetId && settings.oauthClientId); }
function setControls(connected) {
  const ready = canConnect();
  ui.connectBtn.hidden = !ready || connected;
  ui.accountBtn.hidden = !ready || !connected;
  ui.refreshBtn.hidden = !ready;
}
function showSettings(open) {
  ui.settingsPanel.hidden = !open;
  ui.settingsBtn.setAttribute('aria-expanded', String(open));
  if (open) {
    ui.spreadsheetInput.value = settings.spreadsheetId;
    ui.projectsTabInput.value = settings.projectsTab;
    ui.historyTabInput.value = settings.historyTab;
    ui.oauthClientInput.value = settings.oauthClientId;
    ui.releaseRepoInput.value = settings.releaseRepo;
    setSettingsMessage('');
    ui.spreadsheetInput.focus();
  } else {
    ui.settingsBtn.focus();
  }
}
function randomState() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return [...bytes].map(v => v.toString(16).padStart(2, '0')).join('');
}
async function clearToken() { await chrome.storage.session.remove(AUTH_SESSION_KEY); }
async function changeAccount() {
  await Promise.all([
    chrome.storage.session.remove(AUTH_SESSION_KEY),
    chrome.storage.local.remove([AUTH_PREFS_KEY, Core.CACHE_KEY, LEGACY_CACHE_KEY])
  ]);
  ui.cards.replaceChildren();
  ui.lastSync.textContent = '';
  ui.syncState.textContent = 'Not connected';
}
async function storedToken() {
  const data = await chrome.storage.session.get(AUTH_SESSION_KEY);
  const value = data[AUTH_SESSION_KEY];
  if (!value?.token || !Number.isFinite(value.expiresAt)) return null;
  if (Date.now() + TOKEN_SKEW_MS >= value.expiresAt) {
    await clearToken(); return null;
  }
  return value.token;
}
function parseOAuthResponse(finalUrl, expectedState) {
  if (!finalUrl) throw new Error('Google authorization returned no redirect URL.');
  const url = new URL(finalUrl);
  const redirect = new URL(chrome.identity.getRedirectURL());
  if (url.origin !== redirect.origin || url.pathname !== redirect.pathname) throw new Error('Unexpected OAuth redirect.');
  const params = new URLSearchParams(url.hash.replace(/^#/, ''));
  const state = params.get('state') || url.searchParams.get('state');
  if (!state || state !== expectedState) throw new Error('OAuth state verification failed.');
  const error = params.get('error') || url.searchParams.get('error');
  if (error) throw new Error(`Google authorization failed: ${error}.`);
  const token = params.get('access_token') || url.searchParams.get('access_token');
  if (!token) throw new Error('Google did not return an access token.');
  const expiresIn = Number(params.get('expires_in') || url.searchParams.get('expires_in') || 3600);
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) throw new Error('Google provided an invalid session lifetime.');
  const authuser = params.get('authuser') || url.searchParams.get('authuser');
  return {token, expiresIn, authuser};
}
async function launchGoogleOAuth(interactive) {
  if (!canConnect()) throw new Error('Configure your Sheet and Google OAuth Client ID in Settings first.');
  const state = randomState();
  const params = new URLSearchParams({
    client_id: settings.oauthClientId,
    response_type: 'token',
    redirect_uri: chrome.identity.getRedirectURL(),
    scope: SCOPE,
    state,
    prompt: interactive ? 'select_account consent' : 'none'
  });
  if (!interactive) {
    const data = await chrome.storage.local.get(AUTH_PREFS_KEY);
    const authuser = data[AUTH_PREFS_KEY]?.authuser;
    if (authuser !== undefined && authuser !== null && authuser !== '') params.set('authuser', String(authuser));
  }
  const finalUrl = await chrome.identity.launchWebAuthFlow({
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    interactive
  });
  const result = parseOAuthResponse(finalUrl, state);
  const expiresAt = Date.now() + Math.max(60, result.expiresIn) * 1000;
  await chrome.storage.session.set({[AUTH_SESSION_KEY]: {token: result.token, expiresAt}});
  if (result.authuser !== null) await chrome.storage.local.set({[AUTH_PREFS_KEY]: {authuser: result.authuser}});
  return result.token;
}
async function getAccessToken(interactive) { return await storedToken() || await launchGoogleOAuth(interactive); }

async function fetchRange(token, tab, columns, maxRows) {
  const range = `${Core.quoteTab(tab)}!A1:${columns}${maxRows}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${settings.spreadsheetId}/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`;
  const response = await fetch(url, {headers: {Authorization: `Bearer ${token}`}, cache: 'no-store'});
  if (response.status === 401) {
    await clearToken(); throw new Error('Google session expired. Select Connect Google to sign in.');
  }
  if (response.status === 403) {
    throw new Error('Google denied read access. Check your selected account, the Sheet sharing settings, and Sheets API access.');
  }
  if (!response.ok) {
    let detail = '';
    try { detail = String((await response.json())?.error?.message || ''); } catch (_) {}
    throw new Error(detail || `Google Sheets returned HTTP ${response.status}.`);
  }
  const body = await response.json();
  return body.values || [];
}
function ageText(date) {
  if (!date || Number.isNaN(date.getTime())) return 'Not updated';
  const min = Math.floor(Math.max(0, Date.now()-date.getTime())/60000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min}m ago`;
  const hour = Math.floor(min/60);
  if (hour < 24) return `${hour}h ago`;
  const days = Math.floor(hour/24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, {month:'short',day:'numeric'});
}
function appendText(parent, className, value, title = '') {
  const node = document.createElement('div');
  node.className = className;
  node.textContent = String(value || '—');
  if (title) node.title = title;
  parent.append(node);
  return node;
}
function render(projects, history, fetchedAt, cached) {
  const {counts, rejected} = Core.historyCounts(history);
  const normalized = projects.map(p => {
    const project = String(p.project || p.name || '').trim();
    return {project, status: String(p.status || '').trim(), next: String(p.next || p['next action'] || '').trim(), updated: Core.parseSheetDate(p.updated || p.timestamp), count: counts.get(project) || 0};
  }).filter(p => p.project);
  normalized.sort((a,b) => (b.updated?.getTime() || 0) - (a.updated?.getTime() || 0));
  const fragment = document.createDocumentFragment();
  for (const p of normalized) {
    const card = document.createElement('article'); card.className = 'card';
    const head = document.createElement('div'); head.className = 'card-head';
    appendText(head, 'project', p.project, p.project);
    appendText(head, 'age', ageText(p.updated));
    card.append(head);
    for (const [label,value] of [['Status',p.status], ['Next',p.next]]) {
      const row = document.createElement('div'); row.className = 'line';
      appendText(row, 'label', label);
      appendText(row, 'value', value);
      card.append(row);
    }
    const meta = document.createElement('div'); meta.className = 'meta';
    appendText(meta, '', `${p.count} update${p.count === 1 ? '' : 's'} / 7d`);
    card.append(meta); fragment.append(card);
  }
  ui.cards.replaceChildren(fragment);
  ui.empty.hidden = normalized.length > 0;
  ui.syncState.textContent = cached ? 'Cached snapshot' : 'Synced';
  ui.lastSync.textContent = fetchedAt ? `${cached ? 'Cached' : 'Synced'} ${ageText(new Date(fetchedAt))}` : '';
  setControls(!cached);
  return rejected;
}
async function loadCache() {
  const data = await chrome.storage.local.get(Core.CACHE_KEY);
  const cache = data[Core.CACHE_KEY];
  if (!cache || cache.identity !== Core.sourceIdentity(settings) || !Array.isArray(cache.projects) || !Array.isArray(cache.history)) return false;
  render(cache.projects, cache.history, cache.fetchedAt, true);
  return true;
}
async function sync(interactive = false) {
  if (busy || !canConnect()) return;
  setBusy(true);
  const source = Core.sourceIdentity(settings);
  if (interactive) setNotice('Choose the Google account that can read your selected Sheet.');
  try {
    const token = await getAccessToken(interactive);
    const projectsRows = await fetchRange(token, settings.projectsTab, 'D', 2000);
    Core.headerCheck(projectsRows, ['project', 'status', 'next', 'updated']);
    let historyRows = [];
    let historyError = '';
    if (settings.historyTab) {
      try {
        historyRows = await fetchRange(token, settings.historyTab, 'B', 5000);
        Core.headerCheck(historyRows, ['timestamp', 'project']);
      } catch (e) {
        historyError = `History unavailable: ${e.message}`;
      }
    }
    if (Core.sourceIdentity(settings) !== source) return;
    const projects = Core.rowsToObjects(projectsRows);
    const history = Core.rowsToObjects(historyRows);
    if (historyRows.length >= 5000) historyError += `${historyError ? ' ' : ''}History exceeds the 5,000-row read limit; counts may be incomplete.`;
    const payload = {identity: source, projects, history, fetchedAt: new Date().toISOString()};
    await chrome.storage.local.set({[Core.CACHE_KEY]:payload});
    const rejected = render(projects, history, payload.fetchedAt, false);
    let warning = historyError;
    if (rejected) warning += `${warning ? ' ' : ''}${rejected} invalid History row${rejected===1?'':'s'} excluded from update counts.`;
    setNotice(warning);
  } catch (err) {
    const hadCache = await loadCache();
    if (!hadCache) { ui.cards.replaceChildren(); ui.empty.hidden = true; ui.syncState.textContent = 'Not connected'; }
    setControls(false);
    setNotice(`${err?.message || 'Could not read your Google Sheet.'}${hadCache ? ' Showing the last saved snapshot.' : ''}`, true);
  } finally { setBusy(false); }
}

async function checkUpdates(manual = false) {
  if (checkingUpdates) return;
  if (!settings.releaseRepo) {
    if (manual) { updateMessage('Set a public GitHub release repository in Settings first.'); showSettings(true); }
    return;
  }
  const repo = settings.releaseRepo;
  const local = await chrome.storage.local.get(Core.UPDATE_KEY);
  const previous = local[Core.UPDATE_KEY];
  if (!manual && previous?.repo === repo && Date.now()-previous.checkedAt < UPDATE_INTERVAL_MS) {
    if (previous.tag && Core.compareVersions(previous.tag, APP_VERSION) > 0) {
      updateMessage(`Project Dashboard ${previous.tag} is available (installed: ${APP_VERSION}).`, Core.releasePageUrl(repo));
    }
    return;
  }
  checkingUpdates = true;
  ui.updateBtn.disabled = true;
  ui.updateBtn.textContent = 'Checking…';
  try {
    const response = await fetch(Core.releaseApiUrl(repo), {cache: 'no-store', headers: {Accept: 'application/vnd.github+json'}});
    if (!response.ok) throw new Error(response.status === 404 ? 'No published release found, or repository is private.' : `GitHub release check failed (HTTP ${response.status}).`);
    const data = await response.json();
    if (repo !== settings.releaseRepo) return;
    if (data.draft || data.prerelease || !data.tag_name) throw new Error('No stable release version is available.');
    const diff = Core.compareVersions(data.tag_name, APP_VERSION);
    if (diff === null) throw new Error('Latest release tag is not in v1.2.3 version format.');
    await chrome.storage.local.set({[Core.UPDATE_KEY]: {repo, checkedAt:Date.now(), tag:data.tag_name}});
    if (diff > 0) {
      updateMessage(`Project Dashboard ${data.tag_name} is available (installed: ${APP_VERSION}).`, Core.releasePageUrl(repo));
    } else if (manual) {
      updateMessage(`You're up to date (v${APP_VERSION}).`);
    } else { updateMessage(''); }
  } catch (e) {
    if (manual) updateMessage(e?.message || 'Could not check releases.');
  } finally {
    checkingUpdates = false;
    ui.updateBtn.disabled = false;
    ui.updateBtn.textContent = 'Check updates';
  }
}

async function loadSettings() {
  const data = await chrome.storage.local.get(Core.SETTINGS_KEY);
  if (data[Core.SETTINGS_KEY]) return Core.validateSettings(data[Core.SETTINGS_KEY]);
  // One-way migration: personal values in the old config.js are copied to
  // chrome.storage.local, not the distributable codebase.
  const legacy = typeof PROJECT_PULSE_CONFIG === 'object' ? PROJECT_PULSE_CONFIG : {};
  const migrated = Core.validateSettings({
    ...Core.DEFAULTS,
    spreadsheetId: legacy.spreadsheetId || '',
    oauthClientId: legacy.oauthClientId || ''
  });
  await chrome.storage.local.set({[Core.SETTINGS_KEY]: migrated});
  return migrated;
}

ui.settingsBtn.addEventListener('click', () => showSettings(ui.settingsPanel.hidden));
ui.closeSettingsBtn.addEventListener('click', () => showSettings(false));
ui.settingsForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  try {
    const updated = Core.validateSettings({
      spreadsheetId: ui.spreadsheetInput.value,
      projectsTab: ui.projectsTabInput.value,
      historyTab: ui.historyTabInput.value,
      oauthClientId: ui.oauthClientInput.value,
      releaseRepo: ui.releaseRepoInput.value
    });
    const sourceChanged = Core.sourceIdentity(settings) !== Core.sourceIdentity(updated);
    const authChanged = settings.oauthClientId !== updated.oauthClientId;
    const repoChanged = settings.releaseRepo !== updated.releaseRepo;
    await chrome.storage.local.set({[Core.SETTINGS_KEY]:updated});
    if (sourceChanged || authChanged) await chrome.storage.local.remove([Core.CACHE_KEY,LEGACY_CACHE_KEY]);
    if (sourceChanged || authChanged) await clearToken();
    if (authChanged) await chrome.storage.local.remove(AUTH_PREFS_KEY);
    if (repoChanged) await chrome.storage.local.remove(Core.UPDATE_KEY);
    settings = updated;
    setSettingsMessage('Settings saved locally.');
    if (sourceChanged || authChanged) {
      ui.cards.replaceChildren(); ui.empty.hidden = true;
      ui.lastSync.textContent = '';
      setControls(false);
    }
    if (repoChanged) updateMessage('');
    if (!canConnect()) {
      setNotice('Enter a Sheet URL or ID and an OAuth Client ID to connect.');
      ui.syncState.textContent = 'Setup required';
    } else if (sourceChanged || authChanged) {
      setNotice('Settings saved. Connect Google to verify access to the selected Sheet.');
      ui.syncState.textContent = 'Ready to connect';
    } else {
      setNotice('Settings saved.');
    }
    showSettings(false);
  } catch (e) { setSettingsMessage(e.message || 'Could not save settings.', true); }
});
ui.connectBtn.addEventListener('click', () => sync(true));
ui.accountBtn.addEventListener('click', async () => {
  if (busy) return;
  await changeAccount();
  setControls(false);
  await sync(true);
});
ui.refreshBtn.addEventListener('click', () => sync(false));
ui.updateBtn.addEventListener('click', () => checkUpdates(true));

(async function init() {
  try {
    ui.redirectUrl.textContent = chrome.identity.getRedirectURL();
    settings = await loadSettings();
    setControls(false);
    const hadCache = await loadCache();
    if (!canConnect()) {
      ui.syncState.textContent = 'Setup required';
      setNotice('Open Settings to connect your Google Spreadsheet.');
      showSettings(true);
    } else {
      if (hadCache) ui.syncState.textContent = 'Cached snapshot';
      await sync(false);
    }
    await checkUpdates(false);
  } catch (e) {
    ui.syncState.textContent = 'Setup error';
    setNotice(e?.message || 'Could not initialize Project Dashboard. Please check browser extension storage.', true);
    showSettings(true);
  }
})();