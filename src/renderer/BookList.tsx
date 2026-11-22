import type { Book, ReadStatus } from '../shared/types';
import { STATUS_LABEL } from '../shared/types';
import { formatClock, formatMinutes } from './api';
import type { Filter } from './App';
import { Cover } from './Cover';
import type { Timer } from './timer';

const TABS: (ReadStatus | 'all')[] = ['all', 'tsundoku', 'reading', 'done', 'stopped'];

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
  const shown = books.filter(
    (b) => (filter.status === 'all' || current(b).status === filter.status) && (!filter.tag || b.tags.includes(filter.tag)),
  );

  return (
    <section className="list">
      <div className="tabs" role="tablist">
        {TABS.map((k) => (
          <button key={k} role="tab" className="tab" aria-selected={filter.status === k} onClick={() => setFilter({ ...filter, status: k })}>
            {k === 'all' ? 'すべて' : STATUS_LABEL[k]}
          </button>
        ))}
        {filter.tag && (
          <button className="chip filter" onClick={() => setFilter({ ...filter, tag: null })}>
            タグ：{filter.tag} ✕
          </button>
        )}
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
