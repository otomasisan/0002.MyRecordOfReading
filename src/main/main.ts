import { app, BrowserWindow, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from 'sql.js';
import { Store } from './db';
import { downloadCover, fetchBookInfo, normalizeIsbn } from './isbn';
import type { LookupResult, NewBookInput } from '../shared/types';

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
