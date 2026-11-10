// Local block-attempt statistics: { 'YYYY-MM-DD': { host: count } }.

export const RETENTION_DAYS = 30;

export function dateKey(time) {
  const d = new Date(time);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function daysAgo(now, n) {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - n, 12).getTime();
}

/** Returns a new stats object with the attempt recorded and old days pruned. */
export function recordAttempt(stats, host, now) {
  const key = dateKey(now);
  const day = { ...(stats[key] ?? {}) };
  day[host] = (day[host] ?? 0) + 1;
  const cutoff = dateKey(daysAgo(now, RETENTION_DAYS - 1));
  const out = {};
  for (const [k, v] of Object.entries(stats)) if (k >= cutoff) out[k] = v;
  out[key] = day;
  return out;
}

export function countForHost(stats, host, now) {
  return stats[dateKey(now)]?.[host] ?? 0;
}

const sum = (obj) => Object.values(obj ?? {}).reduce((a, b) => a + b, 0);

/** Aggregates for the statistics view. */
export function summarize(stats, now, days = 7) {
  const series = [];
  const totals = {};
  for (let i = days - 1; i >= 0; i--) {
    const t = daysAgo(now, i);
    const key = dateKey(t);
    const day = stats[key] ?? {};
    series.push({
      key,
      label: new Date(t).toLocaleDateString(undefined, { weekday: 'short' }),
      count: sum(day),
    });
    for (const [h, c] of Object.entries(day)) totals[h] = (totals[h] ?? 0) + c;
  }
  const top = Object.entries(totals)
    .map(([host, count]) => ({ host, count }))
    .sort((a, b) => b.count - a.count || a.host.localeCompare(b.host))
    .slice(0, 8);
  let allTime = 0;
  for (const day of Object.values(stats)) allTime += sum(day);
  return { today: sum(stats[dateKey(now)]), week: series.reduce((a, s) => a + s.count, 0), series, top, allTime };
}
