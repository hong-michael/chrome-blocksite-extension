// chrome.storage.local wrapper: normalisation, migrations, import/export.
import { SCHEMA_VERSION, STATE_KEYS, createDefaultState, defaultSettings, newId } from './defaults.js';
import { RULE_TYPES, normalizeHost, parseRuleInput } from './patterns.js';
import { isValidWindow } from './schedule.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function mergeDeep(base, over) {
  if (!isObj(over)) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (!(k in base)) continue;
    if (isObj(base[k])) out[k] = mergeDeep(base[k], v);
    else if (typeof v === typeof base[k]) out[k] = v;
  }
  return out;
}

function normalizeRuleList(list, allowedTypes) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const r of list) {
    if (!isObj(r) || !allowedTypes.includes(r.type) || typeof r.value !== 'string') continue;
    let parsed;
    try {
      parsed = parseRuleInput(r.value, r.type);
    } catch {
      continue;
    }
    if (parsed.type !== r.type) continue;
    const key = `${parsed.type}:${parsed.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: typeof r.id === 'string' && r.id ? r.id : newId(),
      type: parsed.type,
      value: parsed.value,
      enabled: r.enabled !== false,
      createdAt: Number.isFinite(r.createdAt) ? r.createdAt : Date.now(),
    });
  }
  return out;
}

function normalizeSchedule(s, fallback) {
  if (!isObj(s)) return fallback;
  const windows = Array.isArray(s.windows)
    ? s.windows.filter(isValidWindow).map((w) => ({
        id: typeof w.id === 'string' && w.id ? w.id : newId(),
        days: [...new Set(w.days)].sort((a, b) => a - b),
        start: w.start,
        end: w.end,
      }))
    : fallback.windows;
  return { enabled: Boolean(s.enabled) && windows.length > 0, windows };
}

/** Coerce whatever is in storage into a complete, valid state object. */
export function normalizeState(raw = {}) {
  const d = createDefaultState();
  const settings = mergeDeep(defaultSettings(), raw.settings);
  if (!['block', 'allow'].includes(settings.mode)) settings.mode = 'block';
  if (!['system', 'light', 'dark'].includes(settings.theme)) settings.theme = 'system';
  settings.focusMinutes = clampInt(settings.focusMinutes, 1, 600, 25);
  settings.tempAccess.delaySeconds = clampInt(settings.tempAccess.delaySeconds, 0, 300, 15);
  settings.tempAccess.minutes = clampInt(settings.tempAccess.minutes, 1, 120, 5);
  settings.blockPage.message = settings.blockPage.message.slice(0, 280);

  const focus =
    isObj(raw.focus) && Number.isFinite(raw.focus.endsAt)
      ? { endsAt: raw.focus.endsAt, startedAt: Number.isFinite(raw.focus.startedAt) ? raw.focus.startedAt : raw.focus.endsAt }
      : null;
  const pause = isObj(raw.pause) && Number.isFinite(raw.pause.until) ? { until: raw.pause.until } : null;
  const tempAccess = Array.isArray(raw.tempAccess)
    ? raw.tempAccess.filter((t) => isObj(t) && normalizeHost(t.host) && Number.isFinite(t.until))
    : [];
  const stats = isObj(raw.stats) ? raw.stats : {};

  return {
    schemaVersion: SCHEMA_VERSION,
    settings,
    rules: normalizeRuleList(raw.rules, RULE_TYPES),
    allowlist: normalizeRuleList(raw.allowlist, ['domain']),
    schedule: normalizeSchedule(raw.schedule, d.schedule),
    focus,
    pause,
    tempAccess,
    stats,
  };
}

function clampInt(v, min, max, fallback) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export async function loadState() {
  const raw = await chrome.storage.local.get(STATE_KEYS);
  return normalizeState(raw);
}

export async function saveState(patch) {
  await chrome.storage.local.set(patch);
}

/** Read-modify-write. `fn(state)` returns a patch object (or null for no change). */
export async function updateState(fn) {
  const state = await loadState();
  const patch = await fn(state);
  if (patch && Object.keys(patch).length) {
    await chrome.storage.local.set(patch);
    return { ...state, ...patch };
  }
  return state;
}

/**
 * Bring storage up to the current schema. Imports v1's `storage.sync.blockedSites`.
 * Safe to run on every install/update/startup.
 */
export async function migrate() {
  const raw = await chrome.storage.local.get(STATE_KEYS);
  if (raw.schemaVersion === SCHEMA_VERSION) return { migrated: false, imported: 0 };

  const state = normalizeState(raw);
  let imported = 0;
  try {
    const { blockedSites } = await chrome.storage.sync.get('blockedSites');
    if (Array.isArray(blockedSites)) {
      const existing = new Set(state.rules.map((r) => `${r.type}:${r.value}`));
      for (const site of blockedSites) {
        try {
          const rule = parseRuleInput(site, 'domain');
          if (existing.has(`domain:${rule.value}`)) continue;
          existing.add(`domain:${rule.value}`);
          state.rules.push({ id: newId(), ...rule, enabled: true, createdAt: Date.now() });
          imported++;
        } catch {
          /* skip junk entries */
        }
      }
      await chrome.storage.sync.remove('blockedSites');
    }
  } catch {
    /* storage.sync unavailable — nothing to migrate */
  }
  await chrome.storage.local.set(state);
  return { migrated: true, imported };
}

export const EXPORT_APP_ID = 'focusgate';

export function buildExport(state, now = Date.now()) {
  return {
    app: EXPORT_APP_ID,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date(now).toISOString(),
    data: {
      settings: state.settings,
      rules: state.rules,
      allowlist: state.allowlist,
      schedule: state.schedule,
    },
  };
}

export class ImportError extends Error {}

/** Validate an export file (object or JSON string). Accepts v1-style plain arrays of sites too. */
export function parseImport(input) {
  let json = input;
  if (typeof input === 'string') {
    try {
      json = JSON.parse(input);
    } catch {
      throw new ImportError('That file isn’t valid JSON.');
    }
  }
  if (Array.isArray(json)) {
    return { rules: normalizeRuleList(json.map((v) => ({ type: 'domain', value: String(v) })), RULE_TYPES) };
  }
  if (!isObj(json) || json.app !== EXPORT_APP_ID || !isObj(json.data)) {
    throw new ImportError('This doesn’t look like a Focusgate backup.');
  }
  const n = normalizeState(json.data);
  const out = { rules: n.rules, allowlist: n.allowlist };
  if (isObj(json.data.settings)) out.settings = n.settings;
  if (isObj(json.data.schedule)) out.schedule = n.schedule;
  return out;
}
