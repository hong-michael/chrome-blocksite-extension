// Effective blocking state: combines master switch, focus session, pause and schedule.
import { isWithinSchedule, nextScheduleChange } from './schedule.js';
import { findMatchingRule, hostMatchesDomain, parseHttpUrl } from './patterns.js';

/**
 * @returns {{ active: boolean, reason: 'focus'|'disabled'|'paused'|'schedule'|'outside-schedule'|'always', until: number|null }}
 */
export function computeEffective(state, now) {
  if (isFocusActive(state, now)) return { active: true, reason: 'focus', until: state.focus.endsAt };
  if (!state.settings.enabled) return { active: false, reason: 'disabled', until: null };
  if (state.pause && state.pause.until > now) return { active: false, reason: 'paused', until: state.pause.until };
  if (state.schedule.enabled) {
    const inside = isWithinSchedule(state.schedule, now);
    return {
      active: inside,
      reason: inside ? 'schedule' : 'outside-schedule',
      until: nextScheduleChange(state.schedule, now),
    };
  }
  return { active: true, reason: 'always', until: null };
}

export function isFocusActive(state, now) {
  return Boolean(state.focus && state.focus.endsAt > now);
}

/** Settings are locked while a focus session runs with "lock during focus" on. */
export function isLocked(state, now) {
  return isFocusActive(state, now) && state.settings.lockDuringFocus;
}

export function activeTempAccess(state, host, now) {
  return state.tempAccess.find((t) => t.until > now && hostMatchesDomain(host, t.host)) ?? null;
}

/**
 * Should this URL be blocked right now?
 * @returns {{ blocked: boolean, rule: object|null, why: 'list'|'allowlist'|null }}
 */
export function evaluateUrl(state, url, now, effective = computeEffective(state, now)) {
  const none = { blocked: false, rule: null, why: null };
  if (!effective.active) return none;
  const u = parseHttpUrl(url);
  if (!u) return none;
  const host = u.hostname.toLowerCase();
  if (activeTempAccess(state, host, now)) return none;
  if (state.settings.mode === 'allow') {
    const allowed = state.allowlist.some((r) => r.enabled !== false && hostMatchesDomain(host, r.value));
    return allowed ? none : { blocked: true, rule: null, why: 'allowlist' };
  }
  const rule = findMatchingRule(state.rules, u);
  return rule ? { blocked: true, rule, why: 'list' } : none;
}

/** Remove expired pause / focus / temp access. Returns { patch, focusEnded } (patch null if nothing changed). */
export function pruneExpired(state, now) {
  const patch = {};
  let focusEnded = false;
  if (state.focus && state.focus.endsAt <= now) {
    patch.focus = null;
    focusEnded = true;
  }
  if (state.pause && state.pause.until <= now) patch.pause = null;
  const temp = state.tempAccess.filter((t) => t.until > now);
  if (temp.length !== state.tempAccess.length) patch.tempAccess = temp;
  return { patch: Object.keys(patch).length ? patch : null, focusEnded };
}

/** Earliest future time at which the effective state or rules can change, or null. */
export function nextChangeTime(state, now) {
  const times = [];
  if (state.focus?.endsAt > now) times.push(state.focus.endsAt);
  if (state.pause?.until > now) times.push(state.pause.until);
  for (const t of state.tempAccess) if (t.until > now) times.push(t.until);
  if (state.schedule.enabled) {
    const t = nextScheduleChange(state.schedule, now);
    if (t) times.push(t);
  }
  return times.length ? Math.min(...times) : null;
}
