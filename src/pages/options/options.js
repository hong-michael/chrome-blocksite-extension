import * as actions from '../../lib/actions.js';
import { BLOCK_PAGE_PATH } from '../../lib/blockurl.js';
import { SUGGESTED_SITES, newId } from '../../lib/defaults.js';
import { describeEffective, formatClock, formatCountdown, formatMinutes } from '../../lib/format.js';
import { describeRule, parseBulkInput } from '../../lib/patterns.js';
import { DAY_NAMES, formatDays, isWithinSchedule, nextScheduleChange } from '../../lib/schedule.js';
import { computeEffective, isFocusActive, isLocked } from '../../lib/state.js';
import { summarize } from '../../lib/stats.js';
import { buildExport, loadState } from '../../lib/store.js';
import {
  attempt,
  confirmDialog,
  everySecond,
  faviconTile,
  h,
  icon,
  initTheme,
  logo,
  mount,
  onStateChange,
  toast,
  toggle,
} from '../shared/ui.js';

const SECTIONS = [
  { id: 'blocklist', label: 'Sites', icon: 'shield', title: 'Sites' },
  { id: 'schedule', label: 'Schedule', icon: 'calendar', title: 'Schedule' },
  { id: 'focus', label: 'Focus & strictness', icon: 'timer', title: 'Focus & strictness' },
  { id: 'blockpage', label: 'Block page', icon: 'eye', title: 'Block page' },
  { id: 'stats', label: 'Statistics', icon: 'chart', title: 'Statistics' },
  { id: 'general', label: 'General', icon: 'sliders', title: 'General' },
  { id: 'backup', label: 'Backup & reset', icon: 'database', title: 'Backup & reset' },
];

const els = {
  brand: document.getElementById('brand'),
  nav: document.getElementById('nav'),
  status: document.getElementById('sidebar-status'),
  main: document.getElementById('main'),
};

let state;
let route = 'blocklist';
let showWelcome = false;
// UI-only state that must survive re-renders (drafts are unsaved text in inputs, keyed by data-key).
let ui = { search: '', bulkOpen: false, addType: 'auto', importMode: 'merge', drafts: {} };
let tickers = [];

// ---------- Routing & shell ----------

function readRoute() {
  const hash = location.hash.replace(/^#/, '');
  if (hash === 'welcome') {
    showWelcome = true;
    history.replaceState(null, '', '#blocklist');
    return 'blocklist';
  }
  return SECTIONS.some((s) => s.id === hash) ? hash : 'blocklist';
}

function renderNav() {
  const counts = { blocklist: state.settings.mode === 'allow' ? state.allowlist.length : state.rules.length };
  mount(
    els.nav,
    SECTIONS.map((s) =>
      h(
        'a',
        { href: `#${s.id}`, attrs: { 'aria-current': s.id === route ? 'page' : null } },
        icon(s.icon),
        s.label,
        counts[s.id] != null ? h('span', { class: 'count', text: counts[s.id] }) : null,
      ),
    ),
  );
}

function renderSidebarStatus() {
  const now = Date.now();
  const eff = computeEffective(state, now);
  const d = describeEffective(eff, now);
  els.status.dataset.tone = eff.reason === 'paused' ? 'warn' : eff.active ? 'on' : 'off';
  mount(els.status, h('span', { class: 'dot' }), h('div', {}, h('strong', { text: d.title }), h('span', { text: d.detail })));
}

/** Re-render the current page, keeping focus and caret on the same logical control. */
function render() {
  const active = document.activeElement;
  const key = active?.dataset?.key;
  const sel = key && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;

  tickers = [renderSidebarStatus];
  renderNav();
  renderSidebarStatus();
  const section = SECTIONS.find((s) => s.id === route);
  document.title = `${section.title} · Focusgate`;
  mount(els.main, PAGES[route]());

  if (key) {
    const el = els.main.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      if (sel && el.setSelectionRange) {
        try {
          el.setSelectionRange(...sel);
        } catch {
          /* input type without selection */
        }
      }
    }
  }
}

function page(title, desc, ...children) {
  return h('div', { class: 'page' }, h('header', { class: 'page-head' }, h('h1', { text: title }), desc ? h('p', { text: desc }) : null), lockBanner(), children);
}

