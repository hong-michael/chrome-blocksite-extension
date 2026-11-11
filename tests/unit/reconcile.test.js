import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock.js';
import * as actions from '../../src/lib/actions.js';
import { ALARM_NAME, badgeFor, createReconciler, nextWake, reconcile } from '../../src/lib/reconcile.js';
import { loadState } from '../../src/lib/store.js';

const NOW = new Date(2026, 10, 9, 10, 0).getTime(); // Monday 10:00
const MIN = 60000;
const BLOCK = 'chrome-extension://test-extension-id/pages/blocked/blocked.html';

let chrome;
beforeEach(() => {
  chrome = installChromeMock();
});

describe('reconcile', () => {
  it('installs DNR rules and clears the badge when active', async () => {
    await actions.addRuleFromInput('reddit.com');
    const { rules, effective } = await reconcile({ now: NOW });
    expect(effective.reason).toBe('always');
    expect(await chrome.declarativeNetRequest.getDynamicRules()).toEqual(rules);
    expect(rules[0].action.redirect.regexSubstitution).toBe(`${BLOCK}#\\0`);
    expect(chrome.action._badge.text).toBe('');
  });

  it('skips the DNR update when rules are unchanged', async () => {
    await actions.addRuleFromInput('reddit.com');
    await reconcile({ now: NOW });
    await reconcile({ now: NOW });
    expect(chrome.declarativeNetRequest._updates).toBe(1);
  });

  it('removes all rules when disabled', async () => {
    await actions.addRuleFromInput('reddit.com');
    await reconcile({ now: NOW });
    await actions.updateSettings({ enabled: false });
    await reconcile({ now: NOW });
    expect(await chrome.declarativeNetRequest.getDynamicRules()).toEqual([]);
    expect(chrome.action._badge.text).toBe('OFF');
  });

  it('redirects already-open tabs that are now blocked', async () => {
    chrome.tabs._tabs.push(
      { id: 1, url: 'https://www.reddit.com/r/all' },
      { id: 2, url: 'https://example.com/' },
      { id: 3, url: 'chrome://extensions' },
    );
    await actions.addRuleFromInput('reddit.com');
    const { enforced } = await reconcile({ now: NOW });
    expect(enforced).toBe(1);
    expect(chrome.tabs._tabs[0].url).toBe(`${BLOCK}#https://www.reddit.com/r/all`);
    expect(chrome.tabs._tabs[1].url).toBe('https://example.com/');
  });

  it('prunes expired state, notifies on focus end, and schedules wake-ups', async () => {
    await actions.addRuleFromInput('reddit.com');
    await actions.startFocus(25, { now: NOW });
    const during = await reconcile({ now: NOW });
    expect(chrome.action._badge.text).toBe('25m');
    expect(during.wake).toBe(NOW + MIN); // badge tick
    expect(chrome.alarms._alarms.get(ALARM_NAME)).toEqual({ when: NOW + MIN });

    const after = await reconcile({ now: NOW + 25 * MIN });
    expect(after.focusEnded).toBe(true);
    expect((await loadState()).focus).toBeNull();
    expect(chrome.notifications._sent).toHaveLength(1);
    expect(chrome.alarms._alarms.has(ALARM_NAME)).toBe(false);
  });

  it('wakes at the schedule boundary', async () => {
    await actions.setSchedule({ enabled: true, windows: [{ days: [1], start: '09:00', end: '11:00' }] });
    const { wake, effective } = await reconcile({ now: NOW });
    expect(effective.reason).toBe('schedule');
    expect(wake).toBe(new Date(2026, 10, 9, 11, 0).getTime());
  });

  it('re-blocks tabs when temporary access expires', async () => {
    await actions.addRuleFromInput('reddit.com');
    await actions.grantTempAccess('https://reddit.com/', { now: NOW });
    chrome.tabs._tabs.push({ id: 1, url: 'https://reddit.com/' });
    await reconcile({ now: NOW + MIN });
    expect(chrome.tabs._tabs[0].url).toBe('https://reddit.com/');
    await reconcile({ now: NOW + 5 * MIN });
    expect(chrome.tabs._tabs[0].url).toMatch(/^chrome-extension:/);
  });
});

describe('badgeFor / nextWake', () => {
  it('badge per reason', () => {
    expect(badgeFor({ reason: 'paused' }, NOW).text).toBe('II');
    expect(badgeFor({ reason: 'outside-schedule' }, NOW).text).toBe('');
    expect(badgeFor({ reason: 'focus', until: NOW + 90 * 1000 }, NOW).text).toBe('2m');
  });
  it('focus tick aligns to minute boundaries before the end', () => {
    const state = { focus: { endsAt: NOW + 90 * 1000 }, pause: null, tempAccess: [], schedule: { enabled: false } };
    expect(nextWake(state, { reason: 'focus', until: NOW + 90 * 1000 }, NOW)).toBe(NOW + 30 * 1000);
  });
});

describe('createReconciler', () => {
  it('coalesces concurrent requests into one follow-up run', async () => {
    let runs = 0;
    let release;
    const gate = new Promise((r) => (release = r));
    const request = createReconciler(async () => {
      runs++;
      if (runs === 1) await gate;
      return runs;
    });
    const a = request();
    const b = request();
    const c = request();
    release();
    expect(await a).toBe(2);
    expect(await b).toBe(2);
    expect(await c).toBe(2);
    expect(runs).toBe(2);
    expect(await request()).toBe(3);
  });
});
