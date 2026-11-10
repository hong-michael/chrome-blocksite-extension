import { describe, expect, it } from 'vitest';
import { createDefaultState } from '../../src/lib/defaults.js';
import { computeEffective, evaluateUrl, isLocked, nextChangeTime, pruneExpired } from '../../src/lib/state.js';

const NOW = new Date(2026, 10, 9, 10, 0).getTime(); // Monday 10:00
const MIN = 60000;

function make(over = {}) {
  const s = createDefaultState();
  return { ...s, ...over, settings: { ...s.settings, ...(over.settings ?? {}) } };
}
const r = (type, value, enabled = true) => ({ id: value, type, value, enabled, createdAt: 0 });

describe('computeEffective precedence', () => {
  it('is active by default', () => {
    expect(computeEffective(make(), NOW)).toEqual({ active: true, reason: 'always', until: null });
  });
  it('master switch off disables', () => {
    expect(computeEffective(make({ settings: { enabled: false } }), NOW).reason).toBe('disabled');
  });
  it('pause disables until it expires', () => {
    expect(computeEffective(make({ pause: { until: NOW + MIN } }), NOW)).toEqual({ active: false, reason: 'paused', until: NOW + MIN });
    expect(computeEffective(make({ pause: { until: NOW - 1 } }), NOW).active).toBe(true);
  });
  it('schedule decides when enabled', () => {
    const schedule = { enabled: true, windows: [{ days: [1], start: '09:00', end: '11:00' }] };
    expect(computeEffective(make({ schedule }), NOW)).toMatchObject({ active: true, reason: 'schedule' });
    expect(computeEffective(make({ schedule }), NOW + 2 * 60 * MIN)).toMatchObject({ active: false, reason: 'outside-schedule' });
  });
  it('focus beats everything', () => {
    const s = make({ settings: { enabled: false }, pause: { until: NOW + MIN }, focus: { startedAt: NOW, endsAt: NOW + 5 * MIN } });
    expect(computeEffective(s, NOW)).toEqual({ active: true, reason: 'focus', until: NOW + 5 * MIN });
  });
});

describe('isLocked', () => {
  it('only during focus with lockDuringFocus', () => {
    const focus = { startedAt: NOW, endsAt: NOW + MIN };
    expect(isLocked(make({ focus }), NOW)).toBe(true);
    expect(isLocked(make({ focus, settings: { lockDuringFocus: false } }), NOW)).toBe(false);
    expect(isLocked(make({ focus }), NOW + MIN)).toBe(false);
    expect(isLocked(make(), NOW)).toBe(false);
  });
});

describe('evaluateUrl', () => {
  it('blocks matching rules in block mode', () => {
    const s = make({ rules: [r('domain', 'reddit.com')] });
    expect(evaluateUrl(s, 'https://old.reddit.com/', NOW)).toMatchObject({ blocked: true, why: 'list' });
    expect(evaluateUrl(s, 'https://example.com/', NOW).blocked).toBe(false);
  });
  it('blocks everything not allowed in allow mode', () => {
    const s = make({ settings: { mode: 'allow' }, allowlist: [r('domain', 'github.com')] });
    expect(evaluateUrl(s, 'https://github.com/x', NOW).blocked).toBe(false);
    expect(evaluateUrl(s, 'https://gist.github.com/', NOW).blocked).toBe(false);
    expect(evaluateUrl(s, 'https://reddit.com/', NOW)).toMatchObject({ blocked: true, why: 'allowlist' });
    expect(evaluateUrl(s, 'chrome://newtab', NOW).blocked).toBe(false);
  });
  it('respects temporary access and inactive state', () => {
    const s = make({ rules: [r('domain', 'reddit.com')], tempAccess: [{ host: 'reddit.com', until: NOW + MIN }] });
    expect(evaluateUrl(s, 'https://reddit.com/', NOW).blocked).toBe(false);
    expect(evaluateUrl(s, 'https://reddit.com/', NOW + MIN).blocked).toBe(true);
    expect(evaluateUrl({ ...s, tempAccess: [], pause: { until: NOW + MIN } }, 'https://reddit.com/', NOW).blocked).toBe(false);
  });
});

describe('pruneExpired', () => {
  it('returns null patch when nothing expired', () => {
    expect(pruneExpired(make({ pause: { until: NOW + 1 } }), NOW)).toEqual({ patch: null, focusEnded: false });
  });
  it('clears expired focus, pause and temp access', () => {
    const s = make({
      focus: { startedAt: 0, endsAt: NOW },
      pause: { until: NOW - 5 },
      tempAccess: [{ host: 'a.com', until: NOW - 1 }, { host: 'b.com', until: NOW + 1 }],
    });
    const { patch, focusEnded } = pruneExpired(s, NOW);
    expect(focusEnded).toBe(true);
    expect(patch).toEqual({ focus: null, pause: null, tempAccess: [{ host: 'b.com', until: NOW + 1 }] });
  });
});

describe('nextChangeTime', () => {
  it('is the earliest pending expiry', () => {
    const s = make({ pause: { until: NOW + 10 * MIN }, tempAccess: [{ host: 'a.com', until: NOW + 3 * MIN }] });
    expect(nextChangeTime(s, NOW)).toBe(NOW + 3 * MIN);
  });
  it('includes schedule boundaries', () => {
    const s = make({ schedule: { enabled: true, windows: [{ days: [1], start: '09:00', end: '11:00' }] } });
    expect(nextChangeTime(s, NOW)).toBe(new Date(2026, 10, 9, 11, 0).getTime());
  });
  it('is null when nothing is pending', () => {
    expect(nextChangeTime(make(), NOW)).toBeNull();
  });
});