function lockBanner() {
  const now = Date.now();
  if (!isLocked(state, now)) return null;
  const text = h('span');
  const update = () => {
    text.textContent = `Focus session in progress — settings that loosen blocking are locked for ${formatCountdown(state.focus.endsAt - Date.now())}.`;
  };
  update();
  tickers.push(update);
  return h('div', { class: 'banner banner-warn', attrs: { role: 'status' } }, icon('lock'), text);
}

function card(...children) {
  return h('section', { class: 'card' }, children);
}

/** Bind a text input to a draft so typing survives re-renders triggered by storage changes. */
function draft(el) {
  const key = el.dataset.key;
  if (key in ui.drafts) el.value = ui.drafts[key];
  el.addEventListener('input', () => (ui.drafts[key] = el.value));
  return el;
}

function clearDraft(key) {
  delete ui.drafts[key];
}

function settingRow({ title, desc, control }) {
  return h('div', { class: 'row' }, h('div', { class: 'row-text' }, h('div', { class: 'row-title', text: title }), desc ? h('div', { class: 'row-desc' }, desc) : null), control);
}

function selectEl(options, value, onchange, { key, label, disabled } = {}) {
  const el = h(
    'select',
    { class: 'select', disabled, dataset: key ? { key } : undefined, attrs: { 'aria-label': label } },
    options.map(([v, text]) => h('option', { value: String(v), text, selected: String(v) === String(value) })),
  );
  el.addEventListener('change', () => onchange(el.value));
  return el;
}

// ---------- Sites ----------

function pageSites() {
  const now = Date.now();
  const locked = isLocked(state, now);
  const allowMode = state.settings.mode === 'allow';
  const list = allowMode ? 'allowlist' : 'rules';
  return page(
    'Sites',
    allowMode ? 'Allow-list mode: every site is blocked except the ones below.' : 'Sites, pages and keywords that are blocked while blocking is active.',
    showWelcome ? welcomeCard() : null,
    modePicker(locked),
    addCard(list, locked),
    ruleList(list, locked),
  );
}

function welcomeCard() {
  const present = new Set(state.rules.map((r) => r.value));
  return h(
    'section',
    { class: 'card welcome' },
    h('button', {
      class: 'btn btn-ghost btn-icon close',
      attrs: { 'aria-label': 'Dismiss welcome' },
      onclick: () => {
        showWelcome = false;
        render();
      },
    }, icon('x')),
    h('h2', {}, icon('sparkle'), 'Welcome to Focusgate'),
    h('p', { text: 'Start by adding the sites that pull you away. You can also block just part of a site (like youtube.com/shorts), schedule your focus hours, or start a focus session from the toolbar button.' }),
    h(
      'div',
      { class: 'suggestions' },
      SUGGESTED_SITES.filter((s) => !present.has(s)).slice(0, 6).map((s) =>
        h('button', { class: 'chip', onclick: () => attempt(() => actions.addRules([{ type: 'domain', value: s }]), `${s} blocked`) }, icon('plus'), s),
      ),
    ),
  );
}

function modePicker(locked) {
  const mode = state.settings.mode;
  const option = (value, iconName, title, desc) =>
    h(
      'button',
      {
        class: 'mode-card',
        disabled: locked && mode !== value,
        attrs: { 'aria-pressed': String(mode === value) },
        onclick: () => mode !== value && attempt(() => actions.updateSettings({ mode: value }), value === 'allow' ? 'Allow-list mode on' : 'Block-list mode on'),
      },
      icon(iconName),
      h('div', {}, h('strong', { text: title }), h('span', { text: desc })),
    );
  return h(
    'div',
    { class: 'mode-cards', attrs: { role: 'group', 'aria-label': 'Blocking mode' } },
    option('block', 'shield', 'Block list', 'Block only the sites you list.'),
    option('allow', 'lock', 'Allow list', 'Block everything except the sites you list.'),
  );
}

