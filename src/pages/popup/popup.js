import * as actions from '../../lib/actions.js';
import { blockPageBase, isBlockPageUrl, originalUrlFrom } from '../../lib/blockurl.js';
import { describeEffective, formatClock, formatCountdown, formatMinutes } from '../../lib/format.js';
import { describeRule, displayHost, findMatchingRule, hostMatchesDomain } from '../../lib/patterns.js';
import { computeEffective, isLocked } from '../../lib/state.js';
import { summarize } from '../../lib/stats.js';
import { loadState } from '../../lib/store.js';
import { attempt, everySecond, faviconTile, h, icon, initTheme, logo, mount, onStateChange, toggle } from '../shared/ui.js';

const app = document.getElementById('app');
const PRESETS = [25, 50, 90];
const PAUSES = [
  [5, '5 min'],
  [15, '15 min'],
  [30, '30 min'],
  [60, '1 hour'],
];

let state;
let page = { url: null, host: null };
let selectedMinutes;
let tickers = [];

async function currentPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let url = tab?.url ?? null;
  if (url && isBlockPageUrl(url, blockPageBase())) url = originalUrlFrom(url);
  return { url, host: url ? displayHost(url) : null };
}

function openOptions(hash = '') {
  const url = chrome.runtime.getURL(`pages/options/options.html${hash}`);
  chrome.tabs.create({ url });
  window.close();
}

function render() {
  const now = Date.now();
  const eff = computeEffective(state, now);
  const locked = isLocked(state, now);
  tickers = [];
  mount(
    app,
    header(),
    statusCard(eff, locked, now),
    siteCard(locked),
    eff.reason === 'focus' ? focusRunning(eff, locked, now) : focusSetup(),
    pauseCard(eff),
    footer(now),
  );
}

function header() {
  return h(
    'div',
    { class: 'top' },
    logo(24),
    h('div', { class: 'brand', text: 'Focusgate' }),
    h(
      'button',
      { class: 'btn btn-ghost btn-icon', title: 'Settings', attrs: { 'aria-label': 'Open settings' }, onclick: () => openOptions() },
      icon('sliders'),
    ),
  );
}

function statusCard(eff, locked, now) {
  const tone = eff.reason === 'paused' ? 'warn' : eff.active ? 'on' : 'off';
  const iconName = { focus: 'timer', paused: 'pause', disabled: 'shieldOff', 'outside-schedule': 'calendar' }[eff.reason] ?? 'shieldCheck';
  const title = h('div', { class: 'status-title' });
  const detail = h('div', { class: 'status-detail' });
  const update = () => {
    const d = describeEffective(computeEffective(state, Date.now()), Date.now());
    title.textContent = d.title;
    detail.textContent = d.detail;
  };
  update();
  if (eff.until) tickers.push(update);

  const sw =
    eff.reason === 'focus'
      ? null
      : toggle({
          checked: state.settings.enabled,
          label: 'Blocking enabled',
          disabled: locked,
          onchange: (on, input) =>
            attempt(() => actions.updateSettings({ enabled: on })).then((r) => {
              if (r === undefined) input.checked = !on;
            }),
        });
  return h(
    'section',
    { class: 'status', dataset: { tone }, attrs: { 'aria-label': 'Blocking status' } },
    h('div', { class: 'status-icon' }, icon(iconName)),
    h('div', { class: 'status-text' }, title, detail),
    sw,
  );
}

function siteCard(locked) {
  const { url, host } = page;
  if (!host) {
    return h(
      'section',
      { class: 'card section' },
      h('div', { class: 'site' }, h('span', { class: 'favicon' }, icon('globe')), h('div', { class: 'site-host muted', text: 'This page can’t be blocked' })),
    );
  }
  const allowMode = state.settings.mode === 'allow';
  let tag;
  let action;
  let sub = allowMode ? 'Allow-list mode' : 'Current site';
  if (allowMode) {
    const rule = state.allowlist.find((r) => r.enabled !== false && hostMatchesDomain(host, r.value));
    if (rule) {
      tag = h('span', { class: 'tag tag-success', text: 'Allowed' });
      action = h('button', {
        class: 'btn btn-ghost btn-sm',
        text: 'Remove',
        onclick: () => attempt(() => actions.removeRule(rule.id, { list: 'allowlist' }), `${rule.value} removed from allow list`),
      });
    } else {
      tag = h('span', { class: 'tag tag-danger', text: 'Blocked' });
      action = h(
        'button',
        {
          class: 'btn btn-soft btn-sm',
          disabled: locked,
          onclick: () => attempt(() => actions.addRules([{ type: 'domain', value: host }], { list: 'allowlist' }), `${host} allowed`),
        },
        icon('check'),
        'Allow',
      );
    }
  } else {
    const rule = findMatchingRule(state.rules, url);
    if (rule) {
      tag = h('span', { class: 'tag tag-danger', text: 'Blocked' });
      if (rule.type !== 'domain' || rule.value !== host) sub = describeRule(rule);
      action = locked
        ? null
        : h('button', {
            class: 'btn btn-ghost btn-sm',
            text: 'Unblock',
            onclick: () => attempt(() => actions.removeRule(rule.id), `${rule.value} unblocked`),
          });
    } else {
      action = h(
        'button',
        { class: 'btn btn-primary btn-sm', onclick: () => attempt(() => actions.blockSiteOf(url), `${host} blocked`) },
        icon('shield'),
        'Block site',
      );
    }
  }
  return h(
    'section',
    { class: 'card section', attrs: { 'aria-label': 'Current site' } },
    h(
      'div',
      { class: 'site' },
      faviconTile({ type: 'domain', value: host }),
      h('div', { class: 'site-host' }, host, h('small', { text: sub })),
      tag,
      action,
    ),
  );
}

