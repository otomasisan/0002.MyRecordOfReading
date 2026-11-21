import type { BookInfo } from '../shared/types';

/**
 * Turns user input (ISBN-10 or ISBN-13, with or without hyphens) into a
 * checked ISBN-13. Returns null when the input is not a valid ISBN.
 */
export function normalizeIsbn(raw: string): string | null {
  const s = raw
    .replace(/[０-９Ｘｘ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s\-ー－‐]/g, '')
    .toUpperCase();
  if (/^\d{13}$/.test(s)) {
    if (!s.startsWith('978') && !s.startsWith('979')) return null;
    return isbn13CheckDigit(s.slice(0, 12)) === s[12] ? s : null;
  }
  if (/^\d{9}[\dX]$/.test(s)) {
    let sum = 0;
    for (let i = 0; i < 10; i++) sum += (s[i] === 'X' ? 10 : Number(s[i])) * (10 - i);
    if (sum % 11 !== 0) return null;
    const body = '978' + s.slice(0, 9);
    return body + isbn13CheckDigit(body);
  }
  return null;
}

function isbn13CheckDigit(first12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (sum % 10)) % 10);
}

const ROLE = '(?:著|作|文|訳|翻訳|編|編著|監修|監訳|絵|画|イラスト|原作|写真)';

/** "夏目漱石／著 山田 太郎／訳" → "夏目漱石、山田 太郎" */
export function cleanAuthors(raw: string): string {
  return raw
    .split(new RegExp(`(?<=[／/]${ROLE})[\\s　]+|[,，、]`, 'u'))
    .map((p) => p.replace(new RegExp(`[／/]${ROLE}$`, 'u'), '').trim())
    .filter(Boolean)
    .join('、');
}

function normalizeDate(raw: string): string {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{4})[-.]?(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
  m = s.match(/^(\d{4})/);
  return m ? m[1] : '';
}

// ---- openBD -----------------------------------------------------------

export function parseOpenBd(isbn13: string, json: unknown): BookInfo | null {
  if (!Array.isArray(json) || !json[0]) return null;
  const item = json[0] as {
    summary?: { title?: string; volume?: string; author?: string; publisher?: string; pubdate?: string; cover?: string };
    onix?: { DescriptiveDetail?: { Extent?: { ExtentType?: string; ExtentValue?: string }[] } };
  };
  const s = item.summary ?? {};
  if (!s.title) return null;
  const extent = item.onix?.DescriptiveDetail?.Extent ?? [];
  const pageValue = extent.find((e) => e.ExtentType === '11')?.ExtentValue ?? extent[0]?.ExtentValue;
  const pages = pageValue ? Number(pageValue) : NaN;
  return {
    isbn13,
    title: [s.title, s.volume].filter(Boolean).join(' '),
    authors: cleanAuthors(s.author ?? ''),
    publisher: s.publisher ?? '',
    published: normalizeDate(s.pubdate ?? ''),
    pages: Number.isFinite(pages) && pages > 0 ? pages : null,
    coverUrl: s.cover || null,
    source: 'openbd',
  };
}

// ---- Google Books ------------------------------------------------------

export function parseGoogleBooks(isbn13: string, json: unknown): BookInfo | null {
  const items = (json as { items?: { volumeInfo?: Record<string, unknown> }[] })?.items;
  const v = items?.[0]?.volumeInfo as
    | { title?: string; subtitle?: string; authors?: string[]; publisher?: string; publishedDate?: string; pageCount?: number; imageLinks?: { thumbnail?: string; smallThumbnail?: string } }
    | undefined;
  if (!v?.title) return null;
  const thumb = v.imageLinks?.thumbnail ?? v.imageLinks?.smallThumbnail ?? null;
  return {
    isbn13,
    title: [v.title, v.subtitle].filter(Boolean).join(' '),
    authors: (v.authors ?? []).join('、'),
    publisher: v.publisher ?? '',
    published: normalizeDate(v.publishedDate ?? ''),
    pages: v.pageCount && v.pageCount > 0 ? v.pageCount : null,
    coverUrl: thumb ? thumb.replace(/^http:/, 'https:') : null,
    source: 'google',
  };
}

// ---- 国立国会図書館サーチ (OpenSearch, RSS) ---------------------------------

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

export function parseNdl(isbn13: string, xml: string): BookInfo | null {
  const item = xml.match(/<item>([\s\S]*?)<\/item>/)?.[1];
  if (!item) return null;
  const tag = (name: string) => [...item.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'g'))].map((m) => decodeXml(m[1]));
  const title = tag('dc:title')[0] ?? tag('title')[0];
  if (!title) return null;
  const creators = tag('dc:creator').map((c) => c.replace(/\s*(著|作|訳|編|監修)$/u, '').replace(/,\s*\d{4}-?(\d{4})?$/, ''));
  const extent = tag('dc:extent')[0] ?? '';
  const pages = Number(extent.match(/(\d+)\s*p/)?.[1] ?? NaN);
  return {
    isbn13,
    title,
    authors: creators.join('、'),
    publisher: tag('dc:publisher')[0] ?? '',
    published: normalizeDate((tag('dcterms:issued')[0] ?? tag('dc:date')[0] ?? '').replace(/\./g, '-')),
    pages: Number.isFinite(pages) ? pages : null,
    coverUrl: `https://ndlsearch.ndl.go.jp/thumbnail/${isbn13}.jpg`,
    source: 'ndl',
  };
}

// ---- lookup -----------------------------------------------------------

type Fetch = typeof fetch;

async function getJson(f: Fetch, url: string): Promise<unknown> {
  const res = await f(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

/**
 * Looks the book up in openBD, then Google Books, then NDL Search, and
 * returns the first hit. Network errors in one service fall through to the next.
 */
export async function fetchBookInfo(isbn13: string, f: Fetch = fetch, log: (m: string) => void = () => {}): Promise<BookInfo | null> {
  const sources: [string, () => Promise<BookInfo | null>][] = [
    ['openBD', async () => parseOpenBd(isbn13, await getJson(f, `https://api.openbd.jp/v1/get?isbn=${isbn13}`))],
    ['Google Books', async () => parseGoogleBooks(isbn13, await getJson(f, `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn13}`))],
    [
      'NDL',
      async () => {
        const res = await f(`https://ndlsearch.ndl.go.jp/api/opensearch?isbn=${isbn13}`, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(`${res.status}`);
        return parseNdl(isbn13, await res.text());
      },
    ],
  ];
  for (const [name, get] of sources) {
    try {
      const info = await get();
      if (info) return info;
    } catch (e) {
      log(`${name}: ${(e as Error).message}`);
    }
  }
  return null;
}

/** Downloads a cover image and returns it as a data: URL, or null. */
export async function downloadCover(url: string, f: Fetch = fetch): Promise<string | null> {
  try {
    const res = await f(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? 'image/jpeg';
    if (!type.startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // NDL returns a tiny placeholder when it has no cover.
    if (buf.length < 1000) return null;
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}
