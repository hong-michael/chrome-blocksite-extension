// Minimal in-memory chrome.* for unit tests. Install with installChromeMock() in beforeEach.

const clone = (v) => (v === undefined ? undefined : structuredClone(v));

function createStorageArea(areaName, fireChanged) {
  let data = {};
  return {
    _dump: () => clone(data),
    _reset: (init = {}) => {
      data = clone(init);
    },
    async get(keys) {
      if (keys == null) return clone(data);
      const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      const out = {};
      for (const k of list) {
        if (k in data) out[k] = clone(data[k]);
        else if (keys && typeof keys === 'object' && !Array.isArray(keys)) out[k] = clone(keys[k]);
      }
      return out;
    },
    async set(items) {
      const changes = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: clone(data[k]), newValue: clone(v) };
        data[k] = clone(v);
      }
      fireChanged(changes, areaName);
    },
    async remove(keys) {
      const changes = {};
      for (const k of [].concat(keys)) {
        if (k in data) {
          changes[k] = { oldValue: clone(data[k]) };
          delete data[k];
        }
      }
      if (Object.keys(changes).length) fireChanged(changes, areaName);
    },
    async clear() {
      data = {};
    },
  };
}

function event() {
  const listeners = [];
  return {
    addListener: (fn) => listeners.push(fn),
    removeListener: (fn) => listeners.splice(listeners.indexOf(fn), 1),
    _fire: (...args) => listeners.forEach((fn) => fn(...args)),
    _listeners: listeners,
  };
}

export function createChromeMock() {
  const onChanged = event();
  const fire = (changes, area) => onChanged._fire(changes, area);
  let dynamicRules = [];
  const alarms = new Map();
  const tabs = [];
  const badge = { text: '', color: '', title: '' };
  const notifications = [];

  const chrome = {
    runtime: {
      id: 'test-extension-id',
      getURL: (p) => `chrome-extension://test-extension-id/${p.replace(/^\//, '')}`,
      onMessage: event(),
      sendMessage: async () => ({ ok: true }),
    },
    storage: {
      local: createStorageArea('local', fire),
      sync: createStorageArea('sync', fire),
      onChanged,
    },
    declarativeNetRequest: {
      async getDynamicRules() {
        return clone(dynamicRules);
      },
      async updateDynamicRules({ removeRuleIds = [], addRules = [] }) {
        dynamicRules = dynamicRules.filter((r) => !removeRuleIds.includes(r.id));
        const ids = new Set(dynamicRules.map((r) => r.id));
        for (const r of addRules) {
          if (ids.has(r.id)) throw new Error(`Duplicate rule id ${r.id}`);
          ids.add(r.id);
        }
        dynamicRules.push(...clone(addRules));
        chrome.declarativeNetRequest._updates++;
      },
      _updates: 0,
    },
    action: {
      async setBadgeText({ text }) {
        badge.text = text;
      },
      async setBadgeBackgroundColor({ color }) {
        badge.color = color;
      },
      async setTitle({ title }) {
        badge.title = title;
      },
      _badge: badge,
    },
    alarms: {
      async create(name, info) {
        alarms.set(name, info);
      },
      async clear(name) {
        return alarms.delete(name);
      },
      onAlarm: event(),
      _alarms: alarms,
    },
    tabs: {
      async query() {
        return clone(tabs);
      },
      async update(id, props) {
        const t = tabs.find((x) => x.id === id);
        if (t) Object.assign(t, props);
        return clone(t);
      },
      onUpdated: event(),
      _tabs: tabs,
    },
    notifications: {
      async create(id, opts) {
        notifications.push({ id, ...opts });
        return id;
      },
      _sent: notifications,
    },
  };
  return chrome;
}

export function installChromeMock() {
  const chrome = createChromeMock();
  globalThis.chrome = chrome;
  return chrome;
}
