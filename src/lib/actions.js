// User intents. Each reads state, enforces the focus lock, and writes a patch to storage.
// The service worker reacts to the storage change (see reconcile.js).
import { newId, createDefaultState } from './defaults.js';
import { displayHost, normalizeHost, parseRuleInput } from './patterns.js';
import { isValidWindow } from './schedule.js';
import { isFocusActive, isLocked } from './state.js';
import { recordAttempt } from './stats.js';
import { normalizeState, parseImport, updateState } from './store.js';

export class LockedError extends Error {
  constructor(message = 'Locked until your focus session ends.') {
    super(message);
  }
}

const LISTS = ['rules', 'allowlist'];

function assertList(list) {
  if (!LISTS.includes(list)) throw new Error(`Unknown list “${list}”`);
}

function assertUnlocked(state, now) {
  if (isLocked(state, now)) throw new LockedError();
}

/**
 * Add parsed rules ({ type, value }) to a list. Duplicates are skipped.
 * Adding to the block list is always allowed, even while locked; adding to the allow-list loosens
 * blocking, so it isn't.
 */
export async function addRules(parsed, { list = 'rules', now = Date.now() } = {}) {
  assertList(list);
  let added = [];
  let duplicates = [];
  await updateState((state) => {
    if (list === 'allowlist') assertUnlocked(state, now);
    const existing = new Map(state[list].map((r) => [`${r.type}:${r.value}`, r]));
    const next = [...state[list]];
    added = [];
    duplicates = [];
    for (const p of parsed) {
      if (list === 'allowlist' && p.type !== 'domain') continue;
      const key = `${p.type}:${p.value}`;
      const prior = existing.get(key);
      if (prior) {
        // Re-adding a disabled rule re-enables it.
        if (prior.enabled === false) {
          const i = next.findIndex((r) => r.id === prior.id);
          next[i] = { ...prior, enabled: true };
          added.push(next[i]);
        } else duplicates.push(prior);
        continue;
      }
      const rule = { id: newId(), type: p.type, value: p.value, enabled: true, createdAt: now };
      existing.set(key, rule);
      next.unshift(rule);
      added.push(rule);
    }
    return added.length ? { [list]: next } : null;
  });
  return { added, duplicates };
}

/** Parse free-text input and add it. Throws RuleInputError on bad input. */
export async function addRuleFromInput(input, { type = 'auto', list = 'rules', now } = {}) {
  const parsed = parseRuleInput(input, list === 'allowlist' ? 'domain' : type);
  return addRules([parsed], { list, now });
}

/** Block the site of a URL (popup button, context menu, keyboard shortcut). */
export async function blockSiteOf(url, { now } = {}) {
  const host = displayHost(url);
  if (!host || !normalizeHost(host)) throw new Error('This page can’t be blocked.');
  return addRules([{ type: 'domain', value: normalizeHost(host) }], { now });
}

export async function removeRule(id, { list = 'rules', now = Date.now() } = {}) {
  assertList(list);
  await updateState((state) => {
    if (list === 'rules') assertUnlocked(state, now);
    // Removing from the allow-list makes blocking stricter, so it's always allowed.
    const next = state[list].filter((r) => r.id !== id);
    return next.length !== state[list].length ? { [list]: next } : null;
  });
}

export async function setRuleEnabled(id, enabled, { list = 'rules', now = Date.now() } = {}) {
  assertList(list);
  await updateState((state) => {
    if (list === 'rules' && !enabled) assertUnlocked(state, now);
    if (list === 'allowlist' && enabled) assertUnlocked(state, now);
    let changed = false;
    const next = state[list].map((r) => {
      if (r.id !== id || r.enabled === enabled) return r;
      changed = true;
      return { ...r, enabled };
    });
    return changed ? { [list]: next } : null;
  });
}

/** Settings changes that would loosen blocking are refused while locked. */
function loosens(current, patch) {
  if ('enabled' in patch && patch.enabled === false && current.enabled) return true;
  if ('mode' in patch && patch.mode !== current.mode) return true;
  if ('lockDuringFocus' in patch && !patch.lockDuringFocus) return true;
  if (patch.tempAccess) {
    const t = { ...current.tempAccess, ...patch.tempAccess };
    if (t.enabled && !current.tempAccess.enabled) return true;
    if (t.delaySeconds < current.tempAccess.delaySeconds) return true;
    if (t.minutes > current.tempAccess.minutes) return true;
  }
  return false;
}

