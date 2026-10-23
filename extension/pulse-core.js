/* Project Dashboard: pure source/schema utilities. The legacy storage keys are intentionally preserved. */
(function (root) {
  'use strict';

  const SETTINGS_KEY = 'projectPulseSettingsV3';
  const CACHE_KEY = 'projectPulseCacheV2';
  const UPDATE_KEY = 'projectPulseReleaseCheckV1';
  const SETTINGS_BACKUP_FORMAT = 'project-dashboard-settings';
  const SETTINGS_BACKUP_VERSION = 1;
  const DEFAULTS = Object.freeze({
    spreadsheetId: '',
    projectsTab: 'Projects',
    historyTab: 'History',
    oauthClientId: '',
    releaseRepo: 'kurichon/project_dashboard'
  });
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  function parseSpreadsheetId(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    if (/^[A-Za-z0-9_-]{20,}$/.test(raw)) return raw;
    try {
      const url = new URL(raw);
      if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com') return '';
      const m = url.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})(?:\/|$)/);
      return m ? m[1] : '';
    } catch (_) {
      return '';
    }
  }

  function parseReleaseRepo(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    let candidate = raw;
    if (/^https?:\/\//i.test(raw)) {
      try {
        const url = new URL(raw);
        if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.search || url.hash) return '';
        candidate = url.pathname.replace(/^\//, '').replace(/\/$/, '').replace(/\.git$/i, '');
      } catch (_) { return ''; }
    }
    const parts = candidate.split('/');
    if (parts.length !== 2 || !parts.every(part => /^[A-Za-z0-9_.-]+$/.test(part))) return '';
    if (parts.some(p => p === '.' || p === '..' || p.length > 100)) return '';
    return parts.join('/');
  }

  function validTab(value) {
    const tab = String(value ?? '').trim();
    return tab.length > 0 && tab.length <= 100 && !/[\[\]:*?\/\\]/.test(tab);
  }

  function quoteTab(tab) {
    if (!validTab(tab)) throw new Error('Enter a valid Google Sheet tab name.');
    return `'${String(tab).trim().replace(/'/g, "''")}'`;
  }

  function normalizeSettings(raw = {}) {
    return {
      spreadsheetId: String(raw.spreadsheetId || '').trim(),
      projectsTab: String(raw.projectsTab ?? DEFAULTS.projectsTab).trim(),
      historyTab: String(raw.historyTab ?? DEFAULTS.historyTab).trim(),
      oauthClientId: String(raw.oauthClientId || '').trim(),
      releaseRepo: String(raw.releaseRepo || '').trim()
    };
  }

  function validateSettings(raw) {
    const input = normalizeSettings(raw);
    const spreadsheetId = parseSpreadsheetId(input.spreadsheetId);
    if (input.spreadsheetId && !spreadsheetId) throw new Error('Paste a valid Google Spreadsheet URL or ID.');
    if (!validTab(input.projectsTab)) throw new Error('Enter a valid Projects tab name.');
    if (input.historyTab && !validTab(input.historyTab)) throw new Error('Enter a valid History tab name, or leave it blank.');
    if (input.oauthClientId && !/^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(input.oauthClientId)) {
      throw new Error('Enter a Google OAuth Web application Client ID ending in .apps.googleusercontent.com.');
    }
    const releaseRepo = parseReleaseRepo(input.releaseRepo);
    if (input.releaseRepo && !releaseRepo) throw new Error('Use a GitHub repository like owner/repo or https://github.com/owner/repo.');
    return { ...input, spreadsheetId, releaseRepo };
  }

  // Explicit, minimal export format. Never export session tokens, account hints or cached Sheet rows.
  function createSettingsBackup(currentSettings) {
    return {format: SETTINGS_BACKUP_FORMAT, version: SETTINGS_BACKUP_VERSION, settings: validateSettings(currentSettings)};
  }

  function parseSettingsBackup(raw) {
    let backup;
    try { backup = typeof raw === 'string' ? JSON.parse(raw) : raw; }
    catch (_) { throw new Error('The selected file is not valid JSON.'); }
    if (!backup || typeof backup !== 'object' || Array.isArray(backup) ||
        backup.format !== SETTINGS_BACKUP_FORMAT || backup.version !== SETTINGS_BACKUP_VERSION ||
        !backup.settings || typeof backup.settings !== 'object' || Array.isArray(backup.settings)) {
      throw new Error('This is not a supported Project Dashboard settings backup.');
    }
    const allowedRoot = new Set(['format','version','settings']);
    const allowedSettings = new Set(['spreadsheetId','projectsTab','historyTab','oauthClientId','releaseRepo']);
    if (Object.keys(backup).some(key => !allowedRoot.has(key)) ||
        Object.keys(backup.settings).some(key => !allowedSettings.has(key))) {
      throw new Error('Settings backup contains unexpected fields.');
    }
    if (Object.keys(backup.settings).length !== allowedSettings.size ||
        [...allowedSettings].some(key => !Object.prototype.hasOwnProperty.call(backup.settings,key))) {
      throw new Error('Settings backup is incomplete.');
    }
    return validateSettings(backup.settings);
  }

  function sourceIdentity(settings) {
    return JSON.stringify([settings.spreadsheetId, settings.projectsTab, settings.historyTab]);
  }

  function rowsToObjects(rows) {
    if (!Array.isArray(rows) || !rows.length) return [];
    const headers = rows[0].map(value => String(value ?? '').trim().toLowerCase());
    return rows.slice(1).filter(row => Array.isArray(row) && row.some(v => String(v ?? '').trim())).map(row => {
      const result = {};
      headers.forEach((header, i) => { if (header) result[header] = row[i] ?? ''; });
      return result;
    });
  }

  function headerCheck(rows, columns) {
    if (!rows.length) throw new Error('Sheet is empty. Add a header row.');
    const headers = rows[0].map(cell => String(cell ?? '').trim().toLowerCase());
    const missing = columns.filter(c => !headers.includes(c.toLowerCase()));
    if (missing.length) throw new Error(`Missing required column(s): ${missing.join(', ')}.`);
  }

  function parseSheetDate(value) {
    if (value === '' || value === undefined || value === null) return null;
    if (typeof value === 'number' && Number.isFinite(value)) {
      const n = new Date(Math.round((value - 25569) * 86400 * 1000));
      return Number.isNaN(n.getTime()) ? null : n;
    }
    const input = String(value).trim();
    const m = input.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2})(?::(\d{2})(?::(\d{2}))?)?(?:\s*(KST|JST|UTC|Z|[+-]\d{2}:?\d{2}))?)?$/i);
    if (!m) {
      const loose = new Date(input);
      return Number.isNaN(loose.getTime()) ? null : loose;
    }
    const [, year, month, day, hour = '00', minute = '00', second = '00', zoneRaw = ''] = m;
    const zone = zoneRaw.toUpperCase();
    const offset = zone === 'KST' || zone === 'JST' ? '+09:00' : zone === 'UTC' || zone === 'Z' ? 'Z' : zone ? (zone.includes(':') ? zone : `${zone.slice(0,3)}:${zone.slice(3)}`) : '';
    const date = offset
      ? new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`)
      : (m[4] ? new Date(+year, +month - 1, +day, +hour, +minute, +second) : new Date(`${year}-${month}-${day}T00:00:00`));
    if (Number.isNaN(date.getTime())) return null;
    // Disallow normalized invalid month/day/time combinations.
    const check = new Date(Date.UTC(+year, +month - 1, +day, +hour, +minute, +second));
    if (check.getUTCFullYear() !== +year || check.getUTCMonth() + 1 !== +month || check.getUTCDate() !== +day || check.getUTCHours() !== +hour || check.getUTCMinutes() !== +minute || check.getUTCSeconds() !== +second) return null;
    return date;
  }

  function historyCounts(items, now = Date.now()) {
    const counts = new Map();
    let rejected = 0;
    for (const item of items) {
      const project = String(item.project || '').trim();
      const date = parseSheetDate(item.timestamp ?? item.updated ?? item.time ?? item.date);
      if (!project || !date) { rejected++; continue; }
      if (date.getTime() < now - SEVEN_DAYS_MS || date.getTime() > now + 60000) continue;
      counts.set(project, (counts.get(project) || 0) + 1);
    }
    return { counts, rejected };
  }

  function compareVersions(a, b) {
    const parse = str => {
      const m = String(str || '').match(/^v?(\d+)\.(\d+)\.(\d+)$/);
      return m ? m.slice(1).map(Number) : null;
    };
    const va = parse(a), vb = parse(b);
    if (!va || !vb || va.some((v,i) => !Number.isSafeInteger(v) || !Number.isSafeInteger(vb[i]))) return null;
    for (let i=0;i<3;i++) { if (va[i]!==vb[i]) return va[i]>vb[i] ? 1 : -1; }
    return 0;
  }

  function releaseApiUrl(repo) {
    const validated = parseReleaseRepo(repo);
    if (!validated) throw new Error('Configure a valid GitHub repository to check for releases.');
    return `https://api.github.com/repos/${validated}/releases/latest`;
  }
  function releasePageUrl(repo) {
    const validated = parseReleaseRepo(repo);
    if (!validated) throw new Error('Configure a valid GitHub repository.');
    return `https://github.com/${validated}/releases/latest`;
  }

  root.PulseCore = Object.freeze({
    SETTINGS_KEY, CACHE_KEY, UPDATE_KEY, DEFAULTS,
    createSettingsBackup, parseSettingsBackup,
    parseSpreadsheetId, parseReleaseRepo, validTab, quoteTab, normalizeSettings, validateSettings,
    sourceIdentity, rowsToObjects, headerCheck, parseSheetDate, historyCounts, compareVersions,
    releaseApiUrl, releasePageUrl
  });
})(globalThis);
