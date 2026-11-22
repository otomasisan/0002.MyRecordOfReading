import { useState } from 'react';
import type { Book, ReadStatus } from '../shared/types';
import { STATUS_LABEL } from '../shared/types';
import { formatClock, formatMinutes } from './api';
import type { Filter } from './App';
import { Cover } from './Cover';
import type { Timer } from './timer';

const TABS: (ReadStatus | 'all')[] = ['all', 'tsundoku', 'reading', 'done', 'stopped'];

type Sort = 'updated' | 'added' | 'title' | 'minutes' | 'rating';
const SORTS: Record<Sort, string> = { updated: '最近更新した順', added: '登録した順', title: '書名順', minutes: '読書時間が長い順', rating: '評価が高い順' };

const bestRating = (b: Book) => Math.max(0, ...b.rounds.map((r) => r.rating ?? 0));
const compare: Record<Sort, (a: Book, b: Book) => number> = {
  updated: () => 0, // the store already returns the most recently updated first
  added: (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id,
  title: (a, b) => a.title.localeCompare(b.title, 'ja'),
  minutes: (a, b) => b.totalMinutes - a.totalMinutes,
  rating: (a, b) => bestRating(b) - bestRating(a),
};

/** Matches title, author, publisher, tags and notes, ignoring case and width. */
function matches(b: Book, q: string): boolean {
  const norm = (s: string) => s.normalize('NFKC').toLowerCase();
  const hay = norm([b.title, b.authors, b.publisher, b.isbn13 ?? '', ...b.tags, ...b.rounds.flatMap((r) => [r.impression, ...r.takeaways.map((t) => t.text)])].join(' '));
  return norm(q).split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

export const current = (b: Book) => b.rounds[b.rounds.length - 1];

export function Stars({ n }: { n: number | null }) {
  if (!n) return null;
  return <span className="stars" aria-label={`評価${n}`}>{'★'.repeat(n)}{'☆'.repeat(5 - n)}</span>;
}

export function BookList(props: {
  books: Book[];
  filter: Filter;
  setFilter: (f: Filter) => void;
  timer: Timer;
  onOpen: (id: number) => void;
}) {
  const { books, filter, setFilter, timer, onOpen } = props;
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('updated');
  const shown = books
    .filter(
      (b) =>
        (filter.status === 'all' || current(b).status === filter.status) &&
        (!filter.tag || b.tags.includes(filter.tag)) &&
        (!query.trim() || matches(b, query)),
    )
    .sort(compare[sort]);

  return (
    <section className="list">
      <div className="tabs" role="tablist">
        {TABS.map((k) => (
          <button key={k} role="tab" className="tab" aria-selected={filter.status === k} onClick={() => setFilter({ ...filter, status: k })}>
            {k === 'all' ? 'すべて' : STATUS_LABEL[k]}
          </button>
        ))}
        <span className="spacer" />
        {filter.tag && (
          <button className="chip filter" onClick={() => setFilter({ ...filter, tag: null })}>
            タグ：{filter.tag} ✕
          </button>
        )}
        <input className="search" type="search" aria-label="本を検索" placeholder="書名・著者・タグ・メモで検索" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select aria-label="並べ替え" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          {(Object.keys(SORTS) as Sort[]).map((k) => <option key={k} value={k}>{SORTS[k]}</option>)}
        </select>
      </div>
      {books.length === 0 ? (
        <div className="empty">
          <p><b>まだ本がありません。</b></p>
          <p>上のISBN欄にカーソルがある状態で、本の裏表紙のバーコードを読むか、ISBNを入力してEnterを押すと登録できます。</p>
        </div>
      ) : shown.length === 0 ? (
        <p className="note">この条件の本はありません。</p>
      ) : (
        <div className="grid">
          {shown.map((b) => {
            const r = current(b);
            const running = timer.running?.bookId === b.id;
            const canTime = r.status === 'reading' || r.status === 'tsundoku';
            return (
              <article
                key={b.id}
                className="card"
                tabIndex={0}
                onClick={() => onOpen(b.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(b.id); }}
              >
                <Cover book={b} />
                <div className="t">
                  {b.title}
                  {b.rounds.length > 1 && <span className="chip">{r.roundNo}回目</span>}
                </div>
                {b.tags.length > 0 && <div className="chips">{b.tags.map((t) => <span key={t} className="chip">{t}</span>)}</div>}
                <div className="meta">
                  <span className={`pill ${r.status}`}>{STATUS_LABEL[r.status]}</span>
                  <span className="num">{b.totalMinutes ? formatMinutes(b.totalMinutes) : ''}</span>
                </div>
                {canTime ? (
                  <div>
                    <button
                      className={`btn sm ${running ? 'run' : 'ghost'}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (running) timer.stop();
                        else timer.start(b, r.id);
                      }}
                      disabled={!running && !!timer.running}
                      title={!running && timer.running ? '別の本のタイマーが動いています' : undefined}
                    >
                      {running ? `■ 止める ${formatClock(timer.elapsedSec)}` : '▶ 読む'}
                    </button>
                  </div>
                ) : (
                  <Stars n={r.rating} />
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
