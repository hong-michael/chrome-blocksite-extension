# Focusgate — Site Blocker & Focus Timer

A Manifest V3 Chrome extension that blocks distracting sites, with schedules, focus
sessions, an allow-list mode, friction-based temporary access and local statistics.
This file is the spec: product decisions, architecture and conventions. Keep it current
when behaviour changes.

> v1 of this repo was a 5-file popup that redirected via `webNavigation` + `tabs.update`
> (racy: the page started loading first) and matched with `hostname.includes(site)`
> (so blocking `x.com` also blocked `netflix.com`). v2 is a full rewrite.

## Product

### Name
"Focusgate". "BlockSite" is another extension's trademark, so the store name must differ.
The display name and description live in `src/_locales/en/messages.json` — rename there.

### Features
| Feature | Behaviour |
| --- | --- |
| **Block list** | Rules of three kinds: **domain** (`reddit.com` — the domain and all subdomains), **path** (`youtube.com/shorts` — that path prefix on that domain/subdomains), **keyword** (`casino` — anywhere in host/path/query). Each rule can be toggled without deleting it. Input is auto-classified; full URLs are accepted and normalised. |
| **Allow-list mode** | Global mode switch. In allow-list mode *every* http(s) site is blocked except allow-listed domains. |
| **Schedule** | Optional. A set of windows (days of week + start/end time, overnight windows like 22:00–02:00 supported). When enabled, blocking is only active inside a window. |
| **Focus session** | Timer (presets 25/50/90 min or custom). Forces blocking on regardless of schedule/pause. Badge shows minutes left. Optional notification when done. |
| **Lock during focus** (strict) | Default on. While a focus session runs: can't end it early, pause, disable blocking, remove/disable rules, change mode/schedule, or take temporary access. Adding rules is always allowed. |
| **Pause** | Disable blocking for 5/15/30/60 min, resumes automatically. |
| **Master switch** | Turns blocking off entirely (until turned back on). |
| **Temporary access** | From the block page: "Allow for N minutes" after a friction delay (default 15 s countdown). Per-host, expires automatically and re-blocks open tabs. Can be disabled in settings. |
| **Block page** | Calm full-page design: which site, why (focus / schedule / list), time remaining, an original motivational line, today's attempt count, Go back / temporary access. Auto-offers "Continue" if the site becomes unblocked while open. Custom message supported. |
| **Statistics** | Local only. Block attempts per host per day, 30-day retention. Options page shows today, 7-day chart and top sites. |
| **Quick block** | Popup "Block this site", right-click context menu, keyboard shortcut (Alt+Shift+B). |
| **Backup** | Export/import JSON (merge or replace), reset everything. |
| **Theme** | System / light / dark on all pages. |
| **Onboarding** | Install opens the options page with a welcome card and one-click suggestions. |
| **Migration** | v1 data (`chrome.storage.sync.blockedSites`) is imported as domain rules on update. |

### Non-goals (deliberate)
- **No passwords/accounts/remote sync/telemetry.** Nothing leaves the device (see `PRIVACY.md`).
- **No sub-resource blocking.** Only top-level navigations (`main_frame`) are blocked; embeds of a
  blocked site inside other pages still load. Keeps breakage low.
- **No uninstall prevention.** Strictness is friction, not DRM.

## Architecture

No bundler, no runtime dependencies. Plain ES modules loaded directly by Chrome
(`"type": "module"` service worker, `<script type="module">` on pages). `src/` *is* the
unpacked extension. Dev dependencies are only for tests.

```
src/
  manifest.json
  _locales/en/messages.json      store name/description
  icons/                         16/32/48/128 PNGs (rendered from icons/icon.svg)
  background/service-worker.js   event wiring only; delegates to lib/
  lib/                           pure / chrome-light logic — all unit tested
    patterns.js   parse + normalise user input → rule; JS URL matcher
    dnr.js        build declarativeNetRequest rules from state (pure)
    schedule.js   isWithinSchedule(), nextScheduleChange()
    state.js      computeEffective(): is blocking active, why, until when
    defaults.js   default state shape + schema version
    store.js      chrome.storage.local wrapper, migrations, import/validation
    actions.js    user intents (addRule, startFocus, pause, …) with lock checks
    reconcile.js  storage → DNR rules, badge, alarms, open-tab enforcement
    stats.js      record + aggregate block attempts
    blockurl.js   encode/decode the block page URL
    format.js     human time formatting
    quotes.js     original motivational lines
  pages/
    shared/       base.css (design tokens), ui.js (DOM helpers, theme, toasts)
    popup/        quick status + controls (360 px)
    options/      full settings app (hash-routed sections)
    blocked/      the block page
tests/
  unit/           Vitest, node env, in-memory chrome mock (tests/unit/chrome-mock.js)
  e2e/            Playwright, loads src/ as an unpacked extension in Chromium;
                  `*.test` hosts resolve to a local server (see fixtures.js)
scripts/
  render-icons.mjs   SVG → PNGs via Playwright
  screenshots.mjs    store/screenshots/*.png (1280×800, light + dark) via the E2E harness
  package.mjs        zip src/ into dist/focusgate-<version>.zip for the Web Store (no deps)
store/            Web Store listing assets (screenshots)
STORE_LISTING.md  listing copy + permission justifications
PRIVACY.md        privacy policy (required by the Web Store for host permissions)
```

