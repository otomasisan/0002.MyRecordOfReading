import type { Dashboard, Milestone, Settings, StatsSource, YearStats } from '../shared/types';

// Dates are YYYY-MM-DD strings in local time; arithmetic is done in UTC so
// time zones and daylight saving never shift a day.
const DAY = 86_400_000;
const toNum = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / DAY;
const fromNum = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);

/** Current streak (ending today, or yesterday if nothing yet today) and the longest one. */
export function streaks(dates: Iterable<string>, today: string): { current: number; longest: number } {
  const days = [...new Set(dates)].map(toNum).sort((a, b) => a - b);
  let longest = 0;
  let run = 0;
  for (let i = 0; i < days.length; i++) {
    run = i > 0 && days[i] === days[i - 1] + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  const set = new Set(days);
  let cursor = toNum(today);
  if (!set.has(cursor)) cursor -= 1;
  let current = 0;
  while (set.has(cursor)) {
    current++;
    cursor--;
  }
  return { current, longest };
}

function minutesByDate(src: StatsSource): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of src.sessions) m.set(s.date, (m.get(s.date) ?? 0) + s.minutes);
  return m;
}

const finishedReads = (src: StatsSource) => src.reads.filter((r) => r.status === 'done' && r.finishedOn);

// ---- milestones ----------------------------------------------------------

interface Def {
  key: string;
  label: string;
  value: (c: Counters) => number;
  target: number;
  unit: string;
}

interface Counters {
  finished: number;
  hours: number;
  longestStreak: number;
  rereads: number;
}

const DEFS: Def[] = [
  { key: 'books-1', label: 'はじめの1冊', value: (c) => c.finished, target: 1, unit: '冊' },
  ...[10, 30, 50, 100, 200].map((n) => ({ key: `books-${n}`, label: `${n}冊読了`, value: (c: Counters) => c.finished, target: n, unit: '冊' })),
  ...[10, 50, 100, 300, 500].map((n) => ({ key: `hours-${n}`, label: `累計${n}時間`, value: (c: Counters) => c.hours, target: n, unit: '時間' })),
  ...[7, 30, 100, 365].map((n) => ({ key: `streak-${n}`, label: `連続${n}日`, value: (c: Counters) => c.longestStreak, target: n, unit: '日' })),
  { key: 'reread-1', label: 'はじめての再読', value: (c) => c.rereads, target: 1, unit: '回' },
];

function counters(src: StatsSource, today: string): Counters {
  const done = finishedReads(src);
  return {
    finished: done.length,
    hours: Math.floor(src.sessions.reduce((a, s) => a + s.minutes, 0) / 60),
    longestStreak: streaks(src.sessions.map((s) => s.date), today).longest,
    rereads: done.filter((r) => r.roundNo >= 2).length,
  };
}

/** Keys of every milestone currently reached, including this year's goal. */
export function reachedMilestones(src: StatsSource, settings: Settings, today: string): string[] {
  const c = counters(src, today);
  const keys = DEFS.filter((d) => d.value(c) >= d.target).map((d) => d.key);
  const year = today.slice(0, 4);
  const thisYear = finishedReads(src).filter((r) => r.finishedOn!.startsWith(year)).length;
  if (settings.goalBooks > 0 && thisYear >= settings.goalBooks) keys.push(`goal-${year}`);
  return keys;
}

export function milestoneList(src: StatsSource, achieved: Record<string, string>, today: string): Milestone[] {
  const c = counters(src, today);
  const list: Milestone[] = DEFS.map((d) => {
    const v = d.value(c);
    return { key: d.key, label: d.label, achievedOn: achieved[d.key] ?? null, remaining: v >= d.target ? '' : `あと${d.target - v}${d.unit}` };
  });
  for (const [key, on] of Object.entries(achieved)) {
    if (key.startsWith('goal-')) list.push({ key, label: `${key.slice(5)}年の目標達成`, achievedOn: on, remaining: '' });
  }
  // Achieved first (newest first), then the next ones to aim for.
  const done = list.filter((m) => m.achievedOn).sort((a, b) => b.achievedOn!.localeCompare(a.achievedOn!));
  const next = list.filter((m) => !m.achievedOn && m.remaining);
  // Show only the nearest unreached step of each kind.
  const seen = new Set<string>();
  const nearest = next.filter((m) => {
    const kind = m.key.split('-')[0];
    if (seen.has(kind)) return false;
    seen.add(kind);
    return true;
  });
  return [...done, ...nearest];
}

export function labelOf(key: string): string {
  if (key.startsWith('goal-')) return `${key.slice(5)}年の目標達成`;
  return DEFS.find((d) => d.key === key)?.label ?? key;
}

// ---- dashboard -------------------------------------------------------------

/** One saved takeaway, the same one all day. */
export function pickRecall(takeaways: StatsSource['takeaways'], today: string) {
  if (!takeaways.length) return null;
  const t = takeaways[toNum(today) % takeaways.length];
  return { text: t.text, title: t.title };
}

