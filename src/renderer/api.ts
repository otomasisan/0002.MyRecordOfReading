import type { Api } from '../shared/types';

declare global {
  interface Window {
    api: Api;
  }
}

export const api = (): Api => window.api;

/** Electron wraps errors thrown in the main process; keep only our message. */
export function errorMessage(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

export function formatMinutes(m: number): string {
  if (m <= 0) return '0分';
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? `${h}時間${r ? `${r}分` : ''}` : `${r}分`;
}

export function formatClock(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}
