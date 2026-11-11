// Human-friendly time formatting.

/** 125000 → "2:05", 3725000 → "1:02:05". */
export function formatCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** 90 → "1 h 30 min", 45 → "45 min". */
export function formatMinutes(mins) {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Minutes left, rounded up, for the badge (max 4 chars). */
export function badgeMinutes(ms) {
  const mins = Math.max(1, Math.ceil(ms / 60000));
  return mins >= 100 ? `${Math.ceil(mins / 60)}h` : `${mins}m`;
}

/** "5:00 PM", or "Tue 9:00 AM" if not today. */
export function formatClock(time, now) {
  const d = new Date(time);
  const t = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const n = new Date(now);
  const sameDay = d.toDateString() === n.toDateString();
  return sameDay ? t : `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${t}`;
}

/** Short status line for an effective state, e.g. "Focus session · 12:04 left". */
export function describeEffective(eff, now) {
  switch (eff.reason) {
    case 'focus':
      return { title: 'Focus session', detail: `${formatCountdown(eff.until - now)} left` };
    case 'paused':
      return { title: 'Paused', detail: `Resumes in ${formatCountdown(eff.until - now)}` };
    case 'disabled':
      return { title: 'Blocking is off', detail: 'Turn it back on any time' };
    case 'schedule':
      return { title: 'Blocking on schedule', detail: eff.until ? `Until ${formatClock(eff.until, now)}` : 'Active' };
    case 'outside-schedule':
      return { title: 'Outside scheduled hours', detail: eff.until ? `Starts ${formatClock(eff.until, now)}` : 'Not blocking' };
    default:
      return { title: 'Blocking is on', detail: 'Distractions stay out' };
  }
}
