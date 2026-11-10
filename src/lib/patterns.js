// Parsing user input into rules, and matching URLs against rules in JS.
// The JS matcher must agree with the regexes generated in dnr.js — see dnr.test.js.

export const RULE_TYPES = ['domain', 'path', 'keyword'];

const HOST_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const KEYWORD_RE = /^[\p{L}\p{N}._~\-]{2,64}$/u;

export class RuleInputError extends Error {}

/** Lowercase, punycode, strip trailing dot and leading `www.`. Returns null if invalid. */
export function normalizeHost(input) {
  if (typeof input !== 'string') return null;
  let host = input.trim().toLowerCase().replace(/\.$/, '');
  if (!host || /[\s/?#@:]/.test(host)) return null;
  try {
    host = new URL(`http://${host}`).hostname;
  } catch {
    return null;
  }
  host = host.replace(/^www\./, '');
  if (host === 'localhost') return host;
  const labels = host.split('.');
  if (labels.length < 2 || !labels.every((l) => HOST_LABEL.test(l))) return null;
  if (/^\d+$/.test(labels.at(-1))) {
    // IPv4 address — allowed as-is.
    return labels.length === 4 && labels.every((l) => Number(l) <= 255) ? host : null;
  }
  return host;
}

/** Path prefix normalisation: leading slash, no trailing slash, no query/hash, lowercase. */
function normalizePath(path) {
  let p = path.split(/[?#]/)[0].toLowerCase();
  p = p.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  if (p && !p.startsWith('/')) p = `/${p}`;
  return p;
}

/** Split a host/URL-ish string into { host, path }. Returns null if it isn't URL-ish. */
function splitUrlish(raw) {
  let s = raw.trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `http://${s}`;
  let url;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  const host = normalizeHost(url.hostname);
  if (!host) return null;
  return { host, path: normalizePath(url.pathname) };
}

/**
 * Turn user input into a rule `{ type, value }`.
 * `type` may be 'auto' (default): no dot → keyword, has a path → path, else domain.
 * Throws RuleInputError with a user-facing message on invalid input.
 */
export function parseRuleInput(input, type = 'auto') {
  const raw = String(input ?? '').trim();
  if (!raw) throw new RuleInputError('Enter a site, page or keyword.');

  if (type === 'auto') {
    const looksLikeHost = raw.includes('.') || raw.includes('://') || /^localhost(?=$|[:/])/i.test(raw);
    if (!looksLikeHost) type = 'keyword';
    else {
      const parts = splitUrlish(raw);
      type = parts && parts.path ? 'path' : 'domain';
    }
  }

  if (type === 'keyword') {
    const kw = raw.toLowerCase();
    if (!KEYWORD_RE.test(kw)) {
      throw new RuleInputError('Keywords must be 2–64 letters, numbers, dots or dashes, with no spaces.');
    }
    return { type, value: kw };
  }

  const parts = splitUrlish(raw);
  if (!parts) throw new RuleInputError(`“${raw}” doesn't look like a valid website.`);
  if (type === 'domain') return { type, value: parts.host };
  if (type === 'path') {
    if (!parts.path) return { type: 'domain', value: parts.host };
    return { type, value: parts.host + parts.path };
  }
  throw new RuleInputError(`Unknown rule type “${type}”.`);
}

/** Parse many lines/commas of input; returns { rules, errors }. */
export function parseBulkInput(text, type = 'auto') {
  const rules = [];
  const errors = [];
  const seen = new Set();
  for (const line of String(text ?? '').split(/[\n,]+/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    try {
      const rule = parseRuleInput(trimmed, type);
      const key = `${rule.type}:${rule.value}`;
      if (!seen.has(key)) {
        seen.add(key);
        rules.push(rule);
      }
    } catch (e) {
      errors.push({ input: trimmed, message: e.message });
    }
  }
  return { rules, errors };
}

/** True if `host` is `domain` or a subdomain of it. */
export function hostMatchesDomain(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

/** Parse a URL we might block. Returns null for non-http(s) or invalid URLs. */
export function parseHttpUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u;
  } catch {
    return null;
  }
}

/** Display host for a URL (lowercase, no `www.`), or null. */
export function displayHost(url) {
  const u = parseHttpUrl(url);
  return u ? u.hostname.toLowerCase().replace(/^www\./, '') : null;
}

/** Does a single rule match this URL? */
export function ruleMatchesUrl(rule, url) {
  const u = typeof url === 'string' ? parseHttpUrl(url) : url;
  if (!u) return false;
  const host = u.hostname.toLowerCase();
  switch (rule.type) {
    case 'domain':
      return hostMatchesDomain(host, rule.value);
    case 'path': {
      const slash = rule.value.indexOf('/');
      const domain = rule.value.slice(0, slash);
      const prefix = rule.value.slice(slash);
      if (!hostMatchesDomain(host, domain)) return false;
      const path = u.pathname.toLowerCase();
      if (!path.startsWith(prefix)) return false;
      const next = path.charAt(prefix.length);
      return next === '' || next === '/';
    }
    case 'keyword': {
      // Match on everything before the fragment (DNR never sees fragments).
      const href = u.href.toLowerCase().split('#')[0];
      return href.includes(rule.value);
    }
    default:
      return false;
  }
}

/** First enabled rule in `rules` matching `url`, or null. */
export function findMatchingRule(rules, url) {
  const u = typeof url === 'string' ? parseHttpUrl(url) : url;
  if (!u) return null;
  return rules.find((r) => r.enabled !== false && ruleMatchesUrl(r, u)) ?? null;
}

/** Human-readable label for a rule. */
export function describeRule(rule) {
  if (rule.type === 'keyword') return `URLs containing “${rule.value}”`;
  if (rule.type === 'path') return `${rule.value} and pages under it`;
  return `${rule.value} and its subdomains`;
}