function addCard(list, locked) {
  const isAllow = list === 'allowlist';
  const error = h('div', { class: 'error-text', attrs: { 'aria-live': 'polite' } });
  const input = h('input', {
    class: 'input',
    type: 'text',
    placeholder: isAllow ? 'Add a site to allow, e.g. docs.google.com' : 'Add a site, page (youtube.com/shorts) or keyword',
    autocomplete: 'off',
    spellcheck: false,
    disabled: isAllow && locked,
    dataset: { key: `add-${list}` },
    attrs: { 'aria-label': isAllow ? 'Site to allow' : 'Site, page or keyword to block' },
  });
  const type = isAllow
    ? null
    : selectEl(
        [
          ['auto', 'Auto-detect'],
          ['domain', 'Whole site'],
          ['path', 'Page / section'],
          ['keyword', 'Keyword'],
        ],
        ui.addType,
        (v) => (ui.addType = v),
        { key: 'add-type', label: 'Rule type' },
      );
  const submit = async (e) => {
    e.preventDefault();
    error.textContent = '';
    input.removeAttribute('aria-invalid');
    try {
      const { added, duplicates } = await actions.addRuleFromInput(input.value, { type: ui.addType, list });
      if (added.length) {
        clearDraft(`add-${list}`);
        render();
        toast(`${added[0].value} ${isAllow ? 'allowed' : 'blocked'}`);
      } else if (duplicates.length) {
        error.textContent = `${duplicates[0].value} is already on your list.`;
      }
    } catch (err) {
      error.textContent = err.message;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
    }
  };
  draft(input);
  input.addEventListener('input', () => {
    error.textContent = '';
    input.removeAttribute('aria-invalid');
  });

  const bulk = ui.bulkOpen ? bulkEditor(list) : null;
  const present = new Set(state[list].map((r) => r.value));
  const suggestions = isAllow ? [] : SUGGESTED_SITES.filter((s) => !present.has(s));

  return h(
    'section',
    { class: 'card card-pad' },
    h(
      'form',
      { class: 'add-form', onsubmit: submit },
      input,
      type,
      h('button', { class: 'btn btn-primary', type: 'submit', disabled: isAllow && locked }, icon('plus'), 'Add'),
    ),
    h(
      'div',
      { class: 'add-meta' },
      error,
      h('button', {
        class: 'link-btn',
        type: 'button',
        text: ui.bulkOpen ? 'Hide bulk add' : 'Add several at once',
        onclick: () => {
          ui.bulkOpen = !ui.bulkOpen;
          render();
        },
      }),
    ),
    bulk,
    suggestions.length && !showWelcome
      ? h(
          'div',
          { class: 'suggestions' },
          h('div', { class: 'suggestions-label', text: 'Popular' }),
          suggestions.slice(0, 7).map((s) =>
            h('button', { class: 'chip', type: 'button', onclick: () => attempt(() => actions.addRules([{ type: 'domain', value: s }]), `${s} blocked`) }, icon('plus'), s),
          ),
        )
      : null,
  );
}

function bulkEditor(list) {
  const area = h('textarea', {
    class: 'textarea',
    rows: 5,
    placeholder: 'One per line (or comma-separated)\nreddit.com\nyoutube.com/shorts\ncasino',
    dataset: { key: `bulk-${list}` },
    attrs: { 'aria-label': 'Sites to add, one per line' },
  });
  draft(area);
  const add = async () => {
    const { rules, errors } = parseBulkInput(area.value, list === 'allowlist' ? 'domain' : 'auto');
    if (!rules.length && !errors.length) return;
    const res = await attempt(() => actions.addRules(rules, { list }));
    if (!res) return;
    const parts = [`Added ${res.added.length}`];
    if (res.duplicates.length) parts.push(`${res.duplicates.length} already listed`);
    if (errors.length) parts.push(`${errors.length} invalid`);
    toast(parts.join(' · '), { type: errors.length ? 'error' : 'info' });
    // Leave only the entries that failed, so they can be fixed.
    ui.drafts[`bulk-${list}`] = errors.map((e) => e.input).join('\n');
    render();
  };
  return h('div', { class: 'bulk' }, area, h('button', { class: 'btn btn-soft', type: 'button', onclick: add }, icon('plus'), 'Add all'));
}

