import { useEffect, useState } from 'react';
import { errorMessage, formatClock } from './api';

interface Running {
  readId: number;
  bookId: number;
  title: string;
  startedAt: number;
}

interface Stopped extends Running {
  minutes: number;
}

const KEY = 'reading-timer';

function load(): Running | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return v && typeof v.startedAt === 'number' ? v : null;
  } catch {
    return null;
  }
}

function persist(v: Running | null) {
  try {
    if (v) localStorage.setItem(KEY, JSON.stringify(v));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: the timer still works until the app closes */
  }
}

export type Timer = ReturnType<typeof useTimer>;

/**
 * One reading timer for the whole app. It survives a restart because the
 * start time is kept in local storage. Stopping asks for confirmation so a
 * forgotten timer can be corrected before it is saved.
 */
export function useTimer(save: (readId: number, minutes: number, title: string) => Promise<void>) {
  const [running, setRunning] = useState<Running | null>(load);
  const [stopped, setStopped] = useState<Stopped | null>(null);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!running) return;
    const h = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(h);
  }, [running]);

  const elapsedSec = running ? Math.max(0, Math.floor((now - running.startedAt) / 1000)) : 0;

  const start = (book: { id: number; title: string }, readId: number) => {
    const r = { readId, bookId: book.id, title: book.title, startedAt: Date.now() };
    setStopped(null);
    setRunning(r);
    setNow(Date.now());
    persist(r);
  };

  const stop = () => {
    if (!running) return;
    const minutes = Math.max(1, Math.round((Date.now() - running.startedAt) / 60000));
    setStopped({ ...running, minutes });
    setRunning(null);
    persist(null);
  };

  const confirm = async (minutes: number) => {
    if (!stopped) return;
    setError(null);
    try {
      await save(stopped.readId, minutes, stopped.title);
      setStopped(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return { running, stopped, elapsedSec, error, start, stop, confirm, discard: () => setStopped(null) };
}

export function TimerBar({ timer }: { timer: Timer }) {
  const [minutes, setMinutes] = useState('');
  useEffect(() => {
    if (timer.stopped) setMinutes(String(timer.stopped.minutes));
  }, [timer.stopped]);

  if (timer.running) {
    return (
      <div className="timerbar running">
        <span>『{timer.running.title}』を読書中</span>
        <b className="num">{formatClock(timer.elapsedSec)}</b>
        <button className="btn run" onClick={timer.stop}>■ 止める</button>
      </div>
    );
  }
  if (timer.stopped) {
    return (
      <form
        className="timerbar"
        onSubmit={(e) => {
          e.preventDefault();
          void timer.confirm(Number(minutes));
        }}
      >
        <span>『{timer.stopped.title}』の読書時間</span>
        <input
          aria-label="読書時間（分）"
          className="minutes"
          type="number"
          min={1}
          max={1440}
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          autoFocus
        />
        <span>分</span>
        <button className="btn" type="submit">記録する</button>
        <button className="btn ghost" type="button" onClick={timer.discard}>記録しない</button>
        {timer.error && <span className="error">{timer.error}</span>}
      </form>
    );
  }
  return null;
}