export function dashboard(src: StatsSource, settings: Settings, today: string): Omit<Dashboard, 'newMilestones'> {
  const byDate = minutesByDate(src);
  const year = Number(today.slice(0, 4));
  const ym = today.slice(0, 7);
  const lastMonth = fromNum(toNum(`${ym}-01`) - 1).slice(0, 7);
  const sumWhere = (pred: (d: string) => boolean) => [...byDate].filter(([d]) => pred(d)).reduce((a, [, m]) => a + m, 0);
  const finishedThisYear = finishedReads(src).filter((r) => r.finishedOn!.startsWith(String(year))).length;
  const dayOfYear = toNum(today) - toNum(`${year}-01-01`) + 1;
  const daysInYear = toNum(`${year + 1}-01-01`) - toNum(`${year}-01-01`);
  const { current, longest } = streaks(byDate.keys(), today);
  return {
    todayMinutes: byDate.get(today) ?? 0,
    streak: current,
    longestStreak: longest,
    year,
    finishedThisYear,
    minutesThisYear: sumWhere((d) => d.startsWith(String(year))),
    projectedBooks: Math.round((finishedThisYear / dayOfYear) * daysInYear),
    thisMonthMinutes: sumWhere((d) => d.startsWith(ym)),
    lastMonthMinutes: sumWhere((d) => d.startsWith(lastMonth)),
    settings,
    recall: pickRecall(src.takeaways, today),
  };
}

// ---- statistics screen -----------------------------------------------------

export function yearStats(src: StatsSource, year: number, today: string, achieved: Record<string, string>): YearStats {
  const inPeriod = (d: string | null) => !!d && (year === 0 || d.startsWith(String(year)));
  const sessions = src.sessions.filter((s) => inPeriod(s.date));
  const finished = finishedReads(src).filter((r) => inPeriod(r.finishedOn));

  const years = [...new Set([...src.sessions.map((s) => s.date), ...finishedReads(src).map((r) => r.finishedOn!)].map((d) => Number(d.slice(0, 4))))];
  if (!years.includes(Number(today.slice(0, 4)))) years.push(Number(today.slice(0, 4)));
  years.sort((a, b) => b - a);

  const bars =
    year === 0
      ? [...years].reverse().map((y) => ({
          label: `${y}年`,
          minutes: src.sessions.filter((s) => s.date.startsWith(String(y))).reduce((a, s) => a + s.minutes, 0),
          finished: finishedReads(src).filter((r) => r.finishedOn!.startsWith(String(y))).length,
        }))
      : Array.from({ length: 12 }, (_, i) => {
          const p = `${year}-${String(i + 1).padStart(2, '0')}`;
          return {
            label: `${i + 1}月`,
            minutes: sessions.filter((s) => s.date.startsWith(p)).reduce((a, s) => a + s.minutes, 0),
            finished: finished.filter((r) => r.finishedOn!.startsWith(p)).length,
          };
        });

  const titles = new Map(src.books.map((b) => [b.id, b.title]));
  const bookMinutes = new Map<number, number>();
  for (const s of sessions) bookMinutes.set(s.bookId, (bookMinutes.get(s.bookId) ?? 0) + s.minutes);
  const bookIds = new Set([...bookMinutes.keys(), ...finished.map((r) => r.bookId)]);
  const byBook = [...bookIds]
    .map((id) => ({
      bookId: id,
      title: titles.get(id) ?? '',
      minutes: bookMinutes.get(id) ?? 0,
      timesRead: finished.filter((r) => r.bookId === id).length,
    }))
    .sort((a, b) => b.minutes - a.minutes || b.timesRead - a.timesRead);

  // A book with several tags counts towards each of them.
  const tagMap = new Map<string, { minutes: number; books: Set<number> }>();
  for (const { bookId, tag } of src.tags) {
    if (!bookIds.has(bookId)) continue;
    const e = tagMap.get(tag) ?? { minutes: 0, books: new Set<number>() };
    e.minutes += bookMinutes.get(bookId) ?? 0;
    e.books.add(bookId);
    tagMap.set(tag, e);
  }
  const byTag = [...tagMap].map(([tag, e]) => ({ tag, minutes: e.minutes, books: e.books.size })).sort((a, b) => b.minutes - a.minutes || b.books - a.books || (a.tag < b.tag ? -1 : 1));

  const ratings = [0, 0, 0, 0, 0];
  for (const r of finished) if (r.rating) ratings[r.rating - 1]++;
  const rated = finished.filter((r) => r.rating);
  const avgRating = rated.length ? Math.round((rated.reduce((a, r) => a + r.rating!, 0) / rated.length) * 10) / 10 : null;

  // Calendar: the chosen year, or the last 365 days for all time.
  const byDate = minutesByDate(src);
  const end = year === 0 || String(year) === today.slice(0, 4) ? toNum(today) : toNum(`${year}-12-31`);
  const start = year === 0 ? end - 364 : toNum(`${year}-01-01`);
  const calendar = [];
  for (let n = start; n <= end; n++) {
    const d = fromNum(n);
    calendar.push({ date: d, minutes: byDate.get(d) ?? 0 });
  }

  const { current, longest } = streaks(byDate.keys(), today);
  return {
    year,
    years,
    finished: finished.length,
    minutes: sessions.reduce((a, s) => a + s.minutes, 0),
    avgRating,
    bars,
    byBook,
    byTag,
    ratings,
    calendar,
    streak: current,
    longestStreak: longest,
    milestones: milestoneList(src, achieved, today),
  };
}

// ---- CSV -----------------------------------------------------------------

export function toCsv(rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // BOM so Excel opens the Japanese text correctly.
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