function ruleList(list, locked) {
  const isAllow = list === 'allowlist';
  const items = state[list];
  const q = ui.search.trim().toLowerCase();
  const shown = q ? items.filter((r) => r.value.includes(q)) : items;

  const search = h('input', {
    class: 'input',
    type: 'search',
    placeholder: 'Search',
    value: ui.search,
    dataset: { key: 'search' },
    attrs: { 'aria-label': 'Search list' },
  });
  search.addEventListener('input', () => {
    ui.search = search.value;
    render();
  });

  let body;
  if (!items.length) {
    body = h(
      'div',
      { class: 'empty' },
      icon(isAllow ? 'lock' : 'shield'),
      h('strong', { text: isAllow ? 'Nothing is allowed yet' : 'Your block list is empty' }),
      h('span', { text: isAllow ? 'Every site is blocked while blocking is active. Add the sites you need for work.' : 'Add a site above, or pick from the popular ones.' }),
    );
  } else if (!shown.length) {
    body = h('div', { class: 'empty' }, icon('search'), h('span', { text: `Nothing matches “${ui.search}”.` }));
  } else {
    body = h('div', {}, shown.map((r) => ruleRow(r, list, locked)));
  }

  return h(
    'section',
    { class: 'card' },
    h(
      'div',
      { class: 'list-head' },
      h('div', { class: 'card-title', text: `${isAllow ? 'Allowed' : 'Blocked'} · ${items.length}` }),
      items.length > 5 ? h('div', { class: 'search' }, icon('search'), search) : null,
    ),
    body,
  );
}

function ruleRow(rule, list, locked) {
  const isAllow = list === 'allowlist';
  // Disabling a block rule or enabling an allow rule loosens blocking.
  const toggleLocked = locked && (isAllow ? !rule.enabled : rule.enabled);
  const removeLocked = locked && !isAllow;
  let value;
  if (rule.type === 'path') {
    const i = rule.value.indexOf('/');
    value = h('span', {}, rule.value.slice(0, i), h('span', { class: 'path', text: rule.value.slice(i) }));
  } else value = h('span', { text: rule.value });
  const typeTag = rule.type === 'path' ? h('span', { class: 'tag', text: 'Page' }) : rule.type === 'keyword' ? h('span', { class: 'tag', text: 'Keyword' }) : null;

  return h(
    'div',
    { class: 'rule', dataset: { enabled: String(rule.enabled !== false) } },
    faviconTile(rule),
    h(
      'div',
      { class: 'rule-main' },
      h('div', { class: 'rule-value' }, value, typeTag),
      h('div', { class: 'rule-desc', text: describeRule(rule) }),
    ),
    toggle({
      checked: rule.enabled !== false,
      label: `${rule.enabled !== false ? 'Disable' : 'Enable'} ${rule.value}`,
      disabled: toggleLocked,
      onchange: (on, input) =>
        attempt(() => actions.setRuleEnabled(rule.id, on, { list })).then((r) => {
          if (r === undefined) input.checked = !on;
        }),
    }),
    h(
      'button',
      {
        class: 'btn btn-ghost btn-icon',
        title: removeLocked ? 'Locked during focus session' : 'Remove',
        disabled: removeLocked,
        attrs: { 'aria-label': `Remove ${rule.value}` },
        onclick: () => attempt(() => actions.removeRule(rule.id, { list }), `${rule.value} removed`),
      },
      icon('trash'),
    ),
  );
}

// ---------- Schedule ----------

/** Full weekday name for day index (0 = Sunday); 2026-11-08 was a Sunday. */
function longDayName(d) {
  return new Date(2026, 10, 8 + d).toLocaleDateString(undefined, { weekday: 'long' });
}

