import initSqlJs from 'sql.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { Store, type Clock } from '../src/main/db';
import type { BookInfo } from '../src/shared/types';

const info = (over: Partial<BookInfo> = {}): BookInfo => ({
  isbn13: '9784101010137',
  title: 'こころ',
  authors: '夏目漱石',
  publisher: '新潮社',
  published: '2004-03',
  pages: 384,
  coverUrl: null,
  source: 'openbd',
  ...over,
});

let today = '2026-11-21';
const clock: Clock = { today: () => today, now: () => `${today}T10:00:00.000Z` };
let store: Store;
let saves = 0;

beforeEach(async () => {
  const SQL = await initSqlJs();
  saves = 0;
  today = '2026-11-21';
  store = new Store(new SQL.Database(), () => saves++, clock);
});

describe('Store', () => {
  it('registers a book with its first round, tags and dates', () => {
    const b = store.addBook({ info: info(), tags: ['小説', '古典', '小説', ' '], status: 'reading' });
    expect(b.title).toBe('こころ');
    expect(b.tags).toEqual(['古典', '小説']);
    expect(b.rounds).toHaveLength(1);
    expect(b.rounds[0]).toMatchObject({ roundNo: 1, status: 'reading', startedOn: '2026-11-21', finishedOn: null });
    expect(saves).toBe(1);
  });

  it('refuses a duplicate ISBN and finds the existing book', () => {
    store.addBook({ info: info(), tags: [], status: 'reading' });
    expect(() => store.addBook({ info: info(), tags: [], status: 'reading' })).toThrow('すでに登録');
    expect(store.findByIsbn('9784101010137')?.title).toBe('こころ');
  });

  it('stamps start and finish dates when the status changes', () => {
    const b = store.addBook({ info: info(), tags: [], status: 'tsundoku' });
    const readId = b.rounds[0].id;
    expect(b.rounds[0].startedOn).toBeNull();
    today = '2026-11-22';
    expect(store.setStatus(readId, 'reading').rounds[0].startedOn).toBe('2026-11-22');
    today = '2026-11-30';
    const done = store.setStatus(readId, 'done');
    expect(done.rounds[0]).toMatchObject({ startedOn: '2026-11-22', finishedOn: '2026-11-30' });
    expect(done.timesFinished).toBe(1);
  });

  it('records re-reads as new rounds and keeps reading time per round', () => {
    const b = store.addBook({ info: info(), tags: [], status: 'reading' });
    const first = b.rounds[0].id;
    store.addSession(first, 30);
    store.addSession(first, 45);
    expect(() => store.startReread(b.id)).toThrow('まだ読み終わっていません');
    store.setStatus(first, 'done');
    const again = store.startReread(b.id);
    expect(again.rounds.map((r) => r.roundNo)).toEqual([1, 2]);
    store.addSession(again.rounds[1].id, 20);
    const after = store.getBook(b.id)!;
    expect(after.rounds.map((r) => r.minutes)).toEqual([75, 20]);
    expect(after.totalMinutes).toBe(95);
    expect(store.todayMinutes()).toBe(95);
  });

  it('starts a tsundoku book when time is logged', () => {
    const b = store.addBook({ info: info(), tags: [], status: 'tsundoku' });
    const r = store.addSession(b.rounds[0].id, 10).rounds[0];
    expect(r).toMatchObject({ status: 'reading', startedOn: '2026-11-21' });
  });

  it('validates rating and minutes', () => {
    const b = store.addBook({ info: info(), tags: [], status: 'reading' });
    const id = b.rounds[0].id;
    expect(store.setRating(id, 4).rounds[0].rating).toBe(4);
    expect(() => store.setRating(id, 6)).toThrow();
    expect(() => store.addSession(id, 0)).toThrow();
  });

  it('keeps takeaways and impressions per round', () => {
    const b = store.addBook({ info: info(), tags: [], status: 'reading' });
    const id = b.rounds[0].id;
    store.setImpression(id, '先生の告白が重い');
    const withT = store.addTakeaway(id, '大事な話はその日のうちに伝える');
    expect(withT.rounds[0].impression).toBe('先生の告白が重い');
    expect(withT.rounds[0].takeaways.map((t) => t.text)).toEqual(['大事な話はその日のうちに伝える']);
    expect(store.removeTakeaway(withT.rounds[0].takeaways[0].id).rounds[0].takeaways).toEqual([]);
  });

  it('counts tags and drops unused ones', () => {
    const a = store.addBook({ info: info(), tags: ['小説'], status: 'reading' });
    store.addBook({ info: info({ isbn13: '9784822289607', title: 'FACTFULNESS' }), tags: ['教養', '小説'], status: 'reading' });
    expect(store.listTags()).toEqual([{ name: '小説', count: 2 }, { name: '教養', count: 1 }]);
    store.setTags(a.id, ['古典']);
    store.deleteBook(a.id);
    expect(store.listTags().map((t) => t.name)).toEqual(['小説', '教養']);
  });

  it('survives an export and reload', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    const s1 = new Store(db, () => {}, clock);
    s1.addBook({ info: info(), tags: ['小説'], status: 'done' });
    const s2 = new Store(new SQL.Database(db.export()), () => {}, clock);
    expect(s2.listBooks()[0]).toMatchObject({ title: 'こころ', tags: ['小説'], timesFinished: 1 });
  });
});
