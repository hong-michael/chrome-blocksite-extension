import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock.js';
import * as actions from '../../src/lib/actions.js';
import { LockedError } from '../../src/lib/actions.js';
import { RuleInputError } from '../../src/lib/patterns.js';
import { buildExport, loadState } from '../../src/lib/store.js';
import { dateKey } from '../../src/lib/stats.js';

const NOW = new Date(2026, 10, 9, 10, 0).getTime();
const MIN = 60000;

beforeEach(() => {
  installChromeMock();
});

async function withFocus(lock = true) {
  await actions.updateSettings({ lockDuringFocus: lock }, { now: NOW });
  await actions.startFocus(25, { now: NOW });
}

describe('rules', () => {
  it('adds from input, newest first, and reports duplicates', async () => {
    await actions.addRuleFromInput('reddit.com', { now: NOW });
    const res = await actions.addRuleFromInput('https://www.youtube.com/shorts', { now: NOW });
    expect(res.added[0]).toMatchObject({ type: 'path', value: 'youtube.com/shorts', enabled: true });
    const dup = await actions.addRuleFromInput('www.reddit.com', { now: NOW });
    expect(dup.added).toHaveLength(0);
    expect(dup.duplicates).toHaveLength(1);
    expect((await loadState()).rules.map((r) => r.value)).toEqual(['youtube.com/shorts', 'reddit.com']);
  });

  it('re-adding a disabled rule re-enables it', async () => {
    const { added } = await actions.addRuleFromInput('reddit.com');
    await actions.setRuleEnabled(added[0].id, false);
    const res = await actions.addRuleFromInput('reddit.com');
    expect(res.added).toHaveLength(1);
    expect((await loadState()).rules[0].enabled).toBe(true);
  });

  it('rejects bad input', async () => {
    await expect(actions.addRuleFromInput('two words')).rejects.toThrow(RuleInputError);
  });

  it('allowlist coerces to domains', async () => {
    await actions.addRuleFromInput('https://github.com/me/repo', { list: 'allowlist' });
    expect((await loadState()).allowlist[0]).toMatchObject({ type: 'domain', value: 'github.com' });
  });

  it('blockSiteOf blocks the host of a URL and refuses internal pages', async () => {
    await actions.blockSiteOf('https://www.instagram.com/reels/xyz');
    expect((await loadState()).rules[0]).toMatchObject({ type: 'domain', value: 'instagram.com' });
    await expect(actions.blockSiteOf('chrome://settings')).rejects.toThrow();
  });

  it('removes and toggles', async () => {
    const { added } = await actions.addRuleFromInput('a.com');
    await actions.setRuleEnabled(added[0].id, false);
    expect((await loadState()).rules[0].enabled).toBe(false);
    await actions.removeRule(added[0].id);
    expect((await loadState()).rules).toEqual([]);
  });
});

describe('focus lock', () => {
  it('prevents loosening while focus runs', async () => {
    const { added } = await actions.addRuleFromInput('a.com', { now: NOW });
    await withFocus();
    const opts = { now: NOW + MIN };
    await expect(actions.removeRule(added[0].id, opts)).rejects.toThrow(LockedError);
    await expect(actions.setRuleEnabled(added[0].id, false, opts)).rejects.toThrow(LockedError);
    await expect(actions.updateSettings({ enabled: false }, opts)).rejects.toThrow(LockedError);
    await expect(actions.updateSettings({ mode: 'allow' }, opts)).rejects.toThrow(LockedError);
    await expect(actions.updateSettings({ tempAccess: { delaySeconds: 0 } }, opts)).rejects.toThrow(LockedError);
    await expect(actions.endFocus(opts)).rejects.toThrow(LockedError);
    await expect(actions.pauseBlocking(5, opts)).rejects.toThrow(LockedError);
    await expect(actions.grantTempAccess('https://a.com', opts)).rejects.toThrow(LockedError);
    await expect(actions.setSchedule({ enabled: false, windows: [] }, opts)).rejects.toThrow(LockedError);
    await expect(actions.resetAll(opts)).rejects.toThrow(LockedError);
  });

  it('still allows tightening and cosmetic changes', async () => {
    await withFocus();
    const opts = { now: NOW + MIN };
    await actions.addRuleFromInput('b.com', opts);
    await actions.updateSettings({ theme: 'dark', tempAccess: { delaySeconds: 60 } }, opts);
    const s = await loadState();
    expect(s.rules[0].value).toBe('b.com');
    expect(s.settings.theme).toBe('dark');
    expect(s.settings.tempAccess.delaySeconds).toBe(60);
  });

  it('unlocks when the session ends or lock is off', async () => {
    await withFocus(false);
    await actions.endFocus({ now: NOW + MIN });
    expect((await loadState()).focus).toBeNull();
    await actions.startFocus(1, { now: NOW });
    await actions.updateSettings({ enabled: false }, { now: NOW + 2 * MIN });
  });
});