function pageSchedule() {
  const now = Date.now();
  const locked = isLocked(state, now);
  const sched = state.schedule;
  const save = (next) => attempt(() => actions.setSchedule(next));
  const windows = sched.windows;

  const statusText = () => {
    if (!sched.enabled) return 'Off — blocking is active all the time.';
    const inside = isWithinSchedule(sched, Date.now());
    const next = nextScheduleChange(sched, Date.now());
    const when = next ? formatClock(next, Date.now()) : null;
    return inside ? `Blocking now${when ? ` · until ${when}` : ''}` : `Not blocking now${when ? ` · starts ${when}` : ''}`;
  };

  const rows = windows.map((w, i) => {
    const update = (patch) => save({ ...sched, windows: windows.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
    const timeInput = (field) => {
      const el = h('input', { class: 'input input-time', type: 'time', value: w[field], disabled: locked, dataset: { key: `w-${w.id}-${field}` }, attrs: { 'aria-label': field === 'start' ? 'From' : 'To' } });
      el.addEventListener('change', () => el.value && update({ [field]: el.value }));
      return el;
    };
    const overnight = w.end <= w.start && w.end !== w.start;
    return h(
      'div',
      { class: 'window' },
      h(
        'div',
        { class: 'days', attrs: { role: 'group', 'aria-label': 'Days' } },
        [1, 2, 3, 4, 5, 6, 0].map((d) =>
          h('button', {
            class: 'day',
            text: DAY_NAMES[d].slice(0, 2),
            disabled: locked,
            attrs: { 'aria-pressed': String(w.days.includes(d)), 'aria-label': longDayName(d) },
            onclick: () => {
              const days = w.days.includes(d) ? w.days.filter((x) => x !== d) : [...w.days, d];
              if (!days.length) return toast('Pick at least one day.', { type: 'error' });
              update({ days });
            },
          }),
        ),
      ),
      h('div', { class: 'times' }, timeInput('start'), 'to', timeInput('end')),
      h('div', { class: 'window-note', text: w.start === w.end ? `${formatDays(w.days)}, all day` : `${formatDays(w.days)}${overnight ? ' · ends next day' : ''}` }),
      h(
        'button',
        {
          class: 'btn btn-ghost btn-icon',
          disabled: locked || windows.length === 1,
          title: windows.length === 1 ? 'At least one window is needed' : 'Remove window',
          attrs: { 'aria-label': 'Remove time window' },
          onclick: () => save({ ...sched, windows: windows.filter((_, j) => j !== i) }),
        },
        icon('trash'),
      ),
    );
  });

  const status = h('div', { class: 'row-desc', text: statusText() });
  tickers.push(() => (status.textContent = statusText()));

  return page(
    'Schedule',
    'Block only during the hours you choose. Focus sessions always block, whatever the schedule.',
    card(
      settingRow({
        title: 'Only block during scheduled hours',
        desc: null,
        control: toggle({ checked: sched.enabled, disabled: locked, label: 'Use schedule', onchange: (on) => save({ ...sched, enabled: on }) }),
      }),
      h('div', { class: 'row', style: { paddingTop: 0, borderTop: 0 } }, status),
    ),
    h(
      'section',
      { class: 'card' },
      h('div', { class: 'list-head' }, h('div', { class: 'card-title', text: 'Time windows' })),
      rows,
    ),
    h(
      'div',
      { class: 'actions-row' },
      h(
        'button',
        {
          class: 'btn',
          disabled: locked,
          onclick: () => save({ ...sched, windows: [...windows, { id: newId(), days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' }] }),
        },
        icon('plus'),
        'Add time window',
      ),
      h('span', { class: 'subtle', text: 'Overnight windows like 22:00 – 02:00 work too.' }),
    ),
  );
}

// ---------- Focus ----------

function pageFocus() {
  const now = Date.now();
  const locked = isLocked(state, now);
  const s = state.settings;
  const set = (patch) => attempt(() => actions.updateSettings(patch));
  const focusing = isFocusActive(state, now);

  let sessionRow;
  if (focusing) {
    const t = h('span');
    const upd = () => (t.textContent = `${formatCountdown(state.focus.endsAt - Date.now())} left · ends at ${formatClock(state.focus.endsAt, Date.now())}`);
    upd();
    tickers.push(upd);
    sessionRow = settingRow({
      title: 'Focus session running',
      desc: t,
      control: h('button', { class: 'btn', disabled: locked, onclick: () => attempt(() => actions.endFocus(), 'Focus session ended') }, 'End early'),
    });
  } else {
    sessionRow = settingRow({
      title: 'Start a focus session',
      desc: 'Blocks your list for the set time, overriding schedule and pause.',
      control: h('button', { class: 'btn btn-primary', onclick: () => attempt(() => actions.startFocus(s.focusMinutes), 'Focus session started') }, icon('play'), `Start ${formatMinutes(s.focusMinutes)}`),
    });
  }

  const durations = [15, 25, 30, 45, 50, 60, 90, 120];
  if (!durations.includes(s.focusMinutes)) durations.push(s.focusMinutes);
  durations.sort((a, b) => a - b);

  return page(
    'Focus & strictness',
    'Run timed focus sessions and decide how hard it is to get around a block.',
    card(
      sessionRow,
      settingRow({
        title: 'Default session length',
        control: selectEl(durations.map((m) => [m, formatMinutes(m)]), s.focusMinutes, (v) => set({ focusMinutes: Number(v) }), { key: 'focus-len', label: 'Default session length' }),
      }),
      settingRow({
        title: 'Notify when a session ends',
        control: toggle({ checked: s.notifyOnFocusEnd, label: 'Notify when a session ends', onchange: (on) => set({ notifyOnFocusEnd: on }) }),
      }),
    ),
    card(
      settingRow({
        title: 'Lock settings during focus sessions',
        desc: 'While a session runs you can’t end it early, pause, turn off blocking, remove sites or take temporary access. Adding sites still works.',
        control: toggle({ checked: s.lockDuringFocus, disabled: locked, label: 'Lock settings during focus sessions', onchange: (on) => set({ lockDuringFocus: on }) }),
      }),
    ),
    card(
      settingRow({
        title: 'Allow temporary access',
        desc: 'Lets you open a blocked site for a few minutes from the block page. Never available during focus sessions.',
        control: toggle({ checked: s.tempAccess.enabled, disabled: locked && !s.tempAccess.enabled, label: 'Allow temporary access', onchange: (on) => set({ tempAccess: { enabled: on } }) }),
      }),
      settingRow({
        title: 'Wait before access',
        desc: 'A short pause to make you think twice.',
        control: selectEl(
          [[0, 'No wait'], [5, '5 seconds'], [15, '15 seconds'], [30, '30 seconds'], [60, '1 minute'], [120, '2 minutes']],
          s.tempAccess.delaySeconds,
          (v) => set({ tempAccess: { delaySeconds: Number(v) } }),
          { key: 'ta-delay', label: 'Wait before access', disabled: !s.tempAccess.enabled },
        ),
      }),
      settingRow({
        title: 'Access lasts',
        control: selectEl(
          [[1, '1 minute'], [3, '3 minutes'], [5, '5 minutes'], [10, '10 minutes'], [15, '15 minutes'], [30, '30 minutes']],
          s.tempAccess.minutes,
          (v) => set({ tempAccess: { minutes: Number(v) } }),
          { key: 'ta-min', label: 'Access duration', disabled: !s.tempAccess.enabled },
        ),
      }),
    ),
  );
}

// ---------- Block page ----------

function pageBlockPage() {
  const s = state.settings.blockPage;
  const set = (patch) => attempt(() => actions.updateSettings({ blockPage: patch }));
  const counter = h('div', { class: 'counter', text: `${s.message.length}/280` });
  const area = h('textarea', {
    class: 'textarea',
    maxLength: 280,
    value: s.message,
    placeholder: 'e.g. “You blocked this so you could finish your thesis.”',
    dataset: { key: 'bp-message' },
    attrs: { 'aria-label': 'Custom message' },
  });
  let timer;
  area.addEventListener('input', () => {
    counter.textContent = `${area.value.length}/280`;
    clearTimeout(timer);
    timer = setTimeout(() => set({ message: area.value }), 400);
  });
  return page(
    'Block page',
    'What you see when you hit a blocked site.',
    h(
      'section',
      { class: 'card card-pad' },
      h('div', { class: 'card-title', text: 'Personal message' }),
      h('div', { class: 'card-desc', text: 'A note to your future self. Shown instead of the motivational line.' }),
      h('div', { style: { marginTop: '12px' } }, area, counter),
    ),
    card(
      settingRow({ title: 'Show a motivational line', control: toggle({ checked: s.showQuote, label: 'Show a motivational line', onchange: (on) => set({ showQuote: on }) }) }),
      settingRow({ title: 'Show how often you tried today', control: toggle({ checked: s.showStats, label: 'Show attempt count', onchange: (on) => set({ showStats: on }) }) }),
    ),
    h(
      'div',
      { class: 'actions-row' },
      h(
        'button',
        { class: 'btn', onclick: () => chrome.tabs.create({ url: chrome.runtime.getURL(`${BLOCK_PAGE_PATH}?preview=1#https://example.com/`) }) },
        icon('external'),
        'Preview block page',
      ),
    ),
  );
}

// ---------- Statistics ----------

function pageStats() {
  const sum = summarize(state.stats, Date.now(), 7);
  const max = Math.max(1, ...sum.series.map((d) => d.count));
  const topMax = Math.max(1, ...sum.top.map((t) => t.count));
  const tile = (label, value) => h('section', { class: 'card tile' }, h('div', { class: 'tile-label', text: label }), h('div', { class: 'tile-value', text: value.toLocaleString() }));

  return page(
    'Statistics',
    'Blocked visits, counted on this device only. Kept for 30 days.',
    h('div', { class: 'tiles' }, tile('Today', sum.today), tile('Last 7 days', sum.week), tile('Last 30 days', sum.allTime)),
    h(
      'section',
      { class: 'card card-pad' },
      h('div', { class: 'card-title', text: 'This week' }),
      h(
        'div',
        { class: 'chart', attrs: { role: 'img', 'aria-label': sum.series.map((d) => `${d.label}: ${d.count}`).join(', ') } },
        sum.series.map((d, i) =>
          h(
            'div',
            { class: 'bar', dataset: { today: String(i === sum.series.length - 1) }, title: `${d.count} on ${d.key}` },
            h('div', { class: 'bar-count', text: d.count || '' }),
            h('div', { class: 'bar-fill', style: { height: `${(d.count / max) * 130}px` } }),
            h('div', { class: 'bar-label', text: d.label }),
          ),
        ),
      ),
    ),
    h(
      'section',
      { class: 'card' },
      h('div', { class: 'list-head' }, h('div', { class: 'card-title', text: 'Most blocked this week' })),
      sum.top.length
        ? h(
            'div',
            { style: { padding: '6px 0' } },
            sum.top.map((t) =>
              h(
                'div',
                { class: 'top-site' },
                faviconTile({ type: 'domain', value: t.host }),
                h('div', { class: 'host', text: t.host }),
                h('div', { class: 'meter' }, h('div', { style: { width: `${(t.count / topMax) * 100}%` } })),
                h('div', { class: 'n', text: t.count }),
              ),
            ),
          )
        : h('div', { class: 'empty' }, icon('chart'), h('span', { text: 'No blocked visits yet this week. Nice.' })),
    ),
    h(
      'div',
      { class: 'actions-row' },
      h('button', {
        class: 'btn btn-danger-ghost',
        disabled: !sum.allTime,
        text: 'Clear statistics',
        onclick: async () => {
          if (await confirmDialog({ title: 'Clear statistics?', message: 'All recorded block counts will be deleted.', confirmLabel: 'Clear', danger: true })) {
            attempt(() => actions.clearStats(), 'Statistics cleared');
          }
        },
      }),
    ),
  );
}

// ---------- General ----------

function pageGeneral() {
  const now = Date.now();
  const locked = isLocked(state, now);
  const s = state.settings;
  const themeSeg = h(
    'div',
    { class: 'seg', attrs: { role: 'group', 'aria-label': 'Theme' } },
    [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([v, label]) =>
      h('button', { text: label, attrs: { 'aria-pressed': String(s.theme === v) }, onclick: () => attempt(() => actions.updateSettings({ theme: v })) }),
    ),
  );
  const version = chrome.runtime.getManifest().version;
  return page(
    'General',
    null,
    card(
      settingRow({
        title: 'Blocking',
        desc: s.enabled ? 'On — your schedule and lists apply.' : 'Off — nothing is blocked (except during focus sessions).',
        control: toggle({
          checked: s.enabled,
          disabled: locked && s.enabled,
          label: 'Enable blocking',
          onchange: (on, input) =>
            attempt(() => actions.updateSettings({ enabled: on })).then((r) => {
              if (r === undefined) input.checked = !on;
            }),
        }),
      }),
      settingRow({ title: 'Theme', control: themeSeg }),
    ),
    card(
      settingRow({
        title: 'Keyboard shortcut',
        desc: h('span', {}, h('kbd', { text: 'Alt' }), ' + ', h('kbd', { text: 'Shift' }), ' + ', h('kbd', { text: 'B' }), ' blocks the site you’re on.'),
        control: h('button', { class: 'btn', onclick: () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }) }, icon('keyboard'), 'Customize'),
      }),
      settingRow({
        title: 'Block in Incognito',
        desc: 'Chrome only runs extensions in Incognito if you allow it on the extension’s details page.',
        control: h('button', { class: 'btn', onclick: () => chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` }) }, icon('external'), 'Open details'),
      }),
      settingRow({
        title: 'Right-click to block',
        desc: 'Right-click any page or link and choose “Block this site”.',
        control: null,
      }),
    ),
    h(
      'section',
      { class: 'card card-pad' },
      h('div', { class: 'card-title', text: `Focusgate ${version}` }),
      h('div', { class: 'card-desc', text: 'Private by design: no accounts, no analytics. Your lists and statistics never leave this device.' }),
    ),
  );
}

// ---------- Backup ----------

function pageBackup() {
  const now = Date.now();
  const locked = isLocked(state, now);
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', class: 'sr-only', attrs: { 'aria-label': 'Backup file' } });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const text = await file.text();
    fileInput.value = '';
    if (ui.importMode === 'replace') {
      const ok = await confirmDialog({ title: 'Replace everything?', message: 'Your current lists, schedule and settings will be replaced by the backup.', confirmLabel: 'Replace', danger: true });
      if (!ok) return;
    }
    await attempt(
      () => actions.importBackup(text, { mode: ui.importMode }),
      (r) => (ui.importMode === 'replace' ? 'Backup restored' : `Imported ${r.rules} blocked and ${r.allowlist} allowed sites`),
    );
  });

  const exportBackup = () => {
    const blob = new Blob([JSON.stringify(buildExport(state), null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `focusgate-backup-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Backup downloaded');
  };

  const modeSeg = h(
    'div',
    { class: 'seg', attrs: { role: 'group', 'aria-label': 'Import mode' } },
    [['merge', 'Merge'], ['replace', 'Replace']].map(([v, label]) =>
      h('button', {
        text: label,
        disabled: v === 'replace' && locked,
        attrs: { 'aria-pressed': String(ui.importMode === v) },
        onclick: () => {
          ui.importMode = v;
          render();
        },
      }),
    ),
  );

  return page(
    'Backup & reset',
    'Move your setup to another computer, or start over.',
    card(
      settingRow({
        title: 'Export',
        desc: 'Downloads your lists, schedule and settings as a JSON file. Statistics aren’t included.',
        control: h('button', { class: 'btn', onclick: exportBackup }, icon('download'), 'Download backup'),
      }),
      settingRow({
        title: 'Import',
        desc: ui.importMode === 'merge' ? 'Adds sites from the backup to your current lists.' : 'Replaces your lists, schedule and settings with the backup.',
        control: h('div', { class: 'actions-row' }, modeSeg, h('button', { class: 'btn', onclick: () => fileInput.click() }, icon('upload'), 'Choose file'), fileInput),
      }),
    ),
    h(
      'section',
      { class: 'card danger-card' },
      settingRow({
        title: 'Reset everything',
        desc: 'Deletes all lists, schedules, settings and statistics. This can’t be undone.',
        control: h('button', {
          class: 'btn btn-danger-ghost',
          disabled: locked,
          text: 'Reset…',
          onclick: async () => {
            if (await confirmDialog({ title: 'Reset Focusgate?', message: 'All your lists, schedules, settings and statistics will be permanently deleted.', confirmLabel: 'Reset everything', danger: true })) {
              attempt(() => actions.resetAll(), 'Everything was reset');
            }
          },
        }),
      }),
    ),
  );
}

const PAGES = {
  blocklist: pageSites,
  schedule: pageSchedule,
  focus: pageFocus,
  blockpage: pageBlockPage,
  stats: pageStats,
  general: pageGeneral,
  backup: pageBackup,
};

async function main() {
  state = await initTheme();
  mount(els.brand, logo(30), h('div', {}, 'Focusgate', h('small', { text: 'Site blocker & focus timer' })));
  route = readRoute();
  render();
  window.addEventListener('hashchange', () => {
    route = readRoute();
    ui.search = '';
    render();
    els.main.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  });
  onStateChange(async (changes) => {
    state = await loadState();
    // Stats are written on every block; only re-render for them on the stats page.
    const statsOnly = Object.keys(changes).every((k) => k === 'stats');
    if (!statsOnly || route === 'stats') render();
  }, { includeStats: true });
  let expiredFocus = null;
  everySecond(() => {
    tickers.forEach((fn) => fn());
    // Re-render once when a focus session runs out so locks lift without waiting for the worker.
    if (state.focus && state.focus.endsAt <= Date.now() && expiredFocus !== state.focus.endsAt) {
      expiredFocus = state.focus.endsAt;
      render();
    }
  });
}

main();
