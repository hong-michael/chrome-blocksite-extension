import { describe, expect, it } from 'vitest';
import { CATCH_ALL_REGEX, PRIORITY, buildDnrRules, keywordRuleRegex, pathRuleRegex } from '../../src/lib/dnr.js';
import { ruleMatchesUrl } from '../../src/lib/patterns.js';
import { createDefaultState } from '../../src/lib/defaults.js';

const BASE = 'chrome-extension://id/pages/blocked/blocked.html';
const ACTIVE = { active: true, reason: 'always', until: null };
const NOW = 1_700_000_000_000;

function stateWith(overrides = {}) {
  const s = createDefaultState();
  return { ...s, ...overrides, settings: { ...s.settings, ...(overrides.settings ?? {}) } };
}
const rule = (type, value, enabled = true) => ({ id: `${type}:${value}`, type, value, enabled, createdAt: 0 });

// Simulate DNR's matching closely enough to check our rules: requestDomains + regexFilter (case-insensitive).
function dnrMatches(r, url) {
  const u = new URL(url);
  const host = u.hostname.toLowerCase();
  const c = r.condition;
  if (c.requestDomains && !c.requestDomains.some((d) => host === d || host.endsWith(`.${d}`))) return false;
  if (c.regexFilter) {
    const withoutHash = url.split('#')[0];
    if (!new RegExp(c.regexFilter, 'i').test(withoutHash)) return false;
  }
  return true;
}

describe('buildDnrRules', () => {
  it('returns no rules when blocking is inactive', () => {
    const state = stateWith({ rules: [rule('domain', 'a.com')] });
    expect(buildDnrRules(state, { active: false }, BASE, NOW)).toEqual([]);
  });

  it('combines all domain rules into one rule and adds regex rules for paths/keywords', () => {
    const state = stateWith({
      rules: [rule('domain', 'a.com'), rule('domain', 'b.com'), rule('domain', 'off.com', false), rule('path', 'c.com/x'), rule('keyword', 'poker')],
    });
    const rules = buildDnrRules(state, ACTIVE, BASE, NOW);
    expect(rules).toHaveLength(3);
    expect(rules[0].condition.requestDomains).toEqual(['a.com', 'b.com']);
    expect(rules[0].condition.regexFilter).toBe(CATCH_ALL_REGEX);
    expect(rules.every((r) => r.action.type === 'redirect' && r.priority === PRIORITY.block)).toBe(true);
    expect(rules.every((r) => r.condition.resourceTypes.join() === 'main_frame')).toBe(true);
    expect(rules[0].action.redirect.regexSubstitution).toBe(`${BASE}#\\0`);
    expect(new Set(rules.map((r) => r.id)).size).toBe(rules.length);
  });

  it('allow-list mode blocks everything except allowed domains', () => {
    const state = stateWith({ settings: { mode: 'allow' }, allowlist: [rule('domain', 'docs.google.com')], rules: [rule('domain', 'ignored.com')] });
    const rules = buildDnrRules(state, ACTIVE, BASE, NOW);
    expect(rules).toHaveLength(2);
    expect(rules[0].condition.regexFilter).toBe(CATCH_ALL_REGEX);
    expect(rules[1]).toMatchObject({ priority: PRIORITY.allowlist, action: { type: 'allow' }, condition: { requestDomains: ['docs.google.com'] } });
  });

  it('adds a high-priority allow rule for unexpired temporary access', () => {
    const state = stateWith({
      rules: [rule('domain', 'a.com')],
      tempAccess: [
        { host: 'a.com', until: NOW + 1000 },
        { host: 'old.com', until: NOW - 1 },
      ],
    });
    const rules = buildDnrRules(state, ACTIVE, BASE, NOW);
    const temp = rules.find((r) => r.priority === PRIORITY.temp);
    expect(temp.condition.requestDomains).toEqual(['a.com']);
    expect(PRIORITY.temp).toBeGreaterThan(PRIORITY.allowlist);
  });
});

describe('generated regexes agree with the JS matcher', () => {
  const urls = [
    'https://youtube.com/shorts',
    'https://www.youtube.com/shorts/abc',
    'https://m.youtube.com/shorts?feature=x',
    'http://youtube.com:8080/shorts/',
    'https://youtube.com/shortsfeed',
    'https://youtube.com/watch?v=1',
    'https://notyoutube.com/shorts',
    'https://youtube.com.evil.com/shorts',
    'https://example.com/?q=poker',
    'https://POKER.example.com/',
    'https://example.com/#poker',
    'https://reddit.com/r/all',
    'https://reddit.com/r/allthings',
    'https://www.reddit.com/r/all/top?t=day',
    'https://a.b.c.d.example.co.uk/deep/path',
  ];
  const rules = [
    rule('path', 'youtube.com/shorts'),
    rule('path', 'reddit.com/r/all'),
    rule('keyword', 'poker'),
    rule('domain', 'example.co.uk'),
    rule('domain', 'youtube.com'),
  ];

  for (const r of rules) {
    it(`${r.type} ${r.value}`, () => {
      const state = stateWith({ rules: [r] });
      const [dnr] = buildDnrRules(state, ACTIVE, BASE, NOW);
      for (const url of urls) {
        expect(dnrMatches(dnr, url), url).toBe(ruleMatchesUrl(r, url));
      }
    });
  }

  it('regexes capture the whole URL for the redirect substitution', () => {
    const url = 'https://www.youtube.com/shorts/abc?x=1&y=2';
    expect(new RegExp(pathRuleRegex('youtube.com/shorts')).exec(url)[0]).toBe(url);
    expect(new RegExp(keywordRuleRegex('abc')).exec(url)[0]).toBe(url);
    expect(new RegExp(CATCH_ALL_REGEX).exec(url)[0]).toBe(url);
  });

  it('escapes regex metacharacters in values', () => {
    expect(pathRuleRegex('a.com/x.y')).toContain('a\\.com');
    expect(pathRuleRegex('a.com/x.y')).toContain('\\/x\\.y');
    expect(new RegExp(keywordRuleRegex('a.b')).test('https://axb.com/')).toBe(false);
  });
});
