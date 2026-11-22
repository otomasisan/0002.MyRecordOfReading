import type { Dashboard } from '../shared/types';
import { formatMinutes } from './api';

/** Today's reading, the yearly goal and a takeaway to look back on. */
export function DashboardStrip({ dash, onGoal }: { dash: Dashboard; onGoal: () => void }) {
  const { goalBooks } = dash.settings;
  const pct = goalBooks ? Math.min(100, (dash.finishedThisYear / goalBooks) * 100) : 0;
  const diff = dash.thisMonthMinutes - dash.lastMonthMinutes;

  return (
    <div className="today-grid">
      <div className="tcard">
        <span className="lbl">今日の読書</span>
        <b className="num">{formatMinutes(dash.todayMinutes)}</b>
        <span className="sub">
          {dash.streak > 0 ? <>連続 <b className="num">{dash.streak}日</b>{dash.todayMinutes === 0 && '（今日読むと継続）'}</> : '今日読むと連続記録が始まります'}
        </span>
      </div>
      <div className="tcard">
        <span className="lbl">{dash.year}年の目標{goalBooks ? ` ${goalBooks}冊` : ''}</span>
        {goalBooks ? (
          <>
            <b className="num">{dash.finishedThisYear}<small> / {goalBooks}冊</small></b>
            <div className="prog" role="progressbar" aria-valuenow={dash.finishedThisYear} aria-valuemax={goalBooks}><i style={{ width: `${pct}%` }} /></div>
            <span className="sub">
              {dash.finishedThisYear >= goalBooks ? '目標達成！' : `今のペースなら年末に約${dash.projectedBooks}冊`}
            </span>
            {dash.settings.goalHours > 0 && (
              <span className="sub">読書時間 {Math.floor(dash.minutesThisYear / 60)} / {dash.settings.goalHours}時間</span>
            )}
          </>
        ) : (
          <>
            <b className="num">{dash.finishedThisYear}<small>冊読了</small></b>
            <button className="linkish" onClick={onGoal}>年間目標を決める</button>
          </>
        )}
      </div>
      <div className="tcard">
        <span className="lbl">今月の読書時間</span>
        <b className="num">{formatMinutes(dash.thisMonthMinutes)}</b>
        <span className="sub">
          {dash.lastMonthMinutes === 0 && dash.thisMonthMinutes === 0
            ? 'タイマーで記録すると集計されます'
            : diff >= 0
              ? `先月より ${formatMinutes(diff)} 多い`
              : `先月まであと ${formatMinutes(-diff)}`}
        </span>
      </div>
      {dash.recall && (
        <div className="recall">
          <span>振り返り（『{dash.recall.title}』で書いたこと）</span>
          <p>{dash.recall.text}</p>
        </div>
      )}
    </div>
  );
}
