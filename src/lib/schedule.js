// Weekly schedule windows. Days use Date#getDay() numbering (0 = Sunday).

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTime(t) {
  return typeof t === 'string' && TIME_RE.test(t);
}

/** 'HH:MM' → minutes since midnight. */
export function parseTime(t) {
  const m = TIME_RE.exec(t);
  if (!m) throw new Error(`Invalid time “${t}”`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function isValidWindow(w) {
  return (
    w &&
    Array.isArray(w.days) &&
    w.days.length > 0 &&
    w.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) &&
    isValidTime(w.start) &&
    isValidTime(w.end)
  );
}

/** Is `date` inside window `w`? start === end means the whole day. Overnight windows belong to their start day. */
export function isWithinWindow(w, date) {
  if (!isValidWindow(w)) return false;
  const start = parseTime(w.start);
  const end = parseTime(w.end);
  const day = date.getDay();
  const minute = date.getHours() * 60 + date.getMinutes();
  const today = w.days.includes(day);
  if (start === end) return today;
  if (start < end) return today && minute >= start && minute < end;
  const yesterday = w.days.includes((day + 6) % 7);
  return (today && minute >= start) || (yesterday && minute < end);
}

export function isWithinSchedule(schedule, now) {
  const date = now instanceof Date ? now : new Date(now);
  return (schedule?.windows ?? []).some((w) => isWithinWindow(w, date));
}

/**
 * Timestamp of the next moment the schedule flips between inside/outside, or null if it never does
 * (no valid windows, or e.g. a window covering every whole day).
 */
export function nextScheduleChange(schedule, now) {
  const windows = (schedule?.windows ?? []).filter(isValidWindow);
  if (!windows.length) return null;
  const current = isWithinSchedule(schedule, now);
  const base = new Date(now);
  const boundaries = [];
  for (let d = 0; d <= 8; d++) {
    const y = base.getFullYear();
    const mo = base.getMonth();
    const day = base.getDate() + d;
    boundaries.push(new Date(y, mo, day, 0, 0).getTime());
    for (const w of windows) {
      for (const t of [w.start, w.end]) {
        const mins = parseTime(t);
        boundaries.push(new Date(y, mo, day, Math.floor(mins / 60), mins % 60).getTime());
      }
    }
  }
  boundaries.sort((a, b) => a - b);
  for (const t of boundaries) {
    if (t > now && isWithinSchedule(schedule, t) !== current) return t;
  }
  return null;
}

/** "Mon–Fri", "Sat, Sun", "Every day" … */
export function formatDays(days) {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (sorted.length === 7) return 'Every day';
  const key = sorted.join(',');
  if (key === '1,2,3,4,5') return 'Weekdays';
  if (key === '0,6') return 'Weekends';
  // Collapse consecutive runs (Mon-first order).
  const order = [1, 2, 3, 4, 5, 6, 0].filter((d) => sorted.includes(d));
  const runs = [];
  for (const d of order) {
    const last = runs.at(-1);
    const idx = (x) => (x + 6) % 7;
    if (last && idx(d) === idx(last.at(-1)) + 1) last.push(d);
    else runs.push([d]);
  }
  return runs
    .map((r) => (r.length >= 3 ? `${DAY_NAMES[r[0]]}–${DAY_NAMES[r.at(-1)]}` : r.map((d) => DAY_NAMES[d]).join(', ')))
    .join(', ');
}
