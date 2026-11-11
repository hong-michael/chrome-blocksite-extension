// Default state shape. See CLAUDE.md → "State shape".

export const SCHEMA_VERSION = 2;

export const STATE_KEYS = [
  'schemaVersion',
  'settings',
  'rules',
  'allowlist',
  'schedule',
  'focus',
  'pause',
  'tempAccess',
  'stats',
];

export function defaultSettings() {
  return {
    enabled: true,
    mode: 'block',
    theme: 'system',
    lockDuringFocus: true,
    notifyOnFocusEnd: true,
    focusMinutes: 25,
    tempAccess: { enabled: true, delaySeconds: 15, minutes: 5 },
    blockPage: { message: '', showQuote: true, showStats: true },
  };
}

export function defaultSchedule() {
  return {
    enabled: false,
    windows: [{ id: newId(), days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' }],
  };
}

export function createDefaultState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: defaultSettings(),
    rules: [],
    allowlist: [],
    schedule: defaultSchedule(),
    focus: null,
    pause: null,
    tempAccess: [],
    stats: {},
  };
}

export function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** One-click suggestions shown during onboarding and on the block list. */
export const SUGGESTED_SITES = [
  'youtube.com',
  'reddit.com',
  'x.com',
  'instagram.com',
  'tiktok.com',
  'facebook.com',
  'netflix.com',
  'twitch.tv',
  'news.ycombinator.com',
];
