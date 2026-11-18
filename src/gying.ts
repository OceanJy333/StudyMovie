// input: authenticated HTML; output: movie matches and resource rows; pos: GYING adapter.
import { load } from 'cheerio';
import type { Config } from './config.ts';
import type { Resource } from './resources.ts';
import { browserHtml } from './browser.ts';

export interface Movie { id: string; title: string; year: number | null; url: string }
export function parseMovies(html: string, base: string): Movie[] {
  const $ = load(html), found = new Map<string, Movie>();
  $('a[href]').each((_, a) => {
    const href = $(a).attr('href')!;
    const id = href.match(/(?:^|\/)mv\/([a-z\d]+)(?:[?#]|$)/i)?.[1];
    const title = $(a).text().replace(/\s+/g, ' ').trim();
    if (!id || !title) return;
    const year = title.match(/\((\d{4})\)/)?.[1];
    found.set(id, { id, title, year: year ? Number(year) : null, url: new URL(href, base).href });
  });
  return [...found.values()];
}

export function parseResources(html: string, base: string): Resource[] {
  const $ = load(html), found = new Map<string, Resource>();
  $('tr').each((_, tr) => {
    const link = $(tr).find('a[href^="magnet:"]').first();
    const magnet = link.attr('href'), title = link.text().trim();
    if (!magnet || !title) return;
    const cells = $(tr).find('td').map((_, td) => $(td).text().trim()).get();
    const size = cells.findIndex(v => /^[\d.]+\s*(?:GB|GiB|TB|TiB|MB|MiB)$/i.test(v));
    if (size < 0) return;
    const value = parseFloat(cells[size]);
    const sizeGB = /T/i.test(cells[size]) ? value * 1024 : /M/i.test(cells[size]) ? value / 1024 : value;
    const seeds = /^\d+$/.test(cells[size + 1] || '') ? Number(cells[size + 1]) : null;
    const detail = $(tr).find('a[href^="/bt/"]').attr('href');
    found.set(magnet.split('&dn=')[0].toLowerCase(), { title, magnet, sizeGB, seeds, detail: detail ? new URL(detail, base).href : '' });
  });
  return [...found.values()];
}

export function chooseMovie(movies: Movie[], title: string, year?: number): Movie {
  const normalize = (s: string) => s.normalize('NFKC').replace(/[\s·:：-]/g, '').toLowerCase();
  const matches = movies.filter(m => (!year || m.year === year) &&
    (normalize(m.title.replace(/\(\d{4}\).*$/, '').trim()) === normalize(title) ||
      normalize(m.title.split(/\s+[a-z]/i)[0]) === normalize(title)));
  if (matches.length !== 1) throw new Error(`影片未唯一匹配，请先 search，再用 fetch --id：${JSON.stringify(movies)}`);
  return matches[0];
}

export class Gying {
  config: Config;
  browser?: { space: number; page: string };
  constructor(config: Config, browser?: { space: number; page: string }) { this.config = config; this.browser = browser; }
  async html(path: string) {
    const origin = new URL(this.config.gying.baseUrl).origin;
    const url = new URL(path, this.config.gying.baseUrl);
    if (url.origin !== origin) throw new Error('资源 URL 必须属于配置的观影网站');
    if (this.browser) return browserHtml(this.browser.space, this.browser.page, url.href);
    const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(25000), headers: {
      cookie: this.config.gying.cookie || '', 'user-agent': this.config.gying.userAgent || 'Mozilla/5.0',
    } });
    if (r.status >= 300 && r.status < 400) throw new Error('观影要求登录或域名已变更，请运行 auth 导入当前登录态');
    const html = await r.text();
    if (html.trim().startsWith('{')) {
      const data = JSON.parse(html);
      throw new Error(`观影返回 ${data.code || r.status}：${data.msg || '需要浏览器验证'}。完成验证后用 --space ID --site-page pN`);
    }
    if (!r.ok || /<title>[^<]*(安全验证|登录\s*\||未登录)/.test(html) || html.includes('登录后访问受限内容')) {
      throw new Error('观影登录态失效或需要浏览器验证，请在 ego-browser 登录后运行 auth');
    }
    return html;
  }
  async search(title: string) { return parseMovies(await this.html('/search?' + new URLSearchParams({ q: title, type: '1', mode: '1' })), this.config.gying.baseUrl); }
  async resources(id: string) {
    if (!/^[a-z\d]+$/i.test(id)) throw new Error('无效影片 ID');
    const rows = parseResources(await this.html('/mv/' + id), this.config.gying.baseUrl);
    if (!rows.length) throw new Error('未读到资源列表，登录态或网页结构可能变化');
    return rows;
  }
}
