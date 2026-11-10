// Small DOM toolkit shared by all pages. Never pass user data through innerHTML — use h().
import { loadState } from '../../lib/store.js';

/**
 * h('button', { class: 'btn', onclick, attrs: { 'aria-label': 'x' } }, 'Text', childNode)
 * Props: class, text, html (trusted constants only), style, dataset, attrs, on<event>, and DOM properties.
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'attrs') for (const [a, av] of Object.entries(v)) av != null && av !== false && el.setAttribute(a, av === true ? '' : av);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el[k] = v;
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Replace all children of `el`. */
export function mount(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

// Static, trusted SVG markup (24×24, stroke icons).
const SHIELD = '<path d="M12 3l7 3v5c0 4.6-3 8.4-7 9.6-4-1.2-7-5-7-9.6V6z"/>';
const ICONS = {
  shield: SHIELD,
  shieldCheck: `${SHIELD}<path d="m9 12 2 2 4-4"/>`,
  shieldOff: `${SHIELD}<path d="M4 4l16 16"/>`,
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  play: '<path d="M7 5l12 7-12 7z"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M10 2h4"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  chart: '<path d="M3 21h18M6 17v-5M11 17V6M16 17v-8M21 17v-3"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 16V5M7 10l5-5 5 5M5 20h14"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  power: '<path d="M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0"/>',
  hash: '<path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
  database: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
};

export function icon(name, cls = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `icon ${cls}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[name] ?? '';
  return svg;
}

/** The Focusgate mark (shield with a focus target), as an inline SVG element. */
export function logo(size = 24) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 128 128');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('logo');
  svg.innerHTML = LOGO_MARKUP;
  return svg;
}

export const LOGO_MARKUP =
  '<defs><linearGradient id="fg-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7a7af5"/><stop offset="1" stop-color="#4141bd"/></linearGradient></defs>' +
  '<rect width="128" height="128" rx="30" fill="url(#fg-g)"/>' +
  '<path d="M64 22l36 14v25c0 23-15.4 41.6-36 47-20.6-5.4-36-24-36-47V36z" fill="#fff"/>' +
  '<circle cx="64" cy="63" r="14" fill="none" stroke="#5252cc" stroke-width="10"/><circle cx="64" cy="63" r="3.5" fill="#5252cc"/>';

export function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

/** Apply the saved theme now and whenever it changes. */
export async function initTheme() {
  const state = await loadState();
  applyTheme(state.settings.theme);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings?.newValue) applyTheme(changes.settings.newValue.theme);
  });
  return state;
}

/** Call `cb(changes)` on any local storage change except passive stats-only writes (unless includeStats). */
export function onStateChange(cb, { includeStats = false } = {}) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const keys = Object.keys(changes);
    if (!includeStats && keys.length === 1 && keys[0] === 'stats') return;
    cb(changes);
  });
}

let toastHost;
export function toast(message, { type = 'info', duration = 2600 } = {}) {
  if (!toastHost) {
    toastHost = h('div', { class: 'toast-host', attrs: { role: 'status', 'aria-live': 'polite' } });
    document.body.append(toastHost);
  }
  const el = h('div', { class: `toast ${type}` }, icon(type === 'error' ? 'info' : 'check'), message);
  toastHost.append(el);
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 220);
  }, duration);
}

export function errorMessage(e) {
  return e?.message || String(e);
}

/** Run an async action and toast its error, if any. Returns the result or undefined. */
export async function attempt(fn, successMessage) {
  try {
    const res = await fn();
    if (successMessage) toast(typeof successMessage === 'function' ? successMessage(res) : successMessage);
    return res;
  } catch (e) {
    toast(errorMessage(e), { type: 'error', duration: 3600 });
    return undefined;
  }
}

/** Promise<boolean> confirm dialog. */
export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const dialog = h(
      'dialog',
      { class: 'modal' },
      h('div', { class: 'modal-body' }, h('h2', { text: title }), h('p', { class: 'muted', text: message })),
      h(
        'div',
        { class: 'modal-actions' },
        h('button', { class: 'btn', text: 'Cancel', onclick: () => dialog.close('cancel') }),
        h('button', {
          class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`,
          text: confirmLabel,
          onclick: () => dialog.close('ok'),
        }),
      ),
    );
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'ok');
      dialog.remove();
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

/** Favicon tile for a host via Chrome's _favicon API, or a glyph for keywords/paths. */
export function faviconTile(rule) {
  if (rule.type === 'keyword') return h('span', { class: 'favicon' }, icon('hash'));
  const host = rule.type === 'path' ? rule.value.slice(0, rule.value.indexOf('/')) : rule.value;
  const url = new URL(chrome.runtime.getURL('/_favicon/'));
  url.searchParams.set('pageUrl', `https://${host}`);
  url.searchParams.set('size', '32');
  const tile = h('span', { class: 'favicon' });
  const img = h('img', { src: url.href, alt: '', loading: 'lazy' });
  img.addEventListener('error', () => mount(tile, host.charAt(0).toUpperCase()));
  tile.append(img);
  return tile;
}

/** A labelled toggle switch. Returns the <label>; the checkbox is `.input`. */
export function toggle({ checked, onchange, label, disabled = false, id }) {
  const input = h('input', { type: 'checkbox', checked, disabled, id, attrs: { role: 'switch', 'aria-label': label } });
  if (onchange) input.addEventListener('change', () => onchange(input.checked, input));
  const el = h('label', { class: 'switch' }, input, h('span'));
  el.input = input;
  return el;
}

/** Repeat `fn` every second, aligned to wall-clock seconds. */
export function everySecond(fn) {
  fn();
  let timer;
  const tick = () => {
    fn();
    timer = setTimeout(tick, 1000 - (Date.now() % 1000));
  };
  timer = setTimeout(tick, 1000 - (Date.now() % 1000));
  return () => clearTimeout(timer);
}
