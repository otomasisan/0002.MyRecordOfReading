import { contextBridge, ipcRenderer } from 'electron';
import type { Api } from '../shared/types';

const names: (keyof Api)[] = [
  'listBooks', 'getBook', 'lookupIsbn', 'addBook', 'updateBook', 'deleteBook', 'setTags', 'listTags',
  'setStatus', 'setRating', 'setImpression', 'addTakeaway', 'removeTakeaway', 'startReread', 'addSession', 'todayMinutes',
  'getDashboard', 'getYearStats', 'getSettings', 'setSettings', 'exportCsv',
];

const api = Object.fromEntries(
  names.map((n) => [n, (...args: unknown[]) => ipcRenderer.invoke(n, ...args)]),
) as unknown as Api;

contextBridge.exposeInMainWorld('api', api);
