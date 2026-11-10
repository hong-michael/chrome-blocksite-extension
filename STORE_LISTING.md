# Chrome Web Store listing

## Name
Focusgate: Site Blocker & Focus Timer

## Summary (132 chars max)
Block distracting websites, schedule focus hours and run focus sessions. Private: everything stays on your device.

## Category
Productivity → Workflow & Planning

## Description
Focusgate keeps distracting websites out of your way, so you can spend your attention on what you
meant to do.

BLOCK EXACTLY WHAT YOU WANT
• Whole sites, including subdomains: reddit.com
• Just part of a site: youtube.com/shorts
• Any URL that contains a keyword
• Allow-list mode: block everything except the sites you need

FOCUS WHEN IT MATTERS
• Schedules: block only during work hours, or any days and times you choose
• Focus sessions: one click from the toolbar, with a live countdown in the badge
• Lock mode: you can't end the session early, pause, or unblock sites until it's over

FRICTION, NOT FRUSTRATION
• Take a scheduled break with Pause (5 to 60 minutes)
• Temporary access from the block page, after a short wait you choose
• A calm block page that shows why the site is blocked and how long is left

KNOW YOUR HABITS
• See how often you reached for each site, day by day

FAST TO USE
• Block the current site from the popup, the right-click menu, or Alt+Shift+B
• Light and dark themes
• Export and import your setup

PRIVATE BY DESIGN
No accounts, no analytics, no network requests. Your lists and statistics never leave your device.

## Single purpose
Blocks websites the user chooses, optionally on a schedule or during timed focus sessions.

## Permission justifications
| Permission | Why |
| --- | --- |
| Host access `<all_urls>` | Required to redirect a blocked site to the block page with declarativeNetRequest, and to send already-open tabs to the block page when a site gets blocked. URLs are only compared against the user's rules on the device. |
| `declarativeNetRequestWithHostAccess` | Blocks sites before they load, using rules built from the user's block list. |
| `storage` | Saves the user's lists, schedule, settings and local statistics. |
| `alarms` | Ends pauses, focus sessions and temporary access on time, and switches blocking on and off at schedule boundaries. |
| `contextMenus` | Adds "Block this site" to the right-click menu. |
| `notifications` | Optional notice when a focus session ends. |
| `favicon` | Shows site icons in the block list. |

## Data usage disclosures
- Does not collect or use any user data.
- Not sold to third parties; not used for unrelated purposes; not used for creditworthiness.

## Privacy policy URL
https://github.com/hong-michael/chrome-blocksite-extension/blob/main/PRIVACY.md

## Assets
- Icon: `src/icons/icon128.png`
- Screenshots (1280×800): `store/screenshots/` (regenerate with `npm run screenshots`)
- Small promo tile (440×280) still needs to be made if you want featured placement.
