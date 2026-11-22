// Types shared by the main process, the preload bridge and the screens.

export type ReadStatus = 'tsundoku' | 'reading' | 'done' | 'stopped';

export const STATUS_LABEL: Record<ReadStatus, string> = {
  tsundoku: '積読',
  reading: '読書中',
  done: '読了',
  stopped: '中断',
};

/** Book details fetched from a catalogue service (or typed by hand). */
export interface BookInfo {
  isbn13: string;
  title: string;
  authors: string;
  publisher: string;
  published: string;
  pages: number | null;
  coverUrl: string | null;
  source: 'openbd' | 'google' | 'ndl' | 'manual';
}

/** One reading of a book. A re-read adds another round. */
export interface ReadRound {
  id: number;
  bookId: number;
  roundNo: number;
  status: ReadStatus;
  startedOn: string | null;
  finishedOn: string | null;
  rating: number | null;
  impression: string;
  takeaways: Takeaway[];
  minutes: number;
}

/** 日常に活かせそうなこと */
export interface Takeaway {
  id: number;
  text: string;
}

export interface ReadingSession {
  id: number;
  readId: number;
  date: string;
  minutes: number;
}

export interface Book {
  id: number;
  isbn13: string | null;
  title: string;
  authors: string;
  publisher: string;
  published: string;
  pages: number | null;
  cover: string | null; // data: URL
  source: BookInfo['source'];
  tags: string[];
  rounds: ReadRound[];
  totalMinutes: number;
  timesFinished: number;
  createdAt: string;
}

export type LookupResult =
  | { kind: 'existing'; book: Book }
  | { kind: 'found'; info: BookInfo }
  | { kind: 'notFound'; isbn13: string }
  | { kind: 'invalid'; message: string };

export interface NewBookInput {
  info: BookInfo;
  tags: string[];
  status: ReadStatus;
}

export interface Api {
  listBooks(): Promise<Book[]>;
  getBook(id: number): Promise<Book | null>;
  lookupIsbn(raw: string): Promise<LookupResult>;
  addBook(input: NewBookInput): Promise<Book>;
  updateBook(id: number, patch: Partial<Pick<Book, 'title' | 'authors' | 'publisher'>>): Promise<Book>;
  deleteBook(id: number): Promise<void>;
  setTags(bookId: number, tags: string[]): Promise<Book>;
  listTags(): Promise<{ name: string; count: number }[]>;
  setStatus(readId: number, status: ReadStatus): Promise<Book>;
  setRating(readId: number, rating: number | null): Promise<Book>;
  setImpression(readId: number, text: string): Promise<void>;
  addTakeaway(readId: number, text: string): Promise<Book>;
  removeTakeaway(id: number): Promise<Book>;
  startReread(bookId: number): Promise<Book>;
  addSession(readId: number, minutes: number): Promise<Book>;
  todayMinutes(): Promise<number>;
}