function sectionHead(iconName, title, extra) {
  return h('div', { class: 'section-head' }, h('div', { class: 'section-title' }, icon(iconName), title), extra);
}

function focusSetup() {
  const custom = h('input', {
    class: 'input preset-custom',
    type: 'number',
    min: 1,
    max: 600,
    placeholder: 'Custom',
    attrs: { 'aria-label': 'Custom minutes' },
    value: PRESETS.includes(selectedMinutes) ? '' : String(selectedMinutes),
  });
  const startBtn = h('button', { class: 'btn btn-primary btn-block' });
  const presetBtns = PRESETS.map((m) =>
    h('button', {
      class: 'preset',
      text: `${m}m`,
      attrs: { 'aria-pressed': String(m === selectedMinutes), 'aria-label': `${m} minutes` },
      onclick: () => {
        selectedMinutes = m;
        custom.value = '';
        sync();
      },
    }),
  );
  const sync = () => {
    presetBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(PRESETS[i] === selectedMinutes)));
    const valid = Number.isInteger(selectedMinutes) && selectedMinutes >= 1 && selectedMinutes <= 600;
    startBtn.disabled = !valid;
    mount(startBtn, icon('play'), valid ? `Start ${formatMinutes(selectedMinutes)} focus` : 'Start focus');
  };
  custom.addEventListener('input', () => {
    selectedMinutes = Math.round(Number(custom.value)) || (custom.value ? NaN : state.settings.focusMinutes);
    sync();
  });
  startBtn.addEventListener('click', () => attempt(() => actions.startFocus(selectedMinutes), 'Focus session started'));
  sync();
  return h(
    'section',
    { class: 'card section', attrs: { 'aria-label': 'Focus session' } },
    sectionHead('timer', 'Focus session'),
    h('div', { class: 'presets' }, presetBtns, custom),
    startBtn,
  );
}

function focusRunning(eff, locked) {
  const { startedAt, endsAt } = state.focus;
  const time = h('div', { class: 'countdown' });
  const bar = h('div');
  const update = () => {
    const now = Date.now();
    time.textContent = formatCountdown(endsAt - now);
    bar.style.width = `${Math.min(100, ((now - startedAt) / (endsAt - startedAt)) * 100)}%`;
    if (now >= endsAt) loadState().then((s) => ((state = s), render()));
  };
  update();
  tickers.push(update);
  return h(
    'section',
    { class: 'card section', attrs: { 'aria-label': 'Focus session' } },
    sectionHead('timer', 'Focusing'),
    time,
    h('div', { class: 'countdown-sub', text: `Ends at ${formatClock(endsAt, Date.now())}` }),
    h('div', { class: 'progress', attrs: { role: 'progressbar', 'aria-label': 'Session progress' } }, bar),
    h('button', {
      class: 'btn btn-block',
      text: 'End session early',
      disabled: locked,
      onclick: () => attempt(() => actions.endFocus(), 'Focus session ended'),
    }),
    locked ? h('div', { class: 'lock-note' }, icon('lock'), 'Settings are locked until the session ends') : null,
  );
}

function pauseCard(eff) {
  if (eff.reason === 'focus' || eff.reason === 'disabled' || eff.reason === 'outside-schedule') return null;
  if (eff.reason === 'paused') {
    return h(
      'section',
      { class: 'card section' },
      sectionHead('pause', 'Paused'),
      h('button', { class: 'btn btn-soft btn-block', onclick: () => attempt(() => actions.resumeBlocking(), 'Blocking resumed') }, icon('play'), 'Resume blocking now'),
    );
  }
  return h(
    'section',
    { class: 'card section', attrs: { 'aria-label': 'Pause blocking' } },
    sectionHead('pause', 'Take a break'),
    h(
      'div',
      { class: 'pause-row' },
      PAUSES.map(([m, label]) =>
        h('button', {
          class: 'btn btn-sm',
          text: label,
          onclick: () => attempt(() => actions.pauseBlocking(m), `Paused for ${label}`),
        }),
      ),
    ),
  );
}

function footer(now) {
  const list = state.settings.mode === 'allow' ? state.allowlist : state.rules;
  const n = list.filter((r) => r.enabled !== false).length;
  const noun = state.settings.mode === 'allow' ? 'allowed' : 'blocked';
  const today = summarize(state.stats, now, 1).today;
  return h(
    'div',
    { class: 'footer' },
    h('span', { text: `${n} ${n === 1 ? 'site' : 'sites'} ${noun} · ${today} ${today === 1 ? 'block' : 'blocks'} today` }),
    h('a', { href: '#', onclick: (e) => (e.preventDefault(), openOptions()) }, 'Manage', icon('arrowRight')),
  );
}

async function main() {
  state = await initTheme();
  selectedMinutes = state.settings.focusMinutes;
  page = await currentPage();
  render();
  onStateChange(async () => {
    state = await loadState();
    render();
  });
  everySecond(() => tickers.forEach((fn) => fn()));
}

main();
