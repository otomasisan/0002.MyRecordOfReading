import { useCallback, useEffect, useState } from 'react';
import type { Book, Dashboard, LookupResult, Milestone, ReadStatus } from '../shared/types';
import { api, errorMessage, formatMinutes } from './api';
import { BookDetail } from './BookDetail';
import { BookList } from './BookList';
import { DashboardStrip } from './DashboardStrip';
import { RegisterPanel } from './RegisterPanel';
import { SettingsView } from './SettingsView';
import { StatsView } from './StatsView';
import { TimerBar, useTimer } from './timer';

export type Filter = { status: ReadStatus | 'all'; tag: string | null };
type View = 'list' | 'stats' | 'settings';

export function App() {
  const [books, setBooks] = useState<Book[]>([]);
  const [tags, setTags] = useState<{ name: string; count: number }[]>([]);
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [view, setView] = useState<View>('list');
  const [selected, setSelected] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>({ status: 'all', tag: null });
  const [isbn, setIsbn] = useState('');
  const [lookup, setLookup] = useState<LookupResult | { kind: 'manual' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [celebrate, setCelebrate] = useState<Milestone[]>([]);
  const [statsVersion, setStatsVersion] = useState(0);

  const refresh = useCallback(async () => {
    const [b, t, d] = await Promise.all([api().listBooks(), api().listTags(), api().getDashboard()]);
    setBooks(b);
    setTags(t);
    setDash(d);
    setStatsVersion((v) => v + 1);
    if (d.newMilestones.length) setCelebrate((c) => [...c, ...d.newMilestones]);
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

  const go = (v: View) => {
    setView(v);
    setSelected(null);
    setLookup(null);
    setError(null);
  };

  const onRegistered = async (_book: Book, message: string) => {
    setLookup(null);
    setFilter({ status: 'all', tag: null });
    await refresh();
    setToast(message);
  };

  const open = (id: number) => {
    setView('list');
    setLookup(null);
    setSelected(id);
  };

  const selectedBook = books.find((b) => b.id === selected) ?? null;
  const onList = view === 'list' && !selectedBook;

  return (
    <div className="app">
      <nav className="side" aria-label="メニュー">
        <h1>読書記録</h1>
        <button aria-current={onList && !filter.tag} onClick={() => { go('list'); setFilter({ status: 'all', tag: null }); }}>
          本の一覧<span className="num">{books.length}</span>
        </button>
        <button aria-current={view === 'stats'} onClick={() => go('stats')}>統計</button>
        <button aria-current={view === 'settings'} onClick={() => go('settings')}>設定</button>
        {tags.length > 0 && (
          <div className="side-tags">
            <small>タグ</small>
            {tags.map((t) => (
              <button
                key={t.name}
                aria-current={onList && filter.tag === t.name}
                onClick={() => { go('list'); setFilter((f) => ({ ...f, tag: f.tag === t.name ? null : t.name })); }}
              >
                {t.name}<span className="num">{t.count}</span>
              </button>
            ))}
          </div>
        )}
      </nav>

      <main className="main">
        {(timer.running || timer.stopped) && (
          <div className="topline">
            <TimerBar timer={timer} />
          </div>
        )}

        {celebrate.length > 0 && (
          <div className="celebrate" role="status">
            <div>
              <b>節目を達成しました</b>
              <span>{celebrate.map((m) => m.label).join('、')}</span>
            </div>
            <button className="btn ghost sm" onClick={() => setCelebrate([])}>閉じる</button>
          </div>
        )}

        {view === 'stats' ? (
          <StatsView version={statsVersion} onOpen={open} onError={setError} />
        ) : view === 'settings' ? (
          <SettingsView onSaved={async (m) => { await refresh(); setToast(m); }} onError={setError} />
        ) : selectedBook ? (
          <BookDetail
            book={selectedBook}
            allTags={tags.map((t) => t.name)}
            timer={timer}
            onBack={() => setSelected(null)}
            onChanged={refresh}
            onDeleted={async () => { setSelected(null); await refresh(); setToast('削除しました'); }}
            onError={setError}
            onToast={setToast}
          />
        ) : (
          <>
            {dash && <DashboardStrip dash={dash} onGoal={() => go('settings')} />}
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
                onOpen={open}
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
