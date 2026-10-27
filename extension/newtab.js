'use strict';
const Core = globalThis.PulseCore;
const PD = globalThis.PDRCCore;
const PV = globalThis.PDRCView;
const AUTH_SESSION_KEY = 'projectPulseAuthSessionV2';
const AUTH_PREFS_KEY = 'projectPulseAuthPrefsV2';
const LEGACY_CACHE_KEY = 'projectPulseCacheV1';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const TOKEN_SKEW_MS = 2 * 60 * 1000;
const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const APP_VERSION = chrome.runtime.getManifest().version;

const $ = selector => document.querySelector(selector);
const ui = {
  cards: $('#cards'), empty: $('#empty'), notice: $('#notice'), projectDetails: $('#projectDetails'),
  settingsPanel: $('#settingsPanel'), settingsBtn: $('#settingsBtn'), closeSettingsBtn: $('#closeSettingsBtn'),
  settingsForm: $('#settingsForm'), spreadsheetInput: $('#spreadsheetInput'),
  projectsTabInput: $('#projectsTabInput'), historyTabInput: $('#historyTabInput'),
  oauthClientInput: $('#oauthClientInput'), releaseRepoInput: $('#releaseRepoInput'),
  redirectUrl: $('#redirectUrl'), settingsMessage: $('#settingsMessage'), saveSettingsBtn: $('#saveSettingsBtn'),
  connectBtn: $('#connectBtn'), accountBtn: $('#accountBtn'), refreshBtn: $('#refreshBtn'),
  syncState: $('#syncState'), lastSync: $('#lastSync'), updateBtn: $('#updateBtn'),
  updateNotice: $('#updateNotice'), updateText: $('#updateText'), updateLink: $('#updateLink'),
  exportSettingsBtn: $('#exportSettingsBtn'), importSettingsBtn: $('#importSettingsBtn'),
  importSettingsFile: $('#importSettingsFile'), versionInfo: $('#versionInfo')
};
let settings = Core.normalizeSettings(Core.DEFAULTS);
let busy = false;
let checkingUpdates = false;
ui.versionInfo.textContent = `v${APP_VERSION}`;

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
  for (const button of [ui.connectBtn, ui.accountBtn, ui.refreshBtn, ui.saveSettingsBtn, ui.importSettingsBtn]) button.disabled = isBusy;
  if (isBusy) ui.syncState.textContent = 'Syncing…';
}
function canConnect() { return Boolean(settings.spreadsheetId && settings.oauthClientId); }
function setControls(connected) {
  const ready = canConnect();
  ui.connectBtn.hidden = !ready || connected;
  // Recovery must remain available even after a rejected or cancelled sign-in.
  ui.accountBtn.hidden = !ready;
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
    chrome.storage.local.remove([AUTH_PREFS_KEY, Core.CACHE_KEY, LEGACY_CACHE_KEY, PD?.CACHE_KEY].filter(Boolean))
  ]);
  ui.cards.replaceChildren();
  if (PV) PV.clear(ui.projectDetails);
  ui.empty.hidden = true;
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
  if (error) throw new Error(error === 'access_denied'
    ? 'Google denied authorization for that account. Select Change account to choose an authorized Google account.'
    : `Google authorization failed: ${error}.`);
  const token = params.get('access_token') || url.searchParams.get('access_token');
  if (!token) throw new Error('Google did not return an access token.');
  const expiresIn = Number(params.get('expires_in') || url.searchParams.get('expires_in') || 3600);
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) throw new Error('Google provided an invalid session lifetime.');
  const authuser = params.get('authuser') || url.searchParams.get('authuser');
  return {token, expiresIn, authuser};
}
function accountSelectionRequired(message) {
  const error = new Error(message);
  error.code = 'ACCOUNT_SELECTION_REQUIRED';
  return error;
}
async function launchGoogleOAuth(interactive) {
  if (!canConnect()) throw new Error('Configure your Sheet and Google OAuth Client ID in Settings first.');
  let selectedAccount = null;
  if (!interactive) {
    const data = await chrome.storage.local.get(AUTH_PREFS_KEY);
    const prefs = data[AUTH_PREFS_KEY];
    // A fresh install or legacy automatic session must never guess account 0.
    // Without a previously chosen account slot, renewal requires a user click.
    if (!prefs?.selectedByUser || !/^\d+$/.test(String(prefs.authuser ?? ''))) {
      throw accountSelectionRequired('Select Connect Google or Change account to choose the account that can read your Sheet.');
    }
    selectedAccount = String(prefs.authuser);
  }
  const state = randomState();
  const params = new URLSearchParams({
    client_id: settings.oauthClientId,
    response_type: 'token',
    redirect_uri: chrome.identity.getRedirectURL(),
    scope: SCOPE,
    state,
    prompt: interactive ? 'select_account consent' : 'none'
  });
  // An explicit chooser never carries a hint for the account being replaced.
  if (!interactive) params.set('authuser', selectedAccount);
  let finalUrl;
  try {
    finalUrl = await chrome.identity.launchWebAuthFlow({
      url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      interactive
    });
  } catch (_) {
    if (!interactive) {
      await chrome.storage.local.remove(AUTH_PREFS_KEY);
      throw accountSelectionRequired('Google could not renew the selected account. Select Connect Google or Change account to sign in.');
    }
    throw new Error('Google sign-in did not complete. Select Connect Google or Change account to try again.');
  }
  const result = parseOAuthResponse(finalUrl, state);
  const expiresAt = Date.now() + Math.max(60, result.expiresIn) * 1000;
  await chrome.storage.session.set({[AUTH_SESSION_KEY]: {token: result.token, expiresAt}});
  if (/^\d+$/.test(String(result.authuser ?? ''))) {
    await chrome.storage.local.set({[AUTH_PREFS_KEY]: {authuser: result.authuser, selectedByUser: true}});
  } else {
    await chrome.storage.local.remove(AUTH_PREFS_KEY);
  }
  return result.token;
}
async function getAccessToken(interactive) {
  if (interactive) {
    // Clicking Connect/Change means choose again, not reuse a cached token.
    // Remove prior-account rows before a different account can be selected.
    await changeAccount();
    return launchGoogleOAuth(true);
  }
  return await storedToken() || await launchGoogleOAuth(false);
}

