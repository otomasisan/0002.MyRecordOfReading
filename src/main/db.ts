import type { Database, SqlValue } from 'sql.js';
import type { Book, BookInfo, NewBookInput, ReadRound, ReadStatus, Settings, StatsSource } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/types';

const SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY,
  isbn13 TEXT UNIQUE,
  title TEXT NOT NULL,
  authors TEXT NOT NULL DEFAULT '',
  publisher TEXT NOT NULL DEFAULT '',
  published TEXT NOT NULL DEFAULT '',
  pages INTEGER,
  cover TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS book_tags (
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (book_id, tag_id)
);
CREATE TABLE IF NOT EXISTS reads (
  id INTEGER PRIMARY KEY,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  round_no INTEGER NOT NULL,
  status TEXT NOT NULL,
  started_on TEXT,
  finished_on TEXT,
  rating INTEGER,
  impression TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (book_id, round_no)
);
CREATE TABLE IF NOT EXISTS takeaways (
  id INTEGER PRIMARY KEY,
  read_id INTEGER NOT NULL REFERENCES reads(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  read_id INTEGER NOT NULL REFERENCES reads(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_date ON sessions(date);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS milestones (
  key TEXT PRIMARY KEY,
  achieved_on TEXT NOT NULL
);
PRAGMA user_version = 2;
`;

export interface Clock {
  /** Local date as YYYY-MM-DD. */
  today(): string;
  /** ISO timestamp. */
  now(): string;
}

export const systemClock: Clock = {
  today() {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  },
  now: () => new Date().toISOString(),
};

type Row = Record<string, SqlValue>;

/**
 * All reading data. Every write calls `onChange` so the caller can persist
 * the database file.
 */
export class Store {
  constructor(
    private db: Database,
    private onChange: () => void = () => {},
    private clock: Clock = systemClock,
  ) {
    db.exec(SCHEMA);
  }

  private all(sql: string, params: SqlValue[] = []): Row[] {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const rows: Row[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  private one(sql: string, params: SqlValue[] = []): Row | undefined {
    return this.all(sql, params)[0];
  }

  private run(sql: string, params: SqlValue[] = []): number {
    this.db.run(sql, params);
    const r = this.one('SELECT last_insert_rowid() AS id');
    return Number(r?.id ?? 0);
  }

  private write<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      this.onChange();
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  // ---- reads ---------------------------------------------------------

  listBooks(): Book[] {
    const ids = this.all('SELECT id FROM books ORDER BY updated_at DESC, id DESC').map((r) => Number(r.id));
    return ids.map((id) => this.getBook(id)!);
  }

  getBook(id: number): Book | null {
    const b = this.one('SELECT * FROM books WHERE id = ?', [id]);
    if (!b) return null;
    const tags = this.all(
      'SELECT t.name FROM tags t JOIN book_tags bt ON bt.tag_id = t.id WHERE bt.book_id = ? ORDER BY t.name',
      [id],
    ).map((r) => String(r.name));
    const rounds: ReadRound[] = this.all('SELECT * FROM reads WHERE book_id = ? ORDER BY round_no', [id]).map((r) => {
      const readId = Number(r.id);
      const minutes = Number(this.one('SELECT COALESCE(SUM(minutes), 0) AS m FROM sessions WHERE read_id = ?', [readId])?.m ?? 0);
      return {
        id: readId,
        bookId: id,
        roundNo: Number(r.round_no),
        status: r.status as ReadStatus,
        startedOn: (r.started_on as string | null) ?? null,
        finishedOn: (r.finished_on as string | null) ?? null,
        rating: r.rating == null ? null : Number(r.rating),
        impression: String(r.impression ?? ''),
        takeaways: this.all('SELECT id, text FROM takeaways WHERE read_id = ? ORDER BY id', [readId]).map((t) => ({
          id: Number(t.id),
          text: String(t.text),
        })),
        minutes,
      };
    });
    return {
      id,
      isbn13: (b.isbn13 as string | null) ?? null,
      title: String(b.title),
      authors: String(b.authors),
      publisher: String(b.publisher),
      published: String(b.published),
      pages: b.pages == null ? null : Number(b.pages),
      cover: (b.cover as string | null) ?? null,
      source: b.source as Book['source'],
      tags,
      rounds,
      totalMinutes: rounds.reduce((a, r) => a + r.minutes, 0),
      timesFinished: rounds.filter((r) => r.status === 'done').length,
      createdAt: String(b.created_at),
    };
  }

  findByIsbn(isbn13: string): Book | null {
    const r = this.one('SELECT id FROM books WHERE isbn13 = ?', [isbn13]);
    return r ? this.getBook(Number(r.id)) : null;
  }

  listTags(): { name: string; count: number }[] {
    return this.all(
      `SELECT t.name, COUNT(bt.book_id) AS c FROM tags t
       LEFT JOIN book_tags bt ON bt.tag_id = t.id GROUP BY t.id HAVING c > 0 ORDER BY c DESC, t.name`,
    ).map((r) => ({ name: String(r.name), count: Number(r.c) }));
  }

  todayMinutes(): number {
    return Number(this.one('SELECT COALESCE(SUM(minutes), 0) AS m FROM sessions WHERE date = ?', [this.clock.today()])?.m ?? 0);
  }

  private bookIdOfRead(readId: number): number {
    const r = this.one('SELECT book_id FROM reads WHERE id = ?', [readId]);
    if (!r) throw new Error(`読書回が見つかりません (id=${readId})`);
    return Number(r.book_id);
  }

  private touchBook(bookId: number) {
    this.db.run('UPDATE books SET updated_at = ? WHERE id = ?', [this.clock.now(), bookId]);
  }

  /** Raw rows for the statistics. */
  statsSource(): StatsSource {
    const sessions = this.all(
      `SELECT s.date, s.minutes, r.book_id FROM sessions s JOIN reads r ON r.id = s.read_id ORDER BY s.date`,
    ).map((r) => ({ date: String(r.date), minutes: Number(r.minutes), bookId: Number(r.book_id) }));
    const reads = this.all('SELECT book_id, round_no, status, finished_on, rating FROM reads').map((r) => ({
      bookId: Number(r.book_id),
      roundNo: Number(r.round_no),
      status: r.status as ReadStatus,
      finishedOn: (r.finished_on as string | null) ?? null,
      rating: r.rating == null ? null : Number(r.rating),
    }));
    const books = this.all('SELECT id, title FROM books').map((r) => ({ id: Number(r.id), title: String(r.title) }));
    const tags = this.all('SELECT bt.book_id, t.name FROM book_tags bt JOIN tags t ON t.id = bt.tag_id').map((r) => ({
      bookId: Number(r.book_id),
      tag: String(r.name),
    }));
    const takeaways = this.all(
      `SELECT k.id, k.text, b.title FROM takeaways k JOIN reads r ON r.id = k.read_id JOIN books b ON b.id = r.book_id ORDER BY k.id`,
    ).map((r) => ({ id: Number(r.id), text: String(r.text), title: String(r.title) }));
    return { sessions, reads, books, tags, takeaways };
  }

  getSettings(): Settings {
    const rows = Object.fromEntries(this.all('SELECT key, value FROM settings').map((r) => [String(r.key), String(r.value)]));
    const num = (k: string, d: number) => (rows[k] !== undefined && Number.isFinite(Number(rows[k])) ? Number(rows[k]) : d);
    return { goalBooks: num('goalBooks', DEFAULT_SETTINGS.goalBooks), goalHours: num('goalHours', DEFAULT_SETTINGS.goalHours) };
  }

  setSettings(patch: Partial<Settings>): Settings {
    this.write(() => {
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) continue;
        if (!(Number.isInteger(v) && v >= 0 && v <= 100000)) throw new Error('目標は0以上の整数で入力してください');
        this.db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [k, String(v)]);
      }
    });
    return this.getSettings();
  }

  achievedMilestones(): Record<string, string> {
    return Object.fromEntries(this.all('SELECT key, achieved_on FROM milestones').map((r) => [String(r.key), String(r.achieved_on)]));
  }

  /** Records milestones reached for the first time and returns their keys. */
  recordMilestones(keys: string[]): string[] {
    const known = this.achievedMilestones();
    const fresh = keys.filter((k) => !known[k]);
    if (fresh.length) {
      this.write(() => {
        for (const k of fresh) this.db.run('INSERT INTO milestones (key, achieved_on) VALUES (?, ?)', [k, this.clock.today()]);
      });
    }
    return fresh;
  }

  // ---- writes --------------------------------------------------------

  addBook(input: NewBookInput & { cover?: string | null }): Book {
    const { info, status } = input;
    if (!info.title.trim()) throw new Error('書名を入力してください');
    if (info.isbn13 && this.findByIsbn(info.isbn13)) throw new Error('この本はすでに登録されています');
    const id = this.write(() => {
      const now = this.clock.now();
      const bookId = this.run(
        `INSERT INTO books (isbn13, title, authors, publisher, published, pages, cover, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [info.isbn13 || null, info.title.trim(), info.authors, info.publisher, info.published, info.pages, input.cover ?? null, info.source, now, now],
      );
      const today = this.clock.today();
      this.run(
        `INSERT INTO reads (book_id, round_no, status, started_on, finished_on, created_at, updated_at)
         VALUES (?, 1, ?, ?, ?, ?, ?)`,
        [bookId, status, status === 'tsundoku' ? null : today, status === 'done' ? today : null, now, now],
      );
      this.replaceTags(bookId, input.tags);
      return bookId;
    });
    return this.getBook(id)!;
  }

  updateBook(id: number, patch: Partial<Pick<Book, 'title' | 'authors' | 'publisher'>>): Book {
    this.write(() => {
      for (const key of ['title', 'authors', 'publisher'] as const) {
        const v = patch[key];
        if (v === undefined) continue;
        if (key === 'title' && !v.trim()) throw new Error('書名を空にはできません');
        this.db.run(`UPDATE books SET ${key} = ? WHERE id = ?`, [v.trim(), id]);
      }
      this.touchBook(id);
    });
    return this.getBook(id)!;
  }

  deleteBook(id: number) {
    this.write(() => {
      this.db.run('DELETE FROM books WHERE id = ?', [id]);
      this.db.run('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM book_tags)');
    });
  }

  private replaceTags(bookId: number, tags: string[]) {
    const names = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
    this.db.run('DELETE FROM book_tags WHERE book_id = ?', [bookId]);
    for (const name of names) {
      this.db.run('INSERT OR IGNORE INTO tags (name) VALUES (?)', [name]);
      const tagId = Number(this.one('SELECT id FROM tags WHERE name = ?', [name])!.id);
      this.db.run('INSERT INTO book_tags (book_id, tag_id) VALUES (?, ?)', [bookId, tagId]);
    }
    this.db.run('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM book_tags)');
  }

  setTags(bookId: number, tags: string[]): Book {
    this.write(() => {
      this.replaceTags(bookId, tags);
      this.touchBook(bookId);
    });
    return this.getBook(bookId)!;
  }

  setStatus(readId: number, status: ReadStatus): Book {
    const bookId = this.bookIdOfRead(readId);
    this.write(() => {
      const today = this.clock.today();
      const r = this.one('SELECT started_on, finished_on FROM reads WHERE id = ?', [readId])!;
      let started = r.started_on as string | null;
      let finished = r.finished_on as string | null;
      if (status !== 'tsundoku' && !started) started = today;
      if (status === 'done' && !finished) finished = today;
      if (status !== 'done') finished = null;
      if (status === 'tsundoku') started = null;
      this.db.run('UPDATE reads SET status = ?, started_on = ?, finished_on = ?, updated_at = ? WHERE id = ?', [
        status, started, finished, this.clock.now(), readId,
      ]);
      this.touchBook(bookId);
    });
    return this.getBook(bookId)!;
  }

  setRating(readId: number, rating: number | null): Book {
    if (rating !== null && !(Number.isInteger(rating) && rating >= 1 && rating <= 5)) throw new Error('評価は1〜5で指定してください');
    const bookId = this.bookIdOfRead(readId);
    this.write(() => {
      this.db.run('UPDATE reads SET rating = ?, updated_at = ? WHERE id = ?', [rating, this.clock.now(), readId]);
      this.touchBook(bookId);
    });
    return this.getBook(bookId)!;
  }

  setImpression(readId: number, text: string) {
    const bookId = this.bookIdOfRead(readId);
    this.write(() => {
      this.db.run('UPDATE reads SET impression = ?, updated_at = ? WHERE id = ?', [text, this.clock.now(), readId]);
      this.touchBook(bookId);
    });
  }

  addTakeaway(readId: number, text: string): Book {
    const bookId = this.bookIdOfRead(readId);
    if (!text.trim()) return this.getBook(bookId)!;
    this.write(() => {
      this.run('INSERT INTO takeaways (read_id, text, created_at) VALUES (?, ?, ?)', [readId, text.trim(), this.clock.now()]);
      this.touchBook(bookId);
    });
    return this.getBook(bookId)!;
  }

  removeTakeaway(id: number): Book {
    const r = this.one('SELECT read_id FROM takeaways WHERE id = ?', [id]);
    if (!r) throw new Error('項目が見つかりません');
    const bookId = this.bookIdOfRead(Number(r.read_id));
    this.write(() => this.db.run('DELETE FROM takeaways WHERE id = ?', [id]));
    return this.getBook(bookId)!;
  }

  /** Starts the next round of a book. The current round must be finished or stopped. */
  startReread(bookId: number): Book {
    const book = this.getBook(bookId);
    if (!book) throw new Error('本が見つかりません');
    const last = book.rounds[book.rounds.length - 1];
    if (last && (last.status === 'reading' || last.status === 'tsundoku')) {
      throw new Error(`${last.roundNo}回目がまだ読み終わっていません`);
    }
    this.write(() => {
      const now = this.clock.now();
      this.run(
        `INSERT INTO reads (book_id, round_no, status, started_on, created_at, updated_at) VALUES (?, ?, 'reading', ?, ?, ?)`,
        [bookId, (last?.roundNo ?? 0) + 1, this.clock.today(), now, now],
      );
      this.touchBook(bookId);
    });
    return this.getBook(bookId)!;
  }

  addSession(readId: number, minutes: number, date = this.clock.today()): Book {
    if (!(Number.isFinite(minutes) && minutes > 0 && minutes <= 24 * 60)) throw new Error('読書時間は1〜1440分で入力してください');
    const bookId = this.bookIdOfRead(readId);
    this.write(() => {
      this.run('INSERT INTO sessions (read_id, date, minutes, created_at) VALUES (?, ?, ?, ?)', [
        readId, date, Math.round(minutes), this.clock.now(),
      ]);
      const r = this.one('SELECT status, started_on FROM reads WHERE id = ?', [readId])!;
      if (r.status === 'tsundoku') {
        this.db.run(`UPDATE reads SET status = 'reading', started_on = ? WHERE id = ?`, [r.started_on ?? date, readId]);
      }
      this.touchBook(bookId);
    });
    return this.getBook(bookId)!;
  }
}

export type { BookInfo };
