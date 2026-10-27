/* PDRC v1: read-only normalized project reporting. No source writes or guessed verification. */
(function (root) {
  'use strict';
  const CACHE_KEY = 'projectDashboardPDRCCacheV1';
  const CONTRACT_VERSION = '1.0';
  const RANGES = Object.freeze([
    "'Overview'!A1:I10",
    "'Deliverables'!A1:Q1000",
    "'History'!A1:J3000",
    "'Evidence'!A1:F1000",
    "'Source'!A1:H10"
  ]);
  const MAX_PROJECTS = 100;
  const RECENT_MS = 7 * 86400000;

  function string(value) { return String(value ?? '').trim(); }
  function getRows(rows, required, tab) {
    if (!Array.isArray(rows) || !rows.length || !Array.isArray(rows[0])) {
      throw new Error(tab + ' has no header row.');
    }
    const headers = rows[0].map(v => string(v).toLowerCase());
    const missing = required.filter(key => !headers.includes(key));
    if (missing.length) throw new Error(tab + ' missing: ' + missing.join(', ') + '.');
    const found = rows.slice(1).filter(row => Array.isArray(row) && row.some(x => string(x)));
    return found.map((row, index) => {
      const item = Object.create(null);
      headers.forEach((header, i) => { if (header) item[header] = row[i] ?? ''; });
      return item;
    });
  }
  function isRegistryRows(rows) {
    if (!Array.isArray(rows) || !Array.isArray(rows[0])) return false;
    const headers = rows[0].map(x => string(x).toLowerCase());
    return ['project_id','name','source_type','source_ref','contract_version'].every(x => headers.includes(x));
  }
  function parseRegistry(rows, parseSheetId) {
    const raw = getRows(rows, ['project_id','name','source_type','source_ref','contract_version','enabled'], 'Registry');
    if (raw.length > MAX_PROJECTS) throw new Error('Registry exceeds the 100-project safety limit.');
    const seen = new Set();
    const entries = [];
    for (const row of raw) {
      const id = string(row.project_id);
      if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(id)) throw new Error('Registry contains an invalid project ID.');
      if (seen.has(id)) throw new Error('Registry contains duplicate project ID: ' + id);
      seen.add(id);
      const enabled = String(row.enabled).trim().toLowerCase();
      if (['false', '0', 'no'].includes(enabled)) continue;
      if (!['true','1','yes'].includes(enabled)) throw new Error('Registry project ' + id + ' has an invalid Enabled flag.');
      const entry = {
        id, name: string(row.name) || id, sourceType: string(row.source_type).toLowerCase(),
        sourceRef: string(row.source_ref), profile: string(row.profile),
        contractVersion: string(row.contract_version), sourceId: '', error: ''
      };
      if (entry.contractVersion !== CONTRACT_VERSION) entry.error = 'Unsupported reporting contract version.';
      else if (entry.sourceType !== 'google_sheets') entry.error = 'Unsupported read-only source type.';
      else {
        entry.sourceId = parseSheetId(entry.sourceRef);
        if (!entry.sourceId) entry.error = 'Invalid Google Sheet source reference.';
      }
      entries.push(entry);
    }
    return entries;
  }
  function normalizeProject(entry, valueRanges, parseDate, now = Date.now()) {
    if (!Array.isArray(valueRanges) || valueRanges.length !== RANGES.length) {
      throw new Error('Project source did not return all five reporting interfaces.');
    }
    const blocks = valueRanges.map(v => Array.isArray(v?.values) ? v.values : []);
    const overview = getRows(blocks[0], ['project_id','name','status_text','next_action','updated_at'], 'Overview');
    const deliverables = getRows(blocks[1], ['id','kind','title','work_state','verification_state'], 'Deliverables');
    const history = getRows(blocks[2], ['event_id','project_id','occurred_at','event_type'], 'History');
    const evidence = getRows(blocks[3], ['id','target_id','kind','uri'], 'Evidence');
    const source = getRows(blocks[4], ['contract_version','project_id','source_type','source_ref'], 'Source');
    if (overview.length !== 1 || source.length !== 1) throw new Error('Overview and Source must each contain exactly one record.');
    if (string(overview[0].project_id) !== entry.id || string(source[0].project_id) !== entry.id) {
      throw new Error('Project identity does not match the master registry.');
    }
    if (string(source[0].contract_version) !== CONTRACT_VERSION) throw new Error('Source contract version mismatch.');
    // Source describes upstream provenance (e.g. GitHub or the legacy master Sheet).
    // The Registry instead points at this standardized reporting Sheet; the two URLs
    // and types are intentionally different, and must not be compared as identities.
    if (!string(source[0].source_type) || !string(source[0].source_ref)) {
      throw new Error('Source provenance is incomplete.');
    }
    const overviewRow = overview[0];
    let invalidHistory = 0, lastActivityMs = null, recent = 0;
    const events = [];
    const eventIds = new Set();
    for (const row of history) {
      const eventId = string(row.event_id), projectId = string(row.project_id);
      if (!eventId || projectId !== entry.id || eventIds.has(eventId)) {
        invalidHistory++;
        continue;
      }
      eventIds.add(eventId);
      const parsed = parseDate(row.occurred_at);
      const time = parsed?.getTime();
      if (!Number.isFinite(time)) invalidHistory++;
      else if (time <= now + 60000) {
        if (lastActivityMs === null || time > lastActivityMs) lastActivityMs = time;
        if (time >= now - RECENT_MS) recent++;
      }
      events.push({
        id: eventId, at: string(row.occurred_at), precision: string(row.precision),
        type: string(row.event_type), status: string(row.status_text), next: string(row.next_action),
        time: Number.isFinite(time) ? time : null
      });
    }
    events.sort((a,b) => (b.time ?? -Infinity) - (a.time ?? -Infinity));
    const workStates = Object.create(null);
    const kinds = Object.create(null);
    const seenItems = new Set();
    const items = [];
    let invalidDeliverables = 0, verified = 0;
    for (const row of deliverables) {
      const id = string(row.id), kind = string(row.kind).toLowerCase();
      if (!id || !kind || !string(row.title) || seenItems.has(id)) {
        invalidDeliverables++;
        continue;
      }
      seenItems.add(id);
      const state = string(row.work_state).toLowerCase() || 'unknown';
      const verification = string(row.verification_state).toLowerCase() || 'unknown';
      workStates[state] = (workStates[state] || 0) + 1;
      kinds[kind] = (kinds[kind] || 0) + 1;
      if (verification === 'operationally_verified') verified++;
      items.push({
        id, kind, title: string(row.title), workState: state,
        verificationState: verification, targetDate: string(row.target_date),
        required: string(row.required), sourceStatus: string(row.source_status),
        notes: string(row.notes)
      });
    }
    const updatedDate = parseDate(overviewRow.updated_at);
    return {
      id: entry.id, name: entry.name, sourceId: entry.sourceId, profile: entry.profile,
      lifecycle: string(overviewRow.lifecycle) || 'unknown',
      phase: string(overviewRow.phase), status: string(overviewRow.status_text),
      next: string(overviewRow.next_action), updated: updatedDate?.toISOString() || '',
      updatedPrecision: string(overviewRow.timestamp_precision),
      count: recent, historyCount: events.length, lastActivity: lastActivityMs === null ? '' : new Date(lastActivityMs).toISOString(),
      deliverables: items, events: events.slice(0, 60), evidenceCount: evidence.length,
      totalDeliverables: items.length, verified, workStates: {...workStates}, kinds: {...kinds},
      invalidHistory, invalidDeliverables, fetchedAt: new Date(now).toISOString(),
      stale: false, error: ''
    };
  }
  root.PDRCCore = Object.freeze({CACHE_KEY, CONTRACT_VERSION, RANGES, isRegistryRows, parseRegistry, normalizeProject});
})(globalThis);
