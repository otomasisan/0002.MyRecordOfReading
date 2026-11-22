import { useEffect, useState } from 'react';
import type { YearStats } from '../shared/types';
import { api, errorMessage, formatMinutes } from './api';

const level = (m: number) => (m === 0 ? 0 : m <= 15 ? 1 : m <= 30 ? 2 : m <= 60 ? 3 : 4);
const hours = (m: number) => (m >= 600 ? `${Math.round(m / 60)}h` : m >= 60 ? `${(m / 60).toFixed(1)}h` : `${m}m`);

export function StatsView({ version, onOpen, onError }: { version: number; onOpen: (bookId: number) => void; onError: (m: string) => void }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [s, setS] = useState<YearStats | null>(null);

  useEffect(() => {
    api().getYearStats(year).then(setS).catch((e) => onError(errorMessage(e)));
  }, [year, version, onError]);

  if (!s) return <p className="note">集計中…</p>;

  const maxBar = Math.max(1, ...s.bars.map((b) => b.minutes));
  const maxTag = Math.max(1, ...s.byTag.map((t) => t.minutes));
  const maxBook = Math.max(1, ...s.byBook.map((b) => b.minutes));
  const maxRating = Math.max(1, ...s.ratings);
  const period = year === 0 ? '全期間' : `${year}年`;
  const firstDay = s.calendar.length ? new Date(`${s.calendar[0].date}T00:00:00Z`).getUTCDay() : 0;

  return (
    <section className="stats-view" aria-label="統計">
      <div className="row">
        <h2 className="h">統計</h2>
        <div className="seg" role="group" aria-label="期間">
          {s.years.map((y) => (
            <button key={y} aria-pressed={year === y} onClick={() => setYear(y)}>{y}年</button>
          ))}
          <button aria-pressed={year === 0} onClick={() => setYear(0)}>全期間</button>
        </div>
      </div>

      <div className="stat-tiles">
        <div className="stat"><b className="num">{s.finished}冊</b><span>{period}の読了</span></div>
        <div className="stat"><b className="num">{formatMinutes(s.minutes)}</b><span>{period}の読書時間</span></div>
        <div className="stat"><b className="num">{s.streak}日</b><span>連続読書（最長 {s.longestStreak}日）</span></div>
        <div className="stat"><b className="num">{s.avgRating ?? '—'}</b><span>平均評価（5段階）</span></div>
      </div>

      <div className="box">
        <h3>読書カレンダー（{year === 0 ? '過去1年' : `${year}年`}、1日の読書時間）</h3>
        <div className="scroll">
          <div className="heat" role="img" aria-label="日ごとの読書時間">
            {Array.from({ length: firstDay }, (_, i) => <i key={`pad${i}`} className="pad" />)}
            {s.calendar.map((d) => (
              <i key={d.date} className={`l${level(d.minutes)}`} title={`${d.date}：${formatMinutes(d.minutes)}`} />
            ))}
          </div>
        </div>
        <div className="legend">少ない <i className="l0" /><i className="l1" /><i className="l2" /><i className="l3" /><i className="l4" /> 多い</div>
      </div>

      <div className="box">
        <h3>{year === 0 ? '年ごと' : '月ごと'}の読書時間と読了冊数</h3>
        <div className="scroll">
          <div className="bars" style={{ gridTemplateColumns: `repeat(${s.bars.length}, minmax(32px, 1fr))` }}>
            {s.bars.map((b) => (
              <div key={b.label} className="b" style={{ height: `${(b.minutes / maxBar) * 100}%` }} title={`${b.label}：${formatMinutes(b.minutes)}、${b.finished}冊`}>
                {b.minutes > 0 && <em>{hours(b.minutes)}</em>}
              </div>
            ))}
          </div>
          <div className="labels" style={{ gridTemplateColumns: `repeat(${s.bars.length}, minmax(32px, 1fr))` }}>
            {s.bars.map((b) => <span key={b.label}>{b.label}<br />{b.finished}冊</span>)}
          </div>
        </div>
      </div>

      <div className="two">
        <div className="box">
          <h3>タグ別の読書時間</h3>
          {s.byTag.length === 0 ? <p className="note">タグを付けた本の読書時間がここに出ます。</p> : s.byTag.map((t) => (
            <div key={t.tag} className="hbar">
              <span className="name">{t.tag}（{t.books}冊）</span>
              <i style={{ width: `${(t.minutes / maxTag) * 100}%` }} />
              <span className="v num">{formatMinutes(t.minutes)}</span>
            </div>
          ))}
          {s.byTag.length > 0 && <p className="note">1冊に複数のタグがある場合は、それぞれのタグに時間を数えます。</p>}
        </div>
        <div className="box">
          <h3>本ごとの読書時間と読んだ回数</h3>
          {s.byBook.length === 0 ? <p className="note">読書時間を記録した本がここに出ます。</p> : s.byBook.slice(0, 15).map((b) => (
            <button key={b.bookId} className="hbar linkrow" onClick={() => onOpen(b.bookId)}>
              <span className="name">{b.title}</span>
              <i style={{ width: `${(b.minutes / maxBook) * 100}%` }} />
              <span className="v num">{formatMinutes(b.minutes)}・{b.timesRead}回</span>
            </button>
          ))}
        </div>
      </div>

      <div className="two">
        <div className="box">
          <h3>評価の分布</h3>
          {[5, 4, 3, 2, 1].map((n) => (
            <div key={n} className="hbar">
              <span className="name stars">{'★'.repeat(n)}</span>
              <i style={{ width: `${(s.ratings[n - 1] / maxRating) * 100}%` }} />
              <span className="v num">{s.ratings[n - 1]}冊</span>
            </div>
          ))}
        </div>
        <div className="box">
          <h3>節目の記録</h3>
          <div className="badges">
            {s.milestones.map((m) => (
              <div key={m.key} className={`badge${m.achievedOn ? '' : ' locked'}`}>
                <b>{m.label}</b>
                <span>{m.achievedOn ?? m.remaining}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
