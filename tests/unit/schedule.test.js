import { describe, expect, it } from 'vitest';
import { formatDays, isValidWindow, isWithinSchedule, nextScheduleChange, parseTime } from '../../src/lib/schedule.js';

// 2026-11-09 is a Monday. Local time constructors keep tests timezone-independent.
const at = (day, h, m = 0) => new Date(2026, 10, 9 + day, h, m).getTime(); // day 0 = Mon

const weekdays9to5 = { enabled: true, windows: [{ id: 'w', days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' }] };
const overnight = { enabled: true, windows: [{ id: 'n', days: [5], start: '22:00', end: '02:00' }] }; // Fri night

describe('parseTime / isValidWindow', () => {
  it('parses HH:MM', () => {
    expect(parseTime('00:00')).toBe(0);
    expect(parseTime('23:59')).toBe(1439);
    expect(() => parseTime('24:00')).toThrow();
  });
  it('validates windows', () => {
    expect(isValidWindow(weekdays9to5.windows[0])).toBe(true);
    expect(isValidWindow({ days: [], start: '09:00', end: '10:00' })).toBe(false);
    expect(isValidWindow({ days: [7], start: '09:00', end: '10:00' })).toBe(false);
    expect(isValidWindow({ days: [1], start: '9:00', end: '10:00' })).toBe(false);
  });
});

describe('isWithinSchedule', () => {
  it('handles a normal daytime window', () => {
    expect(isWithinSchedule(weekdays9to5, at(0, 9))).toBe(true);
    expect(isWithinSchedule(weekdays9to5, at(0, 16, 59))).toBe(true);
    expect(isWithinSchedule(weekdays9to5, at(0, 17))).toBe(false);
    expect(isWithinSchedule(weekdays9to5, at(0, 8, 59))).toBe(false);
    expect(isWithinSchedule(weekdays9to5, at(5, 12))).toBe(false); // Saturday
  });

  it('handles overnight windows that belong to their start day', () => {
    expect(isWithinSchedule(overnight, at(4, 23))).toBe(true); // Fri 23:00
    expect(isWithinSchedule(overnight, at(5, 1, 30))).toBe(true); // Sat 01:30
    expect(isWithinSchedule(overnight, at(5, 2))).toBe(false);
    expect(isWithinSchedule(overnight, at(3, 23))).toBe(false); // Thu night
    expect(isWithinSchedule(overnight, at(0, 1))).toBe(false); // Mon 01:00 (Sun not in days)
  });

  it('treats start === end as the whole day', () => {
    const allDay = { enabled: true, windows: [{ days: [0], start: '00:00', end: '00:00' }] };
    expect(isWithinSchedule(allDay, at(6, 0))).toBe(true);
    expect(isWithinSchedule(allDay, at(6, 23, 59))).toBe(true);
    expect(isWithinSchedule(allDay, at(0, 0))).toBe(false);
  });

  it('is false with no windows', () => {
    expect(isWithinSchedule({ enabled: true, windows: [] }, at(0, 12))).toBe(false);
  });
});

describe('nextScheduleChange', () => {
  it('finds the end of the current window', () => {
    expect(nextScheduleChange(weekdays9to5, at(0, 10))).toBe(at(0, 17));
  });
  it('finds the next start, skipping the weekend', () => {
    expect(nextScheduleChange(weekdays9to5, at(4, 18))).toBe(at(7, 9)); // Fri 18:00 → Mon 09:00
  });
  it('handles overnight windows', () => {
    expect(nextScheduleChange(overnight, at(4, 12))).toBe(at(4, 22));
    expect(nextScheduleChange(overnight, at(4, 23))).toBe(at(5, 2));
  });
  it('merges adjacent windows', () => {
    const s = { enabled: true, windows: [
      { days: [1], start: '09:00', end: '12:00' },
      { days: [1], start: '12:00', end: '15:00' },
    ] };
    expect(nextScheduleChange(s, at(0, 10))).toBe(at(0, 15));
  });
  it('returns null when nothing ever changes', () => {
    expect(nextScheduleChange({ windows: [] }, at(0, 0))).toBeNull();
    const always = { windows: [{ days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '00:00' }] };
    expect(nextScheduleChange(always, at(0, 0))).toBeNull();
  });
});

describe('formatDays', () => {
  it.each([
    [[0, 1, 2, 3, 4, 5, 6], 'Every day'],
    [[1, 2, 3, 4, 5], 'Weekdays'],
    [[6, 0], 'Weekends'],
    [[1, 2, 3], 'Mon–Wed'],
    [[1, 3], 'Mon, Wed'],
    [[5, 6, 0], 'Fri–Sun'],
  ])('%j → %s', (days, label) => expect(formatDays(days)).toBe(label));
});
