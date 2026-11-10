import * as actions from '../../lib/actions.js';
import { originalUrlFrom } from '../../lib/blockurl.js';
import { formatClock, formatCountdown } from '../../lib/format.js';
import { displayHost } from '../../lib/patterns.js';
import { pickQuote } from '../../lib/quotes.js';
import { computeEffective, evaluateUrl } from '../../lib/state.js';
import { countForHost } from '../../lib/stats.js';
import { loadState } from '../../lib/store.js';
import { attempt, everySecond, h, icon, initTheme, logo, mount, onStateChange } from '../shared/ui.js';

const app = document.getElementById('app');
const preview = new URLSearchParams(location.search).has('preview');
const originalUrl = originalUrlFrom(location.href);
const host = originalUrl ? displayHost(originalUrl) : null;
const quote = pickQuote(Math.floor(Math.random() * 1e6));

let state;
let tickers = [];
// Temporary-access button: 'idle' → 'waiting' (until readyAt) → 'ready' → 'granting'
let temp = { phase: 'idle', readyAt: 0 };

/** Count each block once per tab, even if the tab gets redirected here twice in a row. */
async function recordOnce() {
  if (preview || !host) return;
  const key = `focusgate:recorded:${originalUrl}`;
  try {
    const last = Number(sessionStorage.getItem(key));
    if (last && Date.now() - last < 3000) return;
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    /* sessionStorage unavailable — record anyway */
  }
  await actions.recordBlock(host);
}

function goBack() {
  if (history.length > 1) {
    history.back();
    return;
  }
  chrome.tabs.getCurrent((tab) => {
    if (tab?.id != null) chrome.tabs.update(tab.id, { url: 'chrome://newtab' });
    else window.close();
  });
}

async function openSite() {
  temp.phase = 'granting';
  render();
  const ok = await attempt(() => actions.grantTempAccess(originalUrl));
  if (ok === undefined) {
    temp = { phase: 'idle', readyAt: 0 };
    render();
    return;
  }
  // Make sure the new allow rule is installed before navigating.
  await chrome.runtime.sendMessage({ type: 'reconcile' }).catch(() => {});
  location.replace(originalUrl);
}

function reasonPill(eff, verdict, now) {
  let iconName = 'shield';
  const text = h('span');
  let update = null;
  if (eff.reason === 'focus') {
    iconName = 'timer';
    update = () => (text.textContent = `Focus session · ${formatCountdown(eff.until - Date.now())} left`);
  } else if (eff.reason === 'schedule') {
    iconName = 'calendar';
    text.textContent = eff.until ? `Scheduled block · until ${formatClock(eff.until, now)}` : 'Scheduled block';
  } else if (verdict.why === 'allowlist') {
    iconName = 'lock';
    text.textContent = 'Allow-list mode';
  } else if (verdict.rule?.type === 'path') {
    iconName = 'link';
    text.textContent = `Blocked page: ${verdict.rule.value}`;
  } else if (verdict.rule?.type === 'keyword') {
    iconName = 'hash';
    text.textContent = `Blocked keyword: “${verdict.rule.value}”`;
  } else {
    text.textContent = 'On your block list';
  }
  if (update) {
    update();
    tickers.push(update);
  }
  return h('div', { class: 'reason' }, icon(iconName), text);
}

