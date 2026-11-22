import type { Book } from '../shared/types';

const PALETTE = ['#3d5a80', '#6a7f3f', '#9a4f3c', '#7a6a3a', '#4b4e6d', '#2f6f73', '#5b4a7a', '#7a4a5e'];

/** The cover image, or a coloured placeholder with the title when there is none. */
export function Cover({ book, width }: { book: Pick<Book, 'title' | 'authors' | 'cover'>; width?: number }) {
  if (book.cover) {
    return <img className="cover img" src={book.cover} alt={`${book.title}の表紙`} style={width ? { width } : undefined} />;
  }
  let h = 0;
  for (const c of book.title) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (
    <div className="cover" style={{ background: PALETTE[h % PALETTE.length], width }} aria-hidden="true">
      {book.title}
      <span>{book.authors}</span>
    </div>
  );
}