### Data flow — storage is the single source of truth
1. UI pages call `lib/actions.js`, which read-modify-write `chrome.storage.local` (and
   enforce the focus lock).
2. The service worker listens to `storage.onChanged`, `alarms`, `onStartup`, `onInstalled`
   and runs `reconcile()` (serialised: one at a time, coalescing bursts).
3. `reconcile()` prunes expired state (pause, focus, temp access), computes the effective
   state, **atomically replaces** all dynamic DNR rules, sets the badge, schedules a single
   alarm for the next state change, and redirects already-open tabs that are now blocked.
4. Pages subscribe to `storage.onChanged` to re-render live.

There is exactly one runtime message: `{ type: 'reconcile' }`, which a page sends when it must
wait for DNR rules to be installed before navigating (the block page does this after granting
temporary access, otherwise the original URL would be redirected straight back). Everything
else flows through storage, so the worker can sleep freely.

### Blocking mechanism
- **declarativeNetRequest dynamic rules** redirect blocked `main_frame` requests *before*
  any byte of the page loads. Dynamic rules persist across restarts, so blocking works
  even before the worker wakes up.
- Redirect uses `regexSubstitution` to `chrome-extension://<id>/pages/blocked/blocked.html#<original-url>`
  so the block page knows what was blocked (`web_accessible_resources` must list it).
- Rule layout (rebuilt from scratch on every reconcile):
  - priority 1 — block: one rule for *all* domain rules (`requestDomains`), one regex rule
    per path/keyword rule; in allow-list mode a single catch-all `^https?://` rule.
  - priority 2 — allow: allow-listed domains (allow-list mode only).
  - priority 3 — allow: temporary access hosts.
- **SPA navigations** (`history.pushState`, e.g. YouTube → /shorts) don't hit the network,
  so `tabs.onUpdated` (url change) runs the JS matcher (`patterns.js`) and redirects.
  `tests/unit/dnr.test.js` asserts the JS matcher and generated regexes agree.
- Domains are normalised to lowercase punycode with `www.` stripped.

### State shape (`chrome.storage.local`)
```js
{
  schemaVersion: 2,
  settings: { enabled, mode: 'block'|'allow', theme, lockDuringFocus, notifyOnFocusEnd,
              focusMinutes, tempAccess: { enabled, delaySeconds, minutes },
              blockPage: { message, showQuote, showStats } },
  rules:      [{ id, type: 'domain'|'path'|'keyword', value, enabled, createdAt }],
  allowlist:  [{ id, type: 'domain', value, enabled, createdAt }],
  schedule:   { enabled, windows: [{ id, days: [0-6], start: 'HH:MM', end: 'HH:MM' }] },
  focus:      { endsAt, startedAt } | null,
  pause:      { until } | null,
  tempAccess: [{ host, until }],
  stats:      { 'YYYY-MM-DD': { host: count } },
}
```
`storage.local` (not `sync`): `sync` has an 8 KB per-item cap that a large list would hit;
export/import covers moving between machines.

### Effective state precedence (`state.js`)
focus session → active · master switch off → inactive · paused → inactive ·
schedule enabled → active iff inside a window · otherwise active.

### Permissions (justifications for the store listing in `STORE_LISTING.md`)
`storage`, `declarativeNetRequestWithHostAccess` + `<all_urls>` (redirect needs host access),
`alarms`, `contextMenus`, `notifications`, `favicon` (site icons in lists; no install warning).
Host access also lets the worker read open tabs' URLs to enforce new blocks, so the `tabs`
permission isn't needed.

## UI / design
- System font stack, no remote assets (privacy + CSP). Design tokens in
  `pages/shared/base.css`: indigo accent `--accent`, neutral greys, 8 px spacing scale,
  12 px radii, light & dark via `[data-theme]` + `prefers-color-scheme`.
- Icons are inline SVG (no icon fonts).
- Accessible: real `<button>`/`<label>`, visible focus rings, `aria-live` status, respects
  `prefers-reduced-motion`.
- Never build DOM with `innerHTML` from user data — use `ui.js` `h()` helper (v1 had an XSS
  via `innerHTML` with the site string).
- Pages re-render fully on storage changes. Anything the user is typing must survive that:
  give inputs a `data-key` (focus/caret are restored) and, in options, bind unsaved text with
  `draft()`. Toggle/select handlers must revert the control if the action throws (focus lock).

## Conventions
- ES modules, 2-space indent, single quotes, semicolons, no build step.
- `lib/` must not touch the DOM; anything time-dependent takes `now` as a parameter.
- Every `lib/` module has a unit test. New behaviour → new test.
- Commit in small, focused steps.
- Releasing: bump `version` in both `src/manifest.json` and `package.json`, run `npm run test:all`,
  then `npm run package` and upload the zip.

## Commands
```bash
npm test            # unit tests (Vitest)
npm run test:e2e    # end-to-end in real Chromium with the extension loaded (Playwright)
npm run icons       # re-render icons from src/icons/icon.svg
npm run screenshots # regenerate store/screenshots/
npm run package     # dist/focusgate-<version>.zip for the Chrome Web Store
HEADED=1 npm run test:e2e   # watch the E2E run in a visible browser
```
Load unpacked for development: `chrome://extensions` → Developer mode → Load unpacked → `src/`.
