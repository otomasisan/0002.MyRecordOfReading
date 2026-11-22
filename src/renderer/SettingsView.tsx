import { useEffect, useState } from 'react';
import { api, errorMessage } from './api';

export function SettingsView({ onSaved, onError }: { onSaved: (message: string) => void; onError: (m: string) => void }) {
  const [books, setBooks] = useState('');
  const [hours, setHours] = useState('');

  useEffect(() => {
    api()
      .getSettings()
      .then((s) => {
        setBooks(String(s.goalBooks));
        setHours(String(s.goalHours));
      })
      .catch((e) => onError(errorMessage(e)));
  }, [onError]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api().setSettings({ goalBooks: Number(books || 0), goalHours: Number(hours || 0) });
      onSaved('目標を保存しました');
    } catch (err) {
      onError(errorMessage(err));
    }
  };

  const exportCsv = async () => {
    try {
      const path = await api().exportCsv();
      if (path) onSaved(`CSVを保存しました：${path}`);
    } catch (err) {
      onError(errorMessage(err));
    }
  };

  return (
    <section className="stack settings" aria-label="設定">
      <h2 className="h">設定</h2>
      <form className="box stack" onSubmit={save}>
        <h3>年間目標</h3>
        <div className="row">
          <label className="field">
            <span className="fl">読了冊数（0で目標なし）</span>
            <span className="row"><input className="minutes" type="number" min={0} value={books} onChange={(e) => setBooks(e.target.value)} />冊</span>
          </label>
          <label className="field">
            <span className="fl">読書時間（0で目標なし）</span>
            <span className="row"><input className="minutes" type="number" min={0} value={hours} onChange={(e) => setHours(e.target.value)} />時間</span>
          </label>
        </div>
        <div><button className="btn" type="submit">保存する</button></div>
      </form>
      <div className="box stack">
        <h3>データ</h3>
        <p className="note">本と読書回ごとに1行のCSVを書き出します。Excelでそのまま開けます。</p>
        <div><button className="btn ghost" onClick={exportCsv}>CSVに書き出す</button></div>
        <p className="note">データ本体は %APPDATA%\my-record-of-reading\reading-log.sqlite にあります。このファイルをコピーすればバックアップになります。</p>
      </div>
    </section>
  );
}
