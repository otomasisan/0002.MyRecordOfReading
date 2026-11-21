import { useEffect, useRef, useState } from 'react';
import type { Book, BookInfo, LookupResult, ReadStatus } from '../shared/types';
import { STATUS_LABEL } from '../shared/types';
import { api, errorMessage, formatMinutes } from './api';
import { current } from './BookList';
import { Cover } from './Cover';
import { TagEditor } from './TagEditor';

type Props = {
  lookup: Exclude<LookupResult, { kind: 'invalid' }> | { kind: 'manual' };
  allTags: string[];
  onCancel: () => void;
  onDone: (book: Book, message: string) => void;
  onOpen: (bookId: number) => void;
  onError: (m: string) => void;
};

const SOURCE: Record<BookInfo['source'], string> = {
  openbd: 'openBD',
  google: 'Google Books',
  ndl: '国立国会図書館サーチ',
  manual: '手入力',
};

export function RegisterPanel(props: Props) {
  if (props.lookup.kind === 'existing') return <RereadPanel {...props} book={props.lookup.book} />;
  return <NewBookPanel {...props} />;
}

function RereadPanel({ book, onCancel, onDone, onOpen, onError }: Props & { book: Book }) {
  const r = current(book);
  const inProgress = r.status === 'reading' || r.status === 'tsundoku';
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => primary.current?.focus(), []);

  const reread = async () => {
    try {
      const b = await api().startReread(book.id);
      onDone(b, `『${b.title}』の${current(b).roundNo}回目を始めました`);
    } catch (e) {
      onError(errorMessage(e));
    }
  };

  return (
    <section className="panel" aria-label="登録済みの本">
      <Cover book={book} width={120} />
      <div className="stack">
        <h2>{book.title}</h2>
        <p className="note">
          この本はすでに登録されています（読了{book.timesFinished}回、合計{formatMinutes(book.totalMinutes)}）。
          {inProgress && `${r.roundNo}回目は「${STATUS_LABEL[r.status]}」です。`}
        </p>
        <div className="row">
          {inProgress ? (
            <button ref={primary} className="btn" onClick={() => onOpen(book.id)}>詳細を開く（Enter）</button>
          ) : (
            <button ref={primary} className="btn" onClick={reread}>{r.roundNo + 1}回目の読書を始める（Enter）</button>
          )}
          {!inProgress && <button className="btn ghost" onClick={() => onOpen(book.id)}>詳細を開く</button>}
          <button className="btn ghost" onClick={onCancel}>やめる</button>
        </div>
      </div>
    </section>
  );
}

function NewBookPanel({ lookup, allTags, onCancel, onDone, onError }: Props) {
  const initial: BookInfo =
    lookup.kind === 'found'
      ? lookup.info
      : {
          isbn13: lookup.kind === 'notFound' ? lookup.isbn13 : '',
          title: '',
          authors: '',
          publisher: '',
          published: '',
          pages: null,
          coverUrl: null,
          source: 'manual',
        };
  const [info, setInfo] = useState(initial);
  const [tags, setTags] = useState<string[]>([]);
  const [status, setStatus] = useState<ReadStatus>('reading');
  const [saving, setSaving] = useState(false);
  const first = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (lookup.kind === 'found') first.current?.focus();
    else titleRef.current?.focus();
  }, [lookup.kind]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!info.title.trim()) {
      onError('書名を入力してください');
      titleRef.current?.focus();
      return;
    }
    setSaving(true);
    try {
      const b = await api().addBook({ info, tags, status });
      onDone(b, `『${b.title}』を登録しました`);
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const field = (key: 'title' | 'authors' | 'publisher', label: string) => (
    <label className="field">
      <span className="fl">{label}</span>
      <input
        ref={key === 'title' ? titleRef : undefined}
        value={info[key]}
        onChange={(e) => setInfo({ ...info, [key]: e.target.value })}
      />
    </label>
  );

  return (
    <form className="panel" aria-label="本の登録" onSubmit={submit}>
      <Cover book={{ title: info.title || '（書名）', authors: info.authors, cover: info.coverUrl }} width={120} />
      <div className="stack">
        {lookup.kind === 'found' && <p className="note">{SOURCE[info.source]} から取得しました。違うところだけ直してください。</p>}
        {lookup.kind === 'notFound' && (
          <p className="note">ISBN {lookup.isbn13} の本は見つかりませんでした。書名だけ入れれば登録できます。</p>
        )}
        <div className="fields">
          {field('title', '書名')}
          {field('authors', '著者')}
          {field('publisher', '出版社')}
        </div>
        <div className="field">
          <span className="fl">タグ</span>
          <TagEditor value={tags} allTags={allTags} onChange={setTags} />
        </div>
        <div className="field">
          <span className="fl">状態</span>
          <div className="seg" role="group" aria-label="状態">
            {(['tsundoku', 'reading', 'done'] as ReadStatus[]).map((k) => (
              <button key={k} type="button" aria-pressed={status === k} onClick={() => setStatus(k)}>
                {STATUS_LABEL[k]}
              </button>
            ))}
          </div>
        </div>
        <div className="row">
          <button ref={first} className="btn" type="submit" disabled={saving}>
            {saving ? '登録中…' : '登録する（Enter）'}
          </button>
          <button className="btn ghost" type="button" onClick={onCancel}>やめる</button>
        </div>
      </div>
    </form>
  );
}
