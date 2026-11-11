// Event wiring only — the logic lives in lib/. Listeners must be registered synchronously at top level.
import { blockSiteOf } from '../lib/actions.js';
import { blockPageBase, buildBlockUrl } from '../lib/blockurl.js';
import { ALARM_NAME, createReconciler } from '../lib/reconcile.js';
import { evaluateUrl } from '../lib/state.js';
import { loadState, migrate } from '../lib/store.js';

const requestReconcile = createReconciler();
const MENU_PAGE = 'focusgate-block-page';
const MENU_LINK = 'focusgate-block-link';

// Keys whose changes can't affect blocking — don't reconcile on them.
const PASSIVE_KEYS = new Set(['stats']);

chrome.runtime.onInstalled.addListener(async (details) => {
  await migrate();
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_PAGE, title: 'Block this site', contexts: ['page'], documentUrlPatterns: ['http://*/*', 'https://*/*'] });
    chrome.contextMenus.create({ id: MENU_LINK, title: 'Block linked site', contexts: ['link'], targetUrlPatterns: ['http://*/*', 'https://*/*'] });
  });
  await requestReconcile();
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('pages/options/options.html#welcome') });
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await migrate();
  await requestReconcile();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (Object.keys(changes).some((k) => !PASSIVE_KEYS.has(k))) requestReconcile();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) requestReconcile();
});

// Single-page-app navigations (pushState) never hit the network, so DNR can't see them.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url || !/^https?:/i.test(changeInfo.url)) return;
  const state = await loadState();
  if (evaluateUrl(state, changeInfo.url, Date.now()).blocked) {
    chrome.tabs.update(tabId, { url: buildBlockUrl(blockPageBase(), changeInfo.url) }).catch(() => {});
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const url = info.menuItemId === MENU_LINK ? info.linkUrl : tab?.url ?? info.pageUrl;
  if (url) blockSiteOf(url).catch(() => {});
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'block-current-site') return;
  const target = tab ?? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (target?.url) blockSiteOf(target.url).catch(() => {});
});

chrome.notifications?.onClicked.addListener((id) => {
  chrome.notifications.clear(id);
  chrome.action.openPopup?.().catch(() => {});
});

// Pages ask for an immediate reconcile when they need the new DNR rules in place before
// navigating (e.g. temporary access: grant, wait for rules, then load the site).
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'reconcile') return false;
  // A request made mid-run queues a fresh follow-up run, so this always sees current state.
  requestReconcile()
    .then(() => sendResponse({ ok: true }))
    .catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true;
});
