import { useCallback, useEffect, useState } from 'react';
import type { Book, LookupResult, ReadStatus } from '../shared/types';
import { api, errorMessage, formatMinutes } from './api';
import { BookDetail } from './BookDetail';
import { BookList } from './BookList';
import { RegisterPanel } from './RegisterPanel';
import { TimerBar, useTimer } from './timer';

export type Filter = { status: ReadStatus | 'all'; tag: string | null };

export function App() {
  const [books, setBooks] = useState<Book[]>([]);
  const [tags, setTags] = useState<{ name: string; count: number }[]>([]);
  const [today, setToday] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>({ status: 'all', tag: null });
  const [isbn, setIsbn] = useState('');
  const [lookup, setLookup] = useState<LookupResult | { kind: 'manual' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [b, t, m] = await Promise.all([api().listBooks(), api().listTags(), api().todayMinutes()]);
    setBooks(b);
    setTags(t);
    setToday(m);
  }, []);

  useEffect(() => {
    refresh().catch((e) => setError(errorMessage(e)));
  }, [refresh]);

  useEffect(() => {
    if (!toast) return;
    const h = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(h);
  }, [toast]);

  const timer = useTimer(async (readId, minutes, title) => {
    await api().addSession(readId, minutes);
    await refresh();
    setToast(`『${title}』に${formatMinutes(minutes)}を記録しました`);
  });

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const onLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isbn.trim() || busy) return;
    setBusy(true);
    setSelected(null);
    await run(async () => {
      const r = await api().lookupIsbn(isbn);
      setLookup(r);
      if (r.kind !== 'invalid') setIsbn('');
    });
    setBusy(false);
  };

  const showList = () => {
    setSelected(null);
    setLookup(null);
  };

  const onRegistered = async (_book: Book, message: string) => {
    setLookup(null);
    setFilter({ status: 'all', tag: null });
    await refresh();
    setToast(message);
  };

  const selectedBook = books.find((b) => b.id === selected) ?? null;

  return (
    <div className="app">
      <nav className="side" aria-label="メニュー">
        <h1>読書記録</h1>
        <button aria-current={!selectedBook && !filter.tag} onClick={() => { showList(); setFilter({ status: 'all', tag: null }); }}>
          本の一覧<span className="num">{books.length}</span>
        </button>
        {tags.length > 0 && (
          <div className="side-tags">
            <small>タグ</small>
            {tags.map((t) => (
              <button
                key={t.name}
                aria-current={filter.tag === t.name}
                onClick={() => { showList(); setFilter((f) => ({ ...f, tag: f.tag === t.name ? null : t.name })); }}
              >
                {t.name}<span className="num">{t.count}</span>
              </button>
            ))}
          </div>
        )}
      </nav>

      <main className="main">
        <div className="topline">
          <div className="today">
            <span className="lbl">今日の読書</span>
            <b className="num">{formatMinutes(today)}</b>
          </div>
          <TimerBar timer={timer} />
        </div>

        {selectedBook ? (
          <BookDetail
            book={selectedBook}
            allTags={tags.map((t) => t.name)}
            timer={timer}
            onBack={showList}
            onChanged={refresh}
            onDeleted={async () => { setSelected(null); await refresh(); setToast('削除しました'); }}
            onError={setError}
            onToast={setToast}
          />
        ) : (
          <>
            <form className="isbn" onSubmit={onLookup}>
              <label htmlFor="isbn">ISBN</label>
              <input
                id="isbn"
                autoFocus
                inputMode="numeric"
                autoComplete="off"
                value={isbn}
                onChange={(e) => setIsbn(e.target.value)}
                placeholder="バーコードを読むか、数字を入力してEnter"
              />
              <button className="btn" type="submit" disabled={busy}>{busy ? '検索中…' : '登録'}</button>
              <button className="btn ghost" type="button" onClick={() => setLookup({ kind: 'manual' })}>ISBNなしで登録</button>
            </form>
            {lookup?.kind === 'invalid' && <p className="error" role="alert">{lookup.message}</p>}
            {lookup && lookup.kind !== 'invalid' && (
              <RegisterPanel
                lookup={lookup}
                allTags={tags.map((t) => t.name)}
                onCancel={() => setLookup(null)}
                onDone={onRegistered}
                onOpen={(id) => { setLookup(null); setSelected(id); }}
                onError={setError}
              />
            )}
            <BookList books={books} filter={filter} setFilter={setFilter} timer={timer} onOpen={setSelected} />
          </>
        )}
        {error && <p className="error" role="alert">{error}</p>}
      </main>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
