// Build declarativeNetRequest dynamic rules from extension state. Pure: no chrome.* calls.

export const PRIORITY = { block: 1, allowlist: 2, temp: 3 };
const RESOURCE_TYPES = ['main_frame'];

/** Escape a literal for RE2 (the regex engine DNR uses). */
export function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

export const CATCH_ALL_REGEX = '^https?://.*$';

/** Regex matching a path rule like `youtube.com/shorts` (and subdomains, any port). */
export function pathRuleRegex(value) {
  const slash = value.indexOf('/');
  const domain = value.slice(0, slash);
  const prefix = value.slice(slash);
  return `^https?://([^/?#]*\\.)?${escapeRegex(domain)}(:[0-9]+)?${escapeRegex(prefix)}([/?#].*)?$`;
}

/** Regex matching a keyword anywhere before the fragment. */
export function keywordRuleRegex(value) {
  return `^https?://[^#]*${escapeRegex(value)}.*$`;
}

function redirectAction(blockPageUrl) {
  // \0 is the whole matched URL; every block regex spans the full URL.
  return { type: 'redirect', redirect: { regexSubstitution: `${blockPageUrl}#\\0` } };
}

/**
 * @param {object} state      normalised extension state
 * @param {object} effective  result of computeEffective()
 * @param {string} blockPageUrl  absolute chrome-extension:// URL of the block page
 * @param {number} now
 * @returns {chrome.declarativeNetRequest.Rule[]}
 */
export function buildDnrRules(state, effective, blockPageUrl, now) {
  if (!effective.active) return [];
  const rules = [];
  let id = 1;
  const push = (priority, action, condition) => {
    rules.push({
      id: id++,
      priority,
      action,
      condition: { resourceTypes: RESOURCE_TYPES, isUrlFilterCaseSensitive: false, ...condition },
    });
  };
  const block = redirectAction(blockPageUrl);

  if (state.settings.mode === 'allow') {
    push(PRIORITY.block, block, { regexFilter: CATCH_ALL_REGEX });
    const allowed = state.allowlist.filter((r) => r.enabled !== false).map((r) => r.value);
    if (allowed.length) push(PRIORITY.allowlist, { type: 'allow' }, { requestDomains: allowed });
  } else {
    const enabled = state.rules.filter((r) => r.enabled !== false);
    const domains = [...new Set(enabled.filter((r) => r.type === 'domain').map((r) => r.value))];
    if (domains.length) {
      push(PRIORITY.block, block, { regexFilter: CATCH_ALL_REGEX, requestDomains: domains });
    }
    for (const r of enabled) {
      if (r.type === 'path') push(PRIORITY.block, block, { regexFilter: pathRuleRegex(r.value) });
      else if (r.type === 'keyword') push(PRIORITY.block, block, { regexFilter: keywordRuleRegex(r.value) });
    }
  }

  const temp = [...new Set(state.tempAccess.filter((t) => t.until > now).map((t) => t.host))];
  if (temp.length) push(PRIORITY.temp, { type: 'allow' }, { requestDomains: temp });

  return rules;
}
