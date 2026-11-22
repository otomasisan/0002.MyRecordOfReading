import { describe, expect, it } from 'vitest';
import { dashboard, milestoneList, pickRecall, reachedMilestones, streaks, toCsv, yearStats } from '../src/main/stats';
import type { StatsSource } from '../src/shared/types';

const src = (over: Partial<StatsSource> = {}): StatsSource => ({
  sessions: [],
  reads: [],
  books: [
    { id: 1, title: 'こころ' },
    { id: 2, title: 'FACTFULNESS' },
  ],
  tags: [
    { bookId: 1, tag: '小説' },
    { bookId: 2, tag: '教養' },
    { bookId: 2, tag: 'ビジネス' },
  ],
  takeaways: [],
  ...over,
});

describe('streaks', () => {
  it('counts back from today, or from yesterday when nothing is logged yet today', () => {
    const d = ['2026-11-18', '2026-11-19', '2026-11-20'];
    expect(streaks(d, '2026-11-20')).toEqual({ current: 3, longest: 3 });
    expect(streaks(d, '2026-11-21')).toEqual({ current: 3, longest: 3 });
    expect(streaks(d, '2026-11-22')).toEqual({ current: 0, longest: 3 });
  });
  it('handles month and year boundaries and duplicates', () => {
    const d = ['2025-12-30', '2025-12-31', '2026-01-01', '2026-01-01', '2026-03-01'];
    expect(streaks(d, '2026-03-01')).toEqual({ current: 1, longest: 3 });
  });
});

describe('dashboard', () => {
  it('sums today, this month, last month and projects the year', () => {
    const s = src({
      sessions: [
        { date: '2026-10-31', minutes: 50, bookId: 1 },
        { date: '2026-11-01', minutes: 30, bookId: 1 },
        { date: '2026-11-21', minutes: 20, bookId: 2 },
        { date: '2026-11-21', minutes: 15, bookId: 1 },
      ],
      reads: [
        { bookId: 1, roundNo: 1, status: 'done', finishedOn: '2026-06-01', rating: 5 },
        { bookId: 2, roundNo: 1, status: 'done', finishedOn: '2025-06-01', rating: 3 },
      ],
    });
    const d = dashboard(s, { goalBooks: 12, goalHours: 0 }, '2026-11-21');
    expect(d).toMatchObject({ todayMinutes: 35, thisMonthMinutes: 65, lastMonthMinutes: 50, finishedThisYear: 1, streak: 1 });
    expect(d.projectedBooks).toBe(1);
  });

  it('shows the same takeaway all day and rotates daily', () => {
    const t = [
      { id: 1, text: 'A', title: 'x' },
      { id: 2, text: 'B', title: 'y' },
    ];
    expect(pickRecall(t, '2026-11-21')).toEqual(pickRecall(t, '2026-11-21'));
    expect(pickRecall(t, '2026-11-21')!.text).not.toBe(pickRecall(t, '2026-11-22')!.text);
    expect(pickRecall([], '2026-11-21')).toBeNull();
  });
});

describe('yearStats', () => {
  const s = src({
    sessions: [
      { date: '2026-01-10', minutes: 60, bookId: 1 },
      { date: '2026-03-05', minutes: 90, bookId: 2 },
      { date: '2025-12-01', minutes: 30, bookId: 1 },
    ],
    reads: [
      { bookId: 1, roundNo: 1, status: 'done', finishedOn: '2025-12-02', rating: 4 },
      { bookId: 1, roundNo: 2, status: 'done', finishedOn: '2026-01-20', rating: 5 },
      { bookId: 2, roundNo: 1, status: 'reading', finishedOn: null, rating: null },
    ],
  });

  it('aggregates a year by month, book and tag', () => {
    const y = yearStats(s, 2026, '2026-11-21', {});
    expect(y.years).toEqual([2026, 2025]);
    expect(y.finished).toBe(1);
    expect(y.minutes).toBe(150);
    expect(y.bars[0]).toEqual({ label: '1月', minutes: 60, finished: 1 });
    expect(y.bars[2]).toEqual({ label: '3月', minutes: 90, finished: 0 });
    expect(y.byBook).toEqual([
      { bookId: 2, title: 'FACTFULNESS', minutes: 90, timesRead: 0 },
      { bookId: 1, title: 'こころ', minutes: 60, timesRead: 1 },
    ]);
    // A book with two tags counts in both.
    expect(y.byTag).toEqual([
      { tag: 'ビジネス', minutes: 90, books: 1 },
      { tag: '教養', minutes: 90, books: 1 },
      { tag: '小説', minutes: 60, books: 1 },
    ]);
    expect(y.ratings).toEqual([0, 0, 0, 0, 1]);
    expect(y.calendar[0].date).toBe('2026-01-01');
    expect(y.calendar.at(-1)!.date).toBe('2026-11-21');
  });

  it('covers all time with one bar per year', () => {
    const y = yearStats(s, 0, '2026-11-21', {});
    expect(y.bars).toEqual([
      { label: '2025年', minutes: 30, finished: 1 },
      { label: '2026年', minutes: 150, finished: 1 },
    ]);
    expect(y.byBook.find((b) => b.bookId === 1)).toMatchObject({ minutes: 90, timesRead: 2 });
    expect(y.avgRating).toBe(4.5);
    expect(y.calendar).toHaveLength(365);
  });
});

describe('milestones', () => {
  const s = src({
    sessions: Array.from({ length: 7 }, (_, i) => ({ date: `2026-11-${String(10 + i).padStart(2, '0')}`, minutes: 100, bookId: 1 })),
    reads: [
      { bookId: 1, roundNo: 1, status: 'done', finishedOn: '2026-11-12', rating: 4 },
      { bookId: 1, roundNo: 2, status: 'done', finishedOn: '2026-11-16', rating: 5 },
    ],
  });

  it('detects reached milestones and the yearly goal', () => {
    expect(reachedMilestones(s, { goalBooks: 2, goalHours: 0 }, '2026-11-21').sort()).toEqual(
      ['books-1', 'goal-2026', 'hours-10', 'reread-1', 'streak-7'].sort(),
    );
    expect(reachedMilestones(s, { goalBooks: 0, goalHours: 0 }, '2026-11-21')).not.toContain('goal-2026');
  });

  it('lists achieved ones first, then the nearest next step of each kind', () => {
    const list = milestoneList(s, { 'books-1': '2026-11-12', 'streak-7': '2026-11-16' }, '2026-11-21');
    expect(list.slice(0, 2).map((m) => m.key)).toEqual(['streak-7', 'books-1']);
    const next = list.filter((m) => !m.achievedOn);
    expect(next.map((m) => [m.key, m.remaining])).toEqual([
      ['books-10', 'あと8冊'],
      ['hours-50', 'あと39時間'],
      ['streak-30', 'あと23日'],
    ]);
  });
});

describe('toCsv', () => {
  it('quotes commas, quotes and newlines and starts with a BOM', () => {
    const csv = toCsv([['a', 'b,c'], ['he said "hi"', 'line1\nline2'], [null, 3]]);
    expect(csv).toBe('﻿a,"b,c"\r\n"he said ""hi""","line1\nline2"\r\n,3\r\n');
  });
});