function tempButton(eff) {
  const s = state.settings.tempAccess;
  if (!s.enabled || !host || eff.reason === 'focus') return null;
  const mins = `${s.minutes} min`;
  const btn = h('button', { class: 'btn btn-lg temp' });
  const fill = h('span', { class: 'fill', style: { width: '0%' } });

  const paint = () => {
    const now = Date.now();
    if (temp.phase === 'waiting' && now >= temp.readyAt) temp.phase = 'ready';
    if (temp.phase === 'idle') {
      mount(btn, icon('clock'), h('span', { text: `Allow for ${mins}` }));
    } else if (temp.phase === 'waiting') {
      const left = Math.ceil((temp.readyAt - now) / 1000);
      const pct = 100 - ((temp.readyAt - now) / (s.delaySeconds * 1000)) * 100;
      fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
      mount(btn, fill, h('span', { text: `Take a breath… ${left}s` }));
    } else if (temp.phase === 'ready') {
      btn.classList.add('btn-soft');
      mount(btn, icon('arrowRight'), h('span', { text: `Open for ${mins}` }));
    } else {
      mount(btn, h('span', { text: 'Opening…' }));
    }
    btn.disabled = preview || temp.phase === 'waiting' || temp.phase === 'granting';
  };

  btn.addEventListener('click', () => {
    if (temp.phase === 'idle') {
      if (s.delaySeconds === 0) return openSite();
      temp = { phase: 'waiting', readyAt: Date.now() + s.delaySeconds * 1000 };
      paint();
    } else if (temp.phase === 'ready') openSite();
  });
  paint();
  tickers.push(paint);
  return btn;
}

function render() {
  const now = Date.now();
  tickers = [];
  const eff = computeEffective(state, now);
  const verdict = originalUrl ? evaluateUrl(state, originalUrl, now, eff) : { blocked: false };

  if (!preview && originalUrl && !verdict.blocked && temp.phase !== 'granting') {
    mount(
      app,
      h(
        'div',
        { class: 'panel' },
        h('div', { class: 'emblem', style: { color: 'var(--success)' } }, icon('check')),
        h('h1', {}, h('span', { class: 'host', text: host }), ' is available'),
        h('div', { class: 'reason' }, icon('info'), describeAvailable(eff)),
        h(
          'div',
          { class: 'actions' },
          h('button', { class: 'btn btn-primary btn-lg', onclick: () => location.replace(originalUrl) }, 'Continue to site', icon('arrowRight')),
        ),
      ),
    );
    return;
  }

  const bp = state.settings.blockPage;
  const title = !host
    ? h('h1', { text: 'This page is blocked' })
    : verdict.why === 'allowlist'
      ? h('h1', {}, h('span', { class: 'host', text: host }), ' isn’t on your allow list')
      : h('h1', {}, h('span', { class: 'host', text: host }), ' is blocked');

  const message = bp.message.trim()
    ? h('p', { class: 'quote personal', text: bp.message.trim() })
    : bp.showQuote
      ? h('p', { class: 'quote', text: quote })
      : null;

  let attemptsLine = null;
  if (bp.showStats && host) {
    const n = countForHost(state.stats, host, now);
    attemptsLine = h('p', {
      class: 'attempts',
      text: n <= 1 ? 'First attempt today.' : `You’ve tried to open this site ${n} times today.`,
    });
  }

  mount(
    app,
    h(
      'div',
      { class: 'panel' },
      h('div', { class: 'emblem' }, icon('shield')),
      title,
      reasonPill(eff, verdict, now),
      message,
      attemptsLine,
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'btn btn-primary btn-lg', onclick: goBack }, icon('arrowLeft'), 'Go back'),
        tempButton(eff),
      ),
      h(
        'p',
        { class: 'foot' },
        h('a', { href: '#', onclick: (e) => (e.preventDefault(), chrome.runtime.openOptionsPage()) }, 'Manage blocked sites'),
      ),
    ),
  );
}

function describeAvailable(eff) {
  if (eff.reason === 'paused') return 'Blocking is paused';
  if (eff.reason === 'disabled') return 'Blocking is turned off';
  if (eff.reason === 'outside-schedule') return 'Outside your scheduled hours';
  return 'It’s no longer on your block list';
}

async function main() {
  mount(document.getElementById('brand'), logo(22), 'Focusgate', preview ? h('span', { class: 'tag tag-accent preview-flag', text: 'Preview' }) : null);
  state = await initTheme();
  if (preview) document.title = 'Preview · Focusgate';
  else if (host) document.title = `${host} is blocked · Focusgate`;
  render();
  recordOnce();
  onStateChange(async () => {
    state = await loadState();
    render();
  }, { includeStats: true });
  everySecond(() => tickers.forEach((fn) => fn()));
}

main();