export async function updateSettings(patch, { now = Date.now() } = {}) {
  return updateState((state) => {
    if (isLocked(state, now) && loosens(state.settings, patch)) throw new LockedError();
    const settings = { ...state.settings, ...patch };
    if (patch.tempAccess) settings.tempAccess = { ...state.settings.tempAccess, ...patch.tempAccess };
    if (patch.blockPage) settings.blockPage = { ...state.settings.blockPage, ...patch.blockPage };
    const normalized = normalizeState({ ...state, settings }).settings;
    const patchOut = { settings: normalized };
    // Turning blocking back on cancels any pause.
    if (patch.enabled === true && state.pause) patchOut.pause = null;
    return patchOut;
  });
}

export async function setSchedule(schedule, { now = Date.now() } = {}) {
  const windows = (schedule.windows ?? []).filter(isValidWindow);
  return updateState((state) => {
    assertUnlocked(state, now);
    return {
      schedule: {
        enabled: Boolean(schedule.enabled) && windows.length > 0,
        windows: windows.map((w) => ({ id: w.id || newId(), days: [...new Set(w.days)].sort((a, b) => a - b), start: w.start, end: w.end })),
      },
    };
  });
}

export async function startFocus(minutes, { now = Date.now() } = {}) {
  const mins = Math.round(Number(minutes));
  if (!Number.isFinite(mins) || mins < 1 || mins > 600) throw new Error('Choose between 1 and 600 minutes.');
  return updateState((state) => {
    if (isFocusActive(state, now)) throw new Error('A focus session is already running.');
    return {
      focus: { startedAt: now, endsAt: now + mins * 60000 },
      // A focus session overrides any pause and revokes temporary access.
      pause: null,
      tempAccess: [],
      settings: { ...state.settings, focusMinutes: mins },
    };
  });
}

export async function endFocus({ now = Date.now() } = {}) {
  return updateState((state) => {
    if (!isFocusActive(state, now)) return null;
    assertUnlocked(state, now);
    return { focus: null };
  });
}

export async function pauseBlocking(minutes, { now = Date.now() } = {}) {
  const mins = Math.round(Number(minutes));
  if (!Number.isFinite(mins) || mins < 1 || mins > 24 * 60) throw new Error('Invalid pause length.');
  return updateState((state) => {
    if (isFocusActive(state, now)) throw new LockedError('You can’t pause during a focus session.');
    return { pause: { until: now + mins * 60000 } };
  });
}

export async function resumeBlocking() {
  return updateState((state) => (state.pause ? { pause: null } : null));
}

/** Temporary access to one host, from the block page. */
export async function grantTempAccess(url, { now = Date.now() } = {}) {
  const host = displayHost(url);
  if (!host) throw new Error('Invalid site.');
  return updateState((state) => {
    if (!state.settings.tempAccess.enabled) throw new Error('Temporary access is turned off in settings.');
    if (isFocusActive(state, now)) throw new LockedError('Not available during a focus session.');
    const until = now + state.settings.tempAccess.minutes * 60000;
    const others = state.tempAccess.filter((t) => t.host !== host && t.until > now);
    return { tempAccess: [...others, { host, until }] };
  });
}

export async function recordBlock(host, { now = Date.now() } = {}) {
  if (!host) return;
  await updateState((state) => ({ stats: recordAttempt(state.stats, host, now) }));
}

export async function clearStats() {
  await updateState(() => ({ stats: {} }));
}

/** Import a backup. mode 'merge' adds rules; 'replace' overwrites lists, settings and schedule. */
export async function importBackup(input, { mode = 'merge', now = Date.now() } = {}) {
  const data = parseImport(input);
  let summary = { rules: 0, allowlist: 0 };
  await updateState((state) => {
    if (mode === 'replace') {
      assertUnlocked(state, now);
      summary = { rules: data.rules.length, allowlist: data.allowlist?.length ?? 0 };
      return {
        rules: data.rules,
        allowlist: data.allowlist ?? [],
        ...(data.settings ? { settings: data.settings } : {}),
        ...(data.schedule ? { schedule: data.schedule } : {}),
      };
    }
    const patch = {};
    for (const list of LISTS) {
      const incoming = data[list] ?? [];
      const keys = new Set(state[list].map((r) => `${r.type}:${r.value}`));
      const fresh = incoming.filter((r) => !keys.has(`${r.type}:${r.value}`));
      if (list === 'allowlist' && fresh.length) assertUnlocked(state, now);
      summary[list] = fresh.length;
      if (fresh.length) patch[list] = [...fresh, ...state[list]];
    }
    return patch;
  });
  return summary;
}

/** Wipe everything back to defaults (keeps nothing). */
export async function resetAll({ now = Date.now() } = {}) {
  await updateState((state) => {
    assertUnlocked(state, now);
    return createDefaultState();
  });
}
