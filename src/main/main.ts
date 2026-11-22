import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from 'sql.js';
import { Store, systemClock } from './db';
import { dashboard, labelOf, reachedMilestones, toCsv, yearStats } from './stats';
import { downloadCover, fetchBookInfo, normalizeIsbn } from './isbn';
import type { Dashboard, LookupResult, NewBookInput } from '../shared/types';
import { STATUS_LABEL } from '../shared/types';

let store: Store;
let dbPath: string;
let saveTimer: NodeJS.Timeout | null = null;
let exportDb: () => Uint8Array;

function saveNow() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  const tmp = `${dbPath}.tmp`;
  fs.writeFileSync(tmp, exportDb());
  fs.renameSync(tmp, dbPath);
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 300);
}

async function openStore() {
  const SQL = await initSqlJs({
    locateFile: (file) => path.join(path.dirname(require.resolve('sql.js')), file),
  });
  dbPath = path.join(app.getPath('userData'), 'reading-log.sqlite');
  const db = fs.existsSync(dbPath) ? new SQL.Database(fs.readFileSync(dbPath)) : new SQL.Database();
  exportDb = () => db.export();
  store = new Store(db, scheduleSave);
}

function registerIpc() {
  const handle = (name: string, fn: (...args: any[]) => unknown) =>
    ipcMain.handle(name, async (_e, ...args) => fn(...args));

  handle('listBooks', () => store.listBooks());
  handle('getBook', (id: number) => store.getBook(id));
  handle('lookupIsbn', async (raw: string): Promise<LookupResult> => {
    const isbn13 = normalizeIsbn(String(raw));
    if (!isbn13) return { kind: 'invalid', message: 'ISBNの形式が正しくありません（10桁または13桁）' };
    const existing = store.findByIsbn(isbn13);
    if (existing) return { kind: 'existing', book: existing };
    const info = await fetchBookInfo(isbn13, fetch, (m) => console.warn('[lookup]', m));
    return info ? { kind: 'found', info } : { kind: 'notFound', isbn13 };
  });
  handle('addBook', async (input: NewBookInput) => {
    const cover = input.info.coverUrl ? await downloadCover(input.info.coverUrl) : null;
    return store.addBook({ ...input, cover });
  });
  handle('updateBook', (id: number, patch) => store.updateBook(id, patch));
  handle('deleteBook', (id: number) => store.deleteBook(id));
  handle('setTags', (bookId: number, tags: string[]) => store.setTags(bookId, tags));
  handle('listTags', () => store.listTags());
  handle('setStatus', (readId: number, status) => store.setStatus(readId, status));
  handle('setRating', (readId: number, rating: number | null) => store.setRating(readId, rating));
  handle('setImpression', (readId: number, text: string) => store.setImpression(readId, text));
  handle('addTakeaway', (readId: number, text: string) => store.addTakeaway(readId, text));
  handle('removeTakeaway', (id: number) => store.removeTakeaway(id));
  handle('startReread', (bookId: number) => store.startReread(bookId));
  handle('addSession', (readId: number, minutes: number) => store.addSession(readId, minutes));
  handle('todayMinutes', () => store.todayMinutes());
  handle('getDashboard', (): Dashboard => {
    const today = systemClock.today();
    const src = store.statsSource();
    const settings = store.getSettings();
    const fresh = store.recordMilestones(reachedMilestones(src, settings, today));
    return {
      ...dashboard(src, settings, today),
      newMilestones: fresh.map((key) => ({ key, label: labelOf(key), remaining: '', achievedOn: today })),
    };
  });
  handle('getYearStats', (year: number) => yearStats(store.statsSource(), Number(year) || 0, systemClock.today(), store.achievedMilestones()));
  handle('getSettings', () => store.getSettings());
  handle('setSettings', (patch) => store.setSettings(patch));
  handle('exportCsv', async () => {
    const win = BrowserWindow.getFocusedWindow();
    const stamp = systemClock.today().replace(/-/g, '');
    const opts = { defaultPath: `読書記録_${stamp}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] };
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (res.canceled || !res.filePath) return null;
    const rows: (string | number | null)[][] = [
      ['ISBN', '書名', '著者', '出版社', 'タグ', '回', '状態', '開始日', '読了日', '評価', '読書時間（分）', '所感', '日常に活かせそうなこと'],
    ];
    for (const b of store.listBooks()) {
      for (const r of b.rounds) {
        rows.push([
          b.isbn13, b.title, b.authors, b.publisher, b.tags.join(' / '), r.roundNo, STATUS_LABEL[r.status],
          r.startedOn, r.finishedOn, r.rating, r.minutes, r.impression, r.takeaways.map((t) => t.text).join(' / '),
        ]);
      }
    }
    fs.writeFileSync(res.filePath, toCsv(rows), 'utf8');
    return res.filePath;
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 820,
    minHeight: 600,
    title: '読書記録',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadFile(path.join(__dirname, '../../dist/index.html'));
}

// Lets automated checks run against a throwaway data folder.
if (process.env.READING_LOG_DATA_DIR) app.setPath('userData', process.env.READING_LOG_DATA_DIR);

app.whenReady().then(async () => {
  await openStore();
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  if (saveTimer) saveNow();
});

app.on('window-all-closed', () => {
  if (saveTimer) saveNow();
  if (process.platform !== 'darwin') app.quit();
});
