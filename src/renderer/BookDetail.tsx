import { useEffect, useRef, useState } from 'react';
import type { Book, ReadStatus } from '../shared/types';
import { STATUS_LABEL } from '../shared/types';
import { api, errorMessage, formatClock, formatMinutes } from './api';
import { current, Stars } from './BookList';
import { Cover } from './Cover';
import { TagEditor } from './TagEditor';
import type { Timer } from './timer';

type Props = {
  book: Book;
  allTags: string[];
  timer: Timer;
  onBack: () => void;
  onChanged: () => Promise<void>;
  onDeleted: () => void;
  onError: (m: string) => void;
  onToast: (m: string) => void;
};

export function BookDetail({ book, allTags, timer, onBack, onChanged, onDeleted, onError, onToast }: Props) {
  const r = current(book);
  const running = timer.running?.bookId === book.id;
  const [impression, setImpression] = useState(r.impression);
  const [saved, setSaved] = useState(true);
  const [takeaway, setTakeaway] = useState('');
  const [manual, setManual] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset the editor when another round or book is shown.
  useEffect(() => {
    setImpression(r.impression);
    setSaved(true);
  }, [r.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn: () => Promise<unknown>, message?: string): Promise<boolean> => {
    try {
      await fn();
      await onChanged();
      if (message) onToast(message);
      return true;
    } catch (e) {
      onError(errorMessage(e));
      return false;
    }
  };

  const flushImpression = async (text: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    try {
      await api().setImpression(r.id, text);
      setSaved(true);
    } catch (e) {
      onError(errorMessage(e));
    }
  };

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const onImpression = (text: string) => {
    setImpression(text);
    setSaved(false);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flushImpression(text), 600);
  };

  const setStatus = (s: ReadStatus) =>
    act(() => api().setStatus(r.id, s), s === 'done' && r.status !== 'done' ? '読了おめでとうございます。評価と所感を残しておきましょう' : undefined);

  return (
    <>
      <div>
        <button className="btn ghost" onClick={async () => { if (!saved) await flushImpression(impression); await onChanged(); onBack(); }}>
          ← 一覧に戻る
        </button>
      </div>
      <section className="panel" aria-label="本の詳細">
        <Cover book={book} width={130} />
        <div className="stack">
          <div>
            <h2>{book.title}</h2>
            <dl className="kv">
              <dt>著者</dt><dd>{book.authors || '—'}</dd>
              <dt>出版社</dt><dd>{book.publisher || '—'}</dd>
              {book.pages && (<><dt>ページ数</dt><dd className="num">{book.pages}</dd></>)}
              {book.isbn13 && (<><dt>ISBN</dt><dd className="num">{book.isbn13}</dd></>)}
              <dt>読んだ回数</dt><dd className="num">{book.timesFinished}回</dd>
              <dt>合計読書時間</dt><dd className="num">{formatMinutes(book.totalMinutes)}</dd>
            </dl>
          </div>

          <div className="field">
            <span className="fl">タグ</span>
            <TagEditor value={book.tags} allTags={allTags} onChange={(tags) => act(() => api().setTags(book.id, tags))} />
          </div>

          {(r.status === 'reading' || r.status === 'tsundoku') && (
            <div className="timer">
              <b className="num">{running ? formatClock(timer.elapsedSec) : '00:00'}</b>
              {running ? (
                <button className="btn run" onClick={timer.stop}>■ 止めて記録</button>
              ) : (
                <button className="btn" onClick={() => timer.start(book, r.id)} disabled={!!timer.running}>▶ 読書タイマー開始</button>
              )}
              <form
                className="row"
                onSubmit={(e) => {
                  e.preventDefault();
                  const m = Number(manual);
                  void act(() => api().addSession(r.id, m), `${formatMinutes(m)}を記録しました`).then((ok) => ok && setManual(''));
                }}
              >
                <input
                  className="minutes"
                  type="number"
                  min={1}
                  max={1440}
                  placeholder="分"
                  aria-label="読書時間を手入力（分）"
                  value={manual}
                  onChange={(e) => setManual(e.target.value)}
                />
                <button className="btn ghost sm" type="submit" disabled={!manual}>＋ 手入力で記録</button>
              </form>
              <span className="note">今回（{r.roundNo}回目）：{formatMinutes(r.minutes)}</span>
            </div>
          )}

          <div className="field">
            <span className="fl">{r.roundNo}回目の状態</span>
            <div className="seg" role="group">
              {(Object.keys(STATUS_LABEL) as ReadStatus[]).map((k) => (
                <button key={k} type="button" aria-pressed={r.status === k} onClick={() => setStatus(k)}>{STATUS_LABEL[k]}</button>
              ))}
            </div>
          </div>

          <div className="field">
            <span className="fl">{r.roundNo}回目の評価</span>
            <div className="bigstars" role="radiogroup" aria-label="評価">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  role="radio"
                  aria-checked={r.rating === n}
                  aria-label={`${n}`}
                  onClick={() => act(() => api().setRating(r.id, r.rating === n ? null : n))}
                >
                  {r.rating && n <= r.rating ? '★' : '☆'}
                </button>
              ))}
            </div>
          </div>

          <label className="field">
            <span className="fl">所感</span>
            <textarea
              value={impression}
              placeholder="感じたこと、印象に残った箇所など"
              onChange={(e) => onImpression(e.target.value)}
              onBlur={() => { if (!saved) void flushImpression(impression); }}
            />
          </label>

          <div className="field">
            <span className="fl">日常に活かせそうなこと</span>
            {r.takeaways.length > 0 && (
              <ul className="takeaways">
                {r.takeaways.map((t) => (
                  <li key={t.id}>
                    {t.text}
                    <button className="x" aria-label="削除" onClick={() => act(() => api().removeTakeaway(t.id))}>✕</button>
                  </li>
                ))}
              </ul>
            )}
            <input
              placeholder="1つ書いてEnterで追加"
              value={takeaway}
              onChange={(e) => setTakeaway(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && takeaway.trim()) {
                  const text = takeaway;
                  setTakeaway('');
                  void act(() => api().addTakeaway(r.id, text));
                }
              }}
            />
          </div>

          <div className="field">
            <span className="fl">読書の履歴</span>
            <div className="scroll">
              <table className="rounds">
                <thead><tr><th>回</th><th>状態</th><th>期間</th><th>時間</th><th>評価</th></tr></thead>
                <tbody>
                  {[...book.rounds].reverse().map((x) => (
                    <tr key={x.id} aria-current={x.id === r.id}>
                      <td>{x.roundNo}回目</td>
                      <td>{STATUS_LABEL[x.status]}</td>
                      <td className="num">{x.startedOn ?? '—'} 〜 {x.finishedOn ?? '—'}</td>
                      <td className="num">{x.minutes ? formatMinutes(x.minutes) : '—'}</td>
                      <td><Stars n={x.rating} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="row">
            {(r.status === 'done' || r.status === 'stopped') && (
              <button className="btn ghost" onClick={() => act(() => api().startReread(book.id), `${r.roundNo + 1}回目の読書を始めました`)}>
                ↻ 再読する（{r.roundNo + 1}回目を始める）
              </button>
            )}
            <span className="saved">{saved ? '入力は自動で保存されます' : '保存中…'}</span>
            <span className="spacer" />
            {confirmDelete ? (
              <>
                <span className="note">この本と読書記録をすべて削除しますか？</span>
                <button className="btn danger sm" onClick={() => act(() => api().deleteBook(book.id)).then((ok) => ok && onDeleted())}>削除する</button>
                <button className="btn ghost sm" onClick={() => setConfirmDelete(false)}>やめる</button>
              </>
            ) : (
              <button className="btn ghost sm" onClick={() => setConfirmDelete(true)}>この本を削除</button>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