describe('focus, pause, temporary access', () => {
  it('startFocus clears pause and temp access and remembers duration', async () => {
    await actions.pauseBlocking(10, { now: NOW });
    await actions.grantTempAccess('https://a.com', { now: NOW });
    await actions.startFocus(50, { now: NOW });
    const s = await loadState();
    expect(s.focus).toEqual({ startedAt: NOW, endsAt: NOW + 50 * MIN });
    expect(s.pause).toBeNull();
    expect(s.tempAccess).toEqual([]);
    expect(s.settings.focusMinutes).toBe(50);
    await expect(actions.startFocus(5, { now: NOW })).rejects.toThrow(/already/);
  });

  it('validates durations', async () => {
    await expect(actions.startFocus(0)).rejects.toThrow();
    await expect(actions.startFocus('abc')).rejects.toThrow();
    await expect(actions.pauseBlocking(-1)).rejects.toThrow();
  });

  it('pause and resume; enabling cancels a pause', async () => {
    await actions.pauseBlocking(15, { now: NOW });
    expect((await loadState()).pause).toEqual({ until: NOW + 15 * MIN });
    await actions.resumeBlocking();
    expect((await loadState()).pause).toBeNull();
    await actions.pauseBlocking(15, { now: NOW });
    await actions.updateSettings({ enabled: true });
    expect((await loadState()).pause).toBeNull();
  });

  it('temporary access uses configured minutes, replaces existing grant for the host', async () => {
    await actions.updateSettings({ tempAccess: { minutes: 3 } });
    await actions.grantTempAccess('https://www.reddit.com/r/x', { now: NOW });
    await actions.grantTempAccess('https://reddit.com/', { now: NOW + MIN });
    expect((await loadState()).tempAccess).toEqual([{ host: 'reddit.com', until: NOW + 4 * MIN }]);
  });

  it('temporary access can be disabled', async () => {
    await actions.updateSettings({ tempAccess: { enabled: false } });
    await expect(actions.grantTempAccess('https://a.com')).rejects.toThrow(/turned off/);
  });
});

describe('schedule, stats, backup', () => {
  it('setSchedule drops invalid windows', async () => {
    await actions.setSchedule({
      enabled: true,
      windows: [
        { days: [5, 1], start: '09:00', end: '17:00' },
        { days: [], start: '09:00', end: '17:00' },
      ],
    });
    const { schedule } = await loadState();
    expect(schedule.enabled).toBe(true);
    expect(schedule.windows).toHaveLength(1);
    expect(schedule.windows[0].days).toEqual([1, 5]);
  });

  it('records and clears stats', async () => {
    await actions.recordBlock('a.com', { now: NOW });
    await actions.recordBlock('a.com', { now: NOW });
    expect((await loadState()).stats[dateKey(NOW)]).toEqual({ 'a.com': 2 });
    await actions.clearStats();
    expect((await loadState()).stats).toEqual({});
  });

  it('imports by merge and by replace', async () => {
    await actions.addRuleFromInput('a.com');
    const backup = buildExport({
      ...(await loadState()),
      rules: [{ id: 'x', type: 'domain', value: 'a.com', enabled: true, createdAt: 0 }, { id: 'y', type: 'domain', value: 'b.com', enabled: true, createdAt: 0 }],
    });
    expect(await actions.importBackup(JSON.stringify(backup))).toEqual({ rules: 1, allowlist: 0 });
    expect((await loadState()).rules.map((r) => r.value).sort()).toEqual(['a.com', 'b.com']);
    await actions.importBackup(['z.com'], { mode: 'replace' });
    expect((await loadState()).rules.map((r) => r.value)).toEqual(['z.com']);
  });

  it('resetAll restores defaults', async () => {
    await actions.addRuleFromInput('a.com');
    await actions.resetAll();
    expect((await loadState()).rules).toEqual([]);
  });
});