async function fetchRange(token, tab, columns, maxRows) {
  const range = `${Core.quoteTab(tab)}!A1:${columns}${maxRows}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${settings.spreadsheetId}/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`;
  const response = await fetch(url, {headers: {Authorization: `Bearer ${token}`}, cache: 'no-store'});
  if (response.status === 401) {
    await clearToken(); throw new Error('Google session expired. Select Connect Google to sign in.');
  }
  if (response.status === 403) {
    const error = new Error('Google denied read access for this account. Select Change account to choose the correct account. If it is already correct, check Sheet sharing and Sheets API access.');
    error.code = 'ACCOUNT_ACCESS_DENIED';
    throw error;
  }
  if (!response.ok) {
    let detail = '';
    try { detail = String((await response.json())?.error?.message || ''); } catch (_) {}
    throw new Error(detail || `Google Sheets returned HTTP ${response.status}.`);
  }
  const body = await response.json();
  return body.values || [];
}

async function fetchPDRCProject(token, entry) {
  const params = new URLSearchParams({majorDimension: 'ROWS', valueRenderOption: 'UNFORMATTED_VALUE'});
  for (const range of PD.RANGES) params.append('ranges', range);
  const url = 'https://sheets.googleapis.com/v4/spreadsheets/' + entry.sourceId + '/values:batchGet?' + params.toString();
  const response = await fetch(url, {headers: {Authorization: 'Bearer ' + token}, cache: 'no-store'});
  if (response.status === 401) {
    await clearToken();
    throw new Error('Google session expired. Select Connect Google to sign in.');
  }
  if (response.status === 403) throw new Error('This Google account cannot read the linked project Sheet.');
  if (!response.ok) {
    let detail = '';
    try { detail = String((await response.json())?.error?.message || ''); } catch (_) {}
    throw new Error(detail || 'Linked project Sheet returned HTTP ' + response.status + '.');
  }
  return PD.normalizeProject(entry, (await response.json()).valueRanges, Core.parseSheetDate);
}
function renderPDRC(projects, fetchedAt, cached = false) {
  PV.render(ui.cards, ui.projectDetails, projects);
  ui.empty.hidden = projects.length > 0;
  const failed = projects.filter(p => p.error).length;
  ui.syncState.textContent = cached ? 'Cached snapshot' : failed ? 'Partial sync' : 'Synced';
  ui.lastSync.textContent = fetchedAt ? (cached ? 'Cached ' : 'Checked ') + ageText(new Date(fetchedAt)) : '';
  setControls(!cached);
}
async function syncPDRC(token, masterRows, identity) {
  const entries = PD.parseRegistry(masterRows, Core.parseSpreadsheetId);
  const stored = await chrome.storage.local.get(PD.CACHE_KEY);
  const old = stored[PD.CACHE_KEY];
  const prior = new Map((old?.identity === identity && Array.isArray(old?.projects) ? old.projects : [])
    .filter(x => x && typeof x.id === 'string').map(x => [x.id, x]));
  const projects = new Array(entries.length);
  let cursor = 0;
  async function worker() {
    while (cursor < entries.length) {
      const index = cursor++;
      const entry = entries[index];
      let error = entry.error;
      if (!error) {
        try {
          projects[index] = await fetchPDRCProject(token, entry);
          continue;
        } catch (e) {
          error = e?.message || 'Unable to read project source.';
        }
      }
      const last = prior.get(entry.id);
      if (last?.sourceId && last.sourceId === entry.sourceId && !last.error) {
        projects[index] = {...last, name: entry.name, stale: true, error};
      } else {
        projects[index] = {
          id: entry.id, name: entry.name, sourceId: entry.sourceId, status: '', next: '',
          lifecycle: 'unknown', updated: '', count: 0, totalDeliverables: 0,
          deliverables: [], events: [], workStates: {}, error, stale: false
        };
      }
    }
  }
  await Promise.all(Array.from({length: Math.min(3, entries.length)}, () => worker()));
  if (Core.sourceIdentity(settings) !== identity) return;
  // Keep only last successful values for offline fallback; never cache an error
  // as though it were a successful observation or show another source's values.
  const good = projects.map(p => p.error ? prior.get(p.id) : p)
    .filter(p => p && !p.error && entries.some(e => e.id === p.id && e.sourceId === p.sourceId));
  const fetchedAt = new Date().toISOString();
  await chrome.storage.local.set({[PD.CACHE_KEY]: {identity, projects: good, fetchedAt}});
  renderPDRC(projects, fetchedAt);
  const failed = projects.filter(p => p.error).length;
  setNotice(failed ? failed + ' of ' + entries.length + ' project sources could not be read. ' +
    'Any previous matching project snapshot is marked as cached; other projects remain available.' : '');
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
  if (PV) PV.clear(ui.projectDetails);
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
  const data = await chrome.storage.local.get([Core.CACHE_KEY, PD?.CACHE_KEY].filter(Boolean));
  const identity = Core.sourceIdentity(settings);
  const pdrcCache = PD && data[PD.CACHE_KEY];
  if (pdrcCache?.identity === identity && Array.isArray(pdrcCache.projects)) {
    renderPDRC(pdrcCache.projects.map(p => ({...p, stale: true})), pdrcCache.fetchedAt, true);
    return true;
  }
  const cache = data[Core.CACHE_KEY];
  if (!cache || cache.identity !== identity || !Array.isArray(cache.projects) || !Array.isArray(cache.history)) return false;
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
    const projectsRows = await fetchRange(token, settings.projectsTab, 'H', 2000);
    if (PD?.isRegistryRows(projectsRows)) {
      await syncPDRC(token, projectsRows, source);
      return;
    }
    Core.headerCheck(projectsRows, ['project', 'status', 'next', 'updated']);
    let historyRows = [];
    let historyError = '';
    if (settings.historyTab) {
      try {
        historyRows = await fetchRange(token, settings.historyTab, 'B', 5000);
        Core.headerCheck(historyRows, ['timestamp', 'project']);
      } catch (e) {
        if (e.code === 'ACCOUNT_ACCESS_DENIED') throw e;
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
    if (err?.code === 'ACCOUNT_ACCESS_DENIED') await changeAccount();
    const hadCache = await loadCache();
    if (!hadCache) { ui.cards.replaceChildren(); ui.empty.hidden = true; ui.syncState.textContent = 'Not connected'; }
    setControls(false);
    setNotice(`${err?.message || 'Could not read your Google Sheet.'}${hadCache ? ' Showing the last saved snapshot.' : ''}`, err?.code !== 'ACCOUNT_SELECTION_REQUIRED');
  } finally { setBusy(false); }
}

async function checkUpdates(manual = false) {
  if (checkingUpdates) return;
  if (!settings.releaseRepo) {
    if (manual) updateMessage('Set a public GitHub release repository in Settings to check for updates.');
    return;
  }
  const repo = settings.releaseRepo;
  const stored = await chrome.storage.local.get(Core.UPDATE_KEY);
  const previous = stored[Core.UPDATE_KEY];
  if (!manual && previous?.repo === repo && Date.now() - previous.checkedAt < UPDATE_INTERVAL_MS) {
    if (previous.tag && Core.compareVersions(previous.tag, APP_VERSION) > 0) {
      updateMessage(`Project Dashboard ${previous.tag} is available (installed: v${APP_VERSION}). Get the release ZIP and run its updater; do not uninstall the extension.`, Core.releasePageUrl(repo));
    }
    return;
  }
  checkingUpdates = true;
  ui.updateBtn.disabled = true;
  ui.updateBtn.textContent = 'Checking…';
  try {
    const response = await fetch(Core.releaseApiUrl(repo), {cache: 'no-store', headers: {Accept: 'application/vnd.github+json'}});
    if (response.status === 404) {
      if (manual) updateMessage('There are no published stable GitHub releases yet. Your installed extension is unchanged.');
      return;
    }
    if (!response.ok) throw new Error(`GitHub release check failed (HTTP ${response.status}).`);
    const data = await response.json();
    if (repo !== settings.releaseRepo) return;
    if (data.draft || data.prerelease || !data.tag_name) throw new Error('No stable GitHub release is available.');
    const diff = Core.compareVersions(data.tag_name, APP_VERSION);
    if (diff === null) throw new Error('The latest GitHub release tag is not in v1.2.3 format.');
    await chrome.storage.local.set({[Core.UPDATE_KEY]: {repo, checkedAt: Date.now(), tag: data.tag_name}});
    if (diff > 0) {
      updateMessage(`Project Dashboard ${data.tag_name} is available (installed: v${APP_VERSION}). Download the release ZIP and use the included updater to preserve your extension and settings.`, Core.releasePageUrl(repo));
    } else if (manual) {
      updateMessage(`You're up to date (v${APP_VERSION}).`);
    } else {
      updateMessage('');
    }
  } catch (e) {
    if (manual) updateMessage(e?.message || 'Could not check GitHub releases. The installed version was not changed.');
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

async function applySettings(updated, fromImport = false) {
  const sourceChanged = Core.sourceIdentity(settings) !== Core.sourceIdentity(updated);
  const authChanged = settings.oauthClientId !== updated.oauthClientId;
  const repoChanged = settings.releaseRepo !== updated.releaseRepo;
  // Do not destroy the previous configuration until the replacement passed validation.
  await chrome.storage.local.set({[Core.SETTINGS_KEY]: updated});
  if (sourceChanged || authChanged || fromImport) {
    await chrome.storage.local.remove([Core.CACHE_KEY, LEGACY_CACHE_KEY, AUTH_PREFS_KEY, PD?.CACHE_KEY].filter(Boolean));
    await clearToken();
  }
  if (repoChanged) await chrome.storage.local.remove(Core.UPDATE_KEY);
  settings = updated;
  if (sourceChanged || authChanged || fromImport) {
    ui.cards.replaceChildren();
    if (PV) PV.clear(ui.projectDetails);
    ui.empty.hidden = true;
    ui.lastSync.textContent = '';
    setControls(false);
  }
  if (repoChanged) updateMessage('');
  if (!canConnect()) {
    setNotice('Enter a Sheet URL or ID and an OAuth Client ID to connect.');
    ui.syncState.textContent = 'Setup required';
  } else if (sourceChanged || authChanged || fromImport) {
    setNotice('Settings saved. Select Connect Google to confirm access to this Sheet.');
    ui.syncState.textContent = 'Ready to connect';
  } else {
    setNotice('Settings saved.');
  }
  showSettings(false);
}

function downloadSettings() {
  const backup = Core.createSettingsBackup(settings);
  const blob = new Blob([`${JSON.stringify(backup, null, 2)}\n`], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'project-dashboard-settings.json';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setSettingsMessage('Settings downloaded. Store the file privately. Authentication tokens and project rows were not exported.');
}

async function importSettingsFile() {
  if (busy) { ui.importSettingsFile.value = ''; return; }
  const file = ui.importSettingsFile.files?.[0];
  if (!file) return;
  try {
    if (file.size > 64 * 1024) throw new Error('Settings backup must be smaller than 64 KB.');
    const candidate = Core.parseSettingsBackup(await file.text());
    if (!window.confirm('Replace local Project Dashboard settings from this backup?\nYou will need to connect Google again. The current cache and sign-in session will be cleared.')) return;
    await applySettings(candidate, true);
    setNotice('Settings imported. Connect Google to restore access to your selected Sheet.');
  } catch (e) {
    showSettings(true);
    setSettingsMessage(e?.message || 'Could not import settings.', true);
  } finally {
    ui.importSettingsFile.value = '';
  }
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
    await applySettings(updated);
  } catch (e) { setSettingsMessage(e.message || 'Could not save settings.', true); }
});
ui.exportSettingsBtn.addEventListener('click', () => {
  try { downloadSettings(); }
  catch (e) { setSettingsMessage(e?.message || 'Could not export settings.', true); }
});
ui.importSettingsBtn.addEventListener('click', () => ui.importSettingsFile.click());
ui.importSettingsFile.addEventListener('change', importSettingsFile);
ui.connectBtn.addEventListener('click', () => sync(true));
ui.accountBtn.addEventListener('click', () => sync(true));
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
