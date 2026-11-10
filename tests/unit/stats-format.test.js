import { describe, expect, it } from 'vitest';
import { RETENTION_DAYS, countForHost, dateKey, recordAttempt, summarize } from '../../src/lib/stats.js';
import { badgeMinutes, describeEffective, formatCountdown, formatMinutes } from '../../src/lib/format.js';
import { buildBlockUrl, isBlockPageUrl, originalUrlFrom } from '../../src/lib/blockurl.js';
import { QUOTES, pickQuote } from '../../src/lib/quotes.js';

const day = (n, h = 12) => new Date(2026, 10, 9 + n, h).getTime();

describe('stats', () => {
  it('records per host per day', () => {
    let s = {};
    s = recordAttempt(s, 'a.com', day(0));
    s = recordAttempt(s, 'a.com', day(0));
    s = recordAttempt(s, 'b.com', day(0));
    s = recordAttempt(s, 'a.com', day(1));
    expect(s[dateKey(day(0))]).toEqual({ 'a.com': 2, 'b.com': 1 });
    expect(countForHost(s, 'a.com', day(1))).toBe(1);
    expect(countForHost(s, 'zzz.com', day(1))).toBe(0);
  });

  it('prunes days beyond retention', () => {
    let s = recordAttempt({}, 'a.com', day(0));
    s = recordAttempt(s, 'a.com', day(RETENTION_DAYS - 1));
    expect(Object.keys(s)).toHaveLength(2);
    s = recordAttempt(s, 'a.com', day(RETENTION_DAYS));
    expect(Object.keys(s)).toHaveLength(2);
    expect(s[dateKey(day(0))]).toBeUndefined();
  });

  it('does not mutate its input', () => {
    const s = { [dateKey(day(0))]: { 'a.com': 1 } };
    recordAttempt(s, 'a.com', day(0));
    expect(s[dateKey(day(0))]['a.com']).toBe(1);
  });

  it('summarizes a week with top sites', () => {
    let s = {};
    for (let i = 0; i < 5; i++) s = recordAttempt(s, 'a.com', day(0));
    for (let i = 0; i < 3; i++) s = recordAttempt(s, 'b.com', day(-2));
    s = recordAttempt(s, 'c.com', day(-10));
    const sum = summarize(s, day(0));
    expect(sum.today).toBe(5);
    expect(sum.week).toBe(8);
    expect(sum.allTime).toBe(9);
    expect(sum.series).toHaveLength(7);
    expect(sum.series.at(-1).count).toBe(5);
    expect(sum.top).toEqual([{ host: 'a.com', count: 5 }, { host: 'b.com', count: 3 }]);
  });

  it('dateKey is local YYYY-MM-DD', () => {
    expect(dateKey(new Date(2026, 0, 5, 23, 59).getTime())).toBe('2026-01-05');
  });
});

describe('format', () => {
  it('formatCountdown', () => {
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(125000)).toBe('2:05');
    expect(formatCountdown(3725000)).toBe('1:02:05');
    expect(formatCountdown(-5)).toBe('0:00');
    expect(formatCountdown(1001)).toBe('0:02');
  });
  it('formatMinutes', () => {
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(60)).toBe('1 h');
    expect(formatMinutes(90)).toBe('1 h 30 min');
  });
  it('badgeMinutes fits in 4 chars', () => {
    expect(badgeMinutes(25 * 60000)).toBe('25m');
    expect(badgeMinutes(1)).toBe('1m');
    expect(badgeMinutes(150 * 60000)).toBe('3h');
  });
  it('describeEffective covers every reason', () => {
    for (const reason of ['focus', 'paused', 'disabled', 'schedule', 'outside-schedule', 'always']) {
      const d = describeEffective({ reason, until: Date.now() + 60000, active: true }, Date.now());
      expect(d.title).toBeTruthy();
      expect(d.detail).toBeTruthy();
    }
  });
});

describe('block url', () => {
  const base = 'chrome-extension://id/pages/blocked/blocked.html';
  it('round-trips raw and encoded URLs', () => {
    const url = 'https://reddit.com/r/all?x=1#frag';
    expect(originalUrlFrom(buildBlockUrl(base, url))).toBe(url);
    expect(originalUrlFrom(`#${encodeURIComponent(url)}`)).toBe(url);
    expect(originalUrlFrom('#javascript:alert(1)')).toBeNull();
    expect(originalUrlFrom('#%E0%A4%A')).toBeNull();
    expect(isBlockPageUrl(`${base}#x`, base)).toBe(true);
  });
});

describe('quotes', () => {
  it('picks deterministically', () => {
    expect(pickQuote(3)).toBe(QUOTES[3]);
    expect(QUOTES).toContain(pickQuote());
  });
});
