import { describe, expect, it } from 'vitest';
import { cleanAuthors, fetchBookInfo, normalizeIsbn, parseGoogleBooks, parseNdl, parseOpenBd } from '../src/main/isbn';

describe('normalizeIsbn', () => {
  it('accepts ISBN-13 with hyphens and full-width digits', () => {
    expect(normalizeIsbn('978-4-10-101013-7')).toBe('9784101010137');
    expect(normalizeIsbn('９７８４１０１０１０１３７')).toBe('9784101010137');
  });
  it('converts ISBN-10 (including X check digit) to ISBN-13', () => {
    expect(normalizeIsbn('4101010137')).toBe('9784101010137');
    expect(normalizeIsbn('080442957X')).toBe('9780804429573');
  });
  it('rejects wrong check digits and non-book barcodes', () => {
    expect(normalizeIsbn('9784101010138')).toBeNull();
    expect(normalizeIsbn('4901234567894')).toBeNull();
    expect(normalizeIsbn('abc')).toBeNull();
  });
});

describe('cleanAuthors', () => {
  it('drops role words and joins names', () => {
    expect(cleanAuthors('夏目漱石／著')).toBe('夏目漱石');
    expect(cleanAuthors('ハンス・ロスリング／著 上杉周作／訳')).toBe('ハンス・ロスリング、上杉周作');
    expect(cleanAuthors('Hans Rosling／著')).toBe('Hans Rosling');
  });
});

describe('parsers', () => {
  it('reads openBD', () => {
    const json = [{
      summary: { isbn: '9784101010137', title: 'こころ', volume: '', author: '夏目漱石／著', publisher: '新潮社', pubdate: '20040301', cover: 'https://cover.openbd.jp/9784101010137.jpg' },
      onix: { DescriptiveDetail: { Extent: [{ ExtentType: '11', ExtentValue: '384' }] } },
    }];
    expect(parseOpenBd('9784101010137', json)).toEqual({
      isbn13: '9784101010137', title: 'こころ', authors: '夏目漱石', publisher: '新潮社', published: '2004-03-01',
      pages: 384, coverUrl: 'https://cover.openbd.jp/9784101010137.jpg', source: 'openbd',
    });
    expect(parseOpenBd('9784101010137', [null])).toBeNull();
  });

  it('reads Google Books', () => {
    const json = { items: [{ volumeInfo: { title: 'FACTFULNESS', subtitle: '10の思い込みを乗り越え', authors: ['ハンス・ロスリング', 'オーラ・ロスリング'], publisher: '日経BP', publishedDate: '2019-01-11', pageCount: 400, imageLinks: { thumbnail: 'http://books.google.com/x.jpg' } } }] };
    expect(parseGoogleBooks('9784822289607', json)).toMatchObject({
      title: 'FACTFULNESS 10の思い込みを乗り越え', authors: 'ハンス・ロスリング、オーラ・ロスリング', pages: 400,
      coverUrl: 'https://books.google.com/x.jpg', source: 'google',
    });
    expect(parseGoogleBooks('9784822289607', { totalItems: 0 })).toBeNull();
  });

  it('reads NDL Search RSS', () => {
    const xml = `<rss><channel><title>NDL</title><item><title>こころ</title><dc:title>こころ</dc:title><dc:creator>夏目漱石 著</dc:creator><dc:publisher>新潮社</dc:publisher><dcterms:issued xsi:type="dcterms:W3CDTF">2004.3</dcterms:issued><dc:extent>384p ; 16cm</dc:extent></item></channel></rss>`;
    expect(parseNdl('9784101010137', xml)).toMatchObject({ title: 'こころ', authors: '夏目漱石', publisher: '新潮社', published: '2004-03', pages: 384, source: 'ndl' });
    expect(parseNdl('9784101010137', '<rss><channel></channel></rss>')).toBeNull();
  });
});

describe('fetchBookInfo', () => {
  const res = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body, text: async () => String(body) }) as Response;

  it('falls back to Google Books when openBD has nothing or fails', async () => {
    const calls: string[] = [];
    const f = (async (url: string) => {
      calls.push(new URL(url).host);
      if (url.includes('openbd')) return res([null]);
      return res({ items: [{ volumeInfo: { title: 'X' } }] });
    }) as unknown as typeof fetch;
    expect((await fetchBookInfo('9784101010137', f))?.source).toBe('google');
    expect(calls).toEqual(['api.openbd.jp', 'www.googleapis.com']);
  });

  it('returns null when every service misses', async () => {
    const f = (async (url: string) => {
      if (url.includes('openbd')) throw new Error('offline');
      if (url.includes('google')) return res({}, false);
      return res('<rss></rss>');
    }) as unknown as typeof fetch;
    const log: string[] = [];
    expect(await fetchBookInfo('9784101010137', f, (m) => log.push(m))).toBeNull();
    expect(log).toHaveLength(2);
  });
});
