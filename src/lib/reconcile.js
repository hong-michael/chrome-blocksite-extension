// Turn stored state into browser state: DNR rules, badge, wake-up alarm, open-tab enforcement.
import { blockPageBase, buildBlockUrl } from './blockurl.js';
import { buildDnrRules } from './dnr.js';
import { badgeMinutes } from './format.js';
import { computeEffective, evaluateUrl, nextChangeTime, pruneExpired } from './state.js';
import { loadState } from './store.js';

export const ALARM_NAME = 'focusgate-reconcile';

const BADGE = {
  focus: { color: '#5b5bd6', title: 'Focus session running' },
  paused: { color: '#d97706', title: 'Blocking paused' },
  disabled: { color: '#6b7280', title: 'Blocking is off' },
  'outside-schedule': { color: '#6b7280', title: 'Outside scheduled hours' },
};

export function badgeFor(effective, now) {
  switch (effective.reason) {
    case 'focus':
      return { text: badgeMinutes(effective.until - now), ...BADGE.focus };
    case 'paused':
      return { text: 'II', ...BADGE.paused };
    case 'disabled':
      return { text: 'OFF', ...BADGE.disabled };
    case 'outside-schedule':
      return { text: '', ...BADGE['outside-schedule'] };
    default:
      return { text: '', color: '#5b5bd6', title: 'Blocking is on' };
  }
}

/** When to wake next: the next state change, or the next badge-minute tick during focus. */
export function nextWake(state, effective, now) {
  let t = nextChangeTime(state, now);
  if (effective.reason === 'focus') {
    const remaining = effective.until - now;
    const tick = now + (remaining % 60000 || 60000);
    if (tick < effective.until) t = Math.min(t ?? Infinity, tick);
  }
  return t;
}

function sameRules(a, b) {
  const strip = (rules) => JSON.stringify([...rules].sort((x, y) => x.id - y.id));
  return strip(a) === strip(b);
}

/** Redirect open tabs whose URL is now blocked. */
export async function enforceOpenTabs(state, effective, now) {
  if (!effective.active) return 0;
  const base = blockPageBase();
  const tabs = await chrome.tabs.query({});
  let count = 0;
  for (const tab of tabs) {
    if (!tab.url || tab.id == null) continue;
    if (evaluateUrl(state, tab.url, now, effective).blocked) {
      count++;
      await chrome.tabs.update(tab.id, { url: buildBlockUrl(base, tab.url) }).catch(() => {});
    }
  }
  return count;
}

export async function reconcile({ now = Date.now(), enforceTabs = true } = {}) {
  const state = await loadState();
  const { patch, focusEnded } = pruneExpired(state, now);
  if (patch) {
    Object.assign(state, patch);
    await chrome.storage.local.set(patch);
  }

  const effective = computeEffective(state, now);
  const rules = buildDnrRules(state, effective, blockPageBase(), now);
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  if (!sameRules(existing, rules)) {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existing.map((r) => r.id),
      addRules: rules,
    });
  }

  const badge = badgeFor(effective, now);
  await Promise.all([
    chrome.action.setBadgeText({ text: badge.text }),
    chrome.action.setBadgeBackgroundColor({ color: badge.color }),
    chrome.action.setTitle({ title: `Focusgate — ${badge.title}` }),
  ]);

  const wake = nextWake(state, effective, now);
  if (wake) await chrome.alarms.create(ALARM_NAME, { when: wake });
  else await chrome.alarms.clear(ALARM_NAME);

  if (focusEnded && state.settings.notifyOnFocusEnd) {
    chrome.notifications
      ?.create('focusgate-focus-done', {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: 'Focus session complete',
        message: 'Nice work. Take a short break — you earned it.',
        priority: 1,
      })
      .catch?.(() => {});
  }

  const enforced = enforceTabs ? await enforceOpenTabs(state, effective, now) : 0;
  return { state, effective, rules, wake, focusEnded, enforced };
}

/**
 * Serialise reconcile runs: while one runs, further requests coalesce into a single follow-up run.
 */
export function createReconciler(run = reconcile) {
  let running = null;
  let again = false;
  return function request() {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      let result;
      do {
        again = false;
        result = await run();
      } while (again);
      return result;
    })().finally(() => {
      running = null;
    });
    return running;
  };
}
