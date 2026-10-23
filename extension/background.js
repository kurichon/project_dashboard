/* Browser-owned updates only: no executable downloads or forced reloads. */
'use strict';
const PENDING_KEY = 'projectDashboardPendingUpdateV1';
const INSTALLED_KEY = 'projectDashboardInstalledUpdateV1';

chrome.runtime.onUpdateAvailable.addListener(details => {
  if (details && typeof details.version === 'string') {
    chrome.storage.local.set({[PENDING_KEY]: {version: details.version, detectedAt: Date.now()}});
  }
});

chrome.runtime.onInstalled.addListener(details => {
  if (details.reason === 'update' && details.previousVersion) {
    chrome.storage.local.set({
      [INSTALLED_KEY]: {from: details.previousVersion, to: chrome.runtime.getManifest().version, installedAt: Date.now()}
    });
  }
  // An installed update supersedes any pending marker, including an interrupted older check.
  chrome.storage.local.remove(PENDING_KEY);
});