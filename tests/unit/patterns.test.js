import { describe, expect, it } from 'vitest';
import {
  RuleInputError,
  describeRule,
  displayHost,
  findMatchingRule,
  normalizeHost,
  parseBulkInput,
  parseRuleInput,
  ruleMatchesUrl,
} from '../../src/lib/patterns.js';

describe('normalizeHost', () => {
  it.each([
    ['Reddit.com', 'reddit.com'],
    ['www.youtube.com', 'youtube.com'],
    ['  news.ycombinator.com. ', 'news.ycombinator.com'],
    ['bücher.de', 'xn--bcher-kva.de'],
    ['localhost', 'localhost'],
    ['192.168.0.1', '192.168.0.1'],
  ])('%s → %s', (input, expected) => expect(normalizeHost(input)).toBe(expected));

  it.each(['', 'reddit', 'a b.com', '-bad.com', 'bad-.com', 'reddit.com/x', '999.1.1.1', 'user@host.com'])(
    'rejects %j',
    (input) => expect(normalizeHost(input)).toBeNull(),
  );
});

describe('parseRuleInput (auto)', () => {
  it.each([
    ['reddit.com', { type: 'domain', value: 'reddit.com' }],
    ['https://www.reddit.com/', { type: 'domain', value: 'reddit.com' }],
    ['https://www.reddit.com/?utm=1#top', { type: 'domain', value: 'reddit.com' }],
    ['youtube.com/shorts', { type: 'path', value: 'youtube.com/shorts' }],
    ['https://www.YouTube.com/Shorts/abc/?x=1', { type: 'path', value: 'youtube.com/shorts/abc' }],
    ['reddit.com/r/all/', { type: 'path', value: 'reddit.com/r/all' }],
    ['casino', { type: 'keyword', value: 'casino' }],
    ['Poker', { type: 'keyword', value: 'poker' }],
    ['localhost:3000', { type: 'domain', value: 'localhost' }],
  ])('%s', (input, expected) => expect(parseRuleInput(input)).toEqual(expected));

  it('honours an explicit type', () => {
    expect(parseRuleInput('youtube.com/shorts', 'domain')).toEqual({ type: 'domain', value: 'youtube.com' });
    expect(parseRuleInput('youtube.com', 'path')).toEqual({ type: 'domain', value: 'youtube.com' });
    expect(parseRuleInput('example.com', 'keyword')).toEqual({ type: 'keyword', value: 'example.com' });
  });

  it.each(['', '   ', 'two words', 'a', 'ftp://example.com', 'http://', '<script>'])('rejects %j', (input) => {
    expect(() => parseRuleInput(input)).toThrow(RuleInputError);
  });
});

describe('parseBulkInput', () => {
  it('splits lines and commas, skips comments and dedupes, collects errors', () => {
    const { rules, errors } = parseBulkInput('reddit.com, x.com\n# comment\nwww.reddit.com\n\nbad input here\ncasino');
    expect(rules).toEqual([
      { type: 'domain', value: 'reddit.com' },
      { type: 'domain', value: 'x.com' },
      { type: 'keyword', value: 'casino' },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0].input).toBe('bad input here');
  });
});

describe('ruleMatchesUrl', () => {
  const domain = { type: 'domain', value: 'x.com' };
  const path = { type: 'path', value: 'youtube.com/shorts' };
  const kw = { type: 'keyword', value: 'casino' };

  it('domain rules match the domain and subdomains only', () => {
    expect(ruleMatchesUrl(domain, 'https://x.com/home')).toBe(true);
    expect(ruleMatchesUrl(domain, 'https://mobile.x.com/')).toBe(true);
    expect(ruleMatchesUrl(domain, 'http://X.COM:8080/')).toBe(true);
    // v1 bug: hostname.includes('x.com') also blocked netflix.com
    expect(ruleMatchesUrl(domain, 'https://netflix.com/')).toBe(false);
    expect(ruleMatchesUrl(domain, 'https://x.com.evil.org/')).toBe(false);
  });

  it('path rules match the prefix on a segment boundary', () => {
    expect(ruleMatchesUrl(path, 'https://www.youtube.com/shorts')).toBe(true);
    expect(ruleMatchesUrl(path, 'https://www.youtube.com/shorts/abc?x=1')).toBe(true);
    expect(ruleMatchesUrl(path, 'https://m.youtube.com/SHORTS/abc')).toBe(true);
    expect(ruleMatchesUrl(path, 'https://www.youtube.com/shortsfeed')).toBe(false);
    expect(ruleMatchesUrl(path, 'https://www.youtube.com/watch?v=shorts')).toBe(false);
    expect(ruleMatchesUrl(path, 'https://notyoutube.com/shorts')).toBe(false);
  });

  it('keyword rules match anywhere but the fragment', () => {
    expect(ruleMatchesUrl(kw, 'https://best-casino.com/')).toBe(true);
    expect(ruleMatchesUrl(kw, 'https://example.com/search?q=CASINO')).toBe(true);
    expect(ruleMatchesUrl(kw, 'https://example.com/#casino')).toBe(false);
  });

  it('never matches non-http URLs', () => {
    expect(ruleMatchesUrl(domain, 'chrome://x.com')).toBe(false);
    expect(ruleMatchesUrl(kw, 'chrome-extension://abc/casino.html')).toBe(false);
    expect(ruleMatchesUrl(domain, 'not a url')).toBe(false);
  });
});

describe('findMatchingRule', () => {
  it('skips disabled rules', () => {
    const rules = [
      { id: '1', type: 'domain', value: 'reddit.com', enabled: false },
      { id: '2', type: 'keyword', value: 'reddit', enabled: true },
    ];
    expect(findMatchingRule(rules, 'https://reddit.com/').id).toBe('2');
    expect(findMatchingRule(rules, 'https://example.com/')).toBeNull();
  });
});

describe('helpers', () => {
  it('displayHost strips www and rejects non-http', () => {
    expect(displayHost('https://www.Reddit.com/r/x')).toBe('reddit.com');
    expect(displayHost('chrome://extensions')).toBeNull();
  });
  it('describeRule', () => {
    expect(describeRule({ type: 'domain', value: 'a.com' })).toMatch(/subdomains/);
    expect(describeRule({ type: 'path', value: 'a.com/b' })).toMatch(/under it/);
    expect(describeRule({ type: 'keyword', value: 'x' })).toMatch(/containing/);
  });
});
