// input: 番号；output: 该番号的磁力候选；pos: 磁力来源适配器（sukebei.nyaa 公开 RSS）。
// 2026-11-14 起 JavDB 磁力接口也要求登录。磁力改从 sukebei 的公开 RSS 取，只按番号查，不依赖 JavDB 账号。
// NAS 直连不通，经 NAS_MOVIE_PROXY（mihomo）出去；Mac 直连即可。
import { HttpClient } from './core/http.ts';
import type { Magnet } from './javdb/types.ts';

const RSS = 'https://sukebei.nyaa.si/?page=rss&c=0_0&f=0&q=';

const UNITS: Record<string, number> = { KiB: 1 / 1024, MiB: 1, GiB: 1024, TiB: 1024 * 1024 };

function unescapeXml(text: string): string {
  return text.replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** 标题里必须出现完整番号（`MIDA-857`/`MIDA857`），前后不能再接字母数字，避免 MIDA-8570 这类误中。 */
export function mentionsNumber(title: string, number: string): boolean {
  const [prefix, digits] = number.toUpperCase().split(/-(?=\d+$)/);
  if (!prefix || !digits) return false;
  const escaped = prefix.replace(/[^A-Z0-9]/g, char => `\\${char}`);
  return new RegExp(`(^|[^A-Z0-9])${escaped}-?0*${Number(digits)}(?![0-9])`, 'i').test(title);
}

export interface SukebeiItem extends Magnet { seeders: number }

export function parseRss(xml: string): SukebeiItem[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, body = '']) => {
    const field = (tag: string) => unescapeXml(body.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1] ?? '');
    const [, amount = '0', unit = 'MiB'] = field('nyaa:size').match(/([\d.]+)\s*(\w+)/) ?? [];
    const name = field('title');
    return {
      name, hash: field('nyaa:infoHash').toLowerCase(), size: Math.round(Number(amount) * (UNITS[unit] ?? 0)),
      // 文件名里写明 1080p/FHD/4K/H265 的当作高清；bestMagnet 同一部优先非高清、体积小的版本。
      hd: /1080|FHD|2160|4K|H\.?265|HEVC/i.test(name), seeders: Number(field('nyaa:seeders')) || 0,
    };
  });
}

/** 只留这部的种子：有人做种的优先；AI 去码（Reducing Mosaic）是改过的版本，有原版就不选它。 */
export function pickReleases(items: readonly SukebeiItem[], number: string): SukebeiItem[] {
  const ours = items.filter(item => mentionsNumber(item.name ?? '', number));
  const seeded = ours.filter(item => item.seeders > 0);
  const pool = seeded.length ? seeded : ours;
  const original = pool.filter(item => !/reduc\w* mosaic/i.test(item.name ?? ''));
  return original.length ? original : pool;
}

export class Sukebei {
  private readonly http: HttpClient;

  constructor(http?: HttpClient) {
    this.http = http ?? new HttpClient({ label: 'sukebei', concurrency: 2, minIntervalMs: 1300, timeoutMs: 30_000, proxy: process.env.NAS_MOVIE_PROXY || undefined });
  }

  async magnets(number: string): Promise<Magnet[]> {
    const xml = (await this.http.bytes(RSS + encodeURIComponent(`"${number}"`), { headers: { 'user-agent': 'Mozilla/5.0' } })).toString('utf8');
    if (!xml.includes('<rss')) throw new Error(`sukebei 没有返回 RSS（${number}）`);
    return pickReleases(parseRss(xml), number);
  }
}
