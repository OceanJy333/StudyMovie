// input: javdb.com 网页；output: 演员候选 id、影片页的标题/日期/女演员/磁力；pos: JavDB 网页适配器（App 详情和磁力接口要登录后的替代）。
// 影片页 /v/<id> 免登录，女演员带 `actor-female` 类名，男优没有；磁力列表也在页上。影片页连续请求超过约每秒 1.5 次就会 429，
// 站内搜索页更紧（连续 7 次左右就 403）。所以番号 → id 走 App 片单接口，网页只按 id 取影片页，并按每 0.8 秒一次节流。
// NAS 直连不通 javdb.com，经 NAS_MOVIE_PROXY（mihomo）出去；Mac 直连即可。
import { HttpClient, HttpError } from "../core/http.js";
import { sleep } from "../core/async.js";
const WEB = 'https://javdb.com';
const HEADERS = { 'user-agent': 'Mozilla/5.0', 'accept-language': 'zh-TW' };
const UNITS = { KB: 1 / 1024, MB: 1, GB: 1024, TB: 1024 * 1024 };
function unescapeHtml(text) {
    return text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}
/** 网页搜索结果里的演员卡片：`<a href="/actors/ID" title="名字">`，分类入口（censored 等）不算。 */
export function webActorIds(html) {
    const ids = [...html.matchAll(/<a href="\/actors\/([A-Za-z0-9]+)" title="/g)].map(match => match[1]);
    return [...new Set(ids)];
}
/** 影片页解析。没有 current-title 说明拿到的不是影片页（挑战页、改版），抛错而不是当成「没有演员」。 */
export function parseMoviePage(html) {
    const title = html.match(/<strong class="current-title">([^<]*)<\/strong>/)?.[1];
    if (title === undefined)
        throw new HttpError('JavDB 影片页结构异常');
    const date = html.match(/<span class="value">(\d{4}-\d{2}-\d{2})<\/span>/)?.[1] ?? null;
    const seen = new Set();
    const actresses = [...html.matchAll(/<a class="actor-female" href="\/actors\/([A-Za-z0-9]+)">([^<]+)<\/a>/g)]
        .map(([, id = '', name = '']) => ({ id, name: unescapeHtml(name) }))
        .filter(actress => actress.name && !seen.has(actress.id) && seen.add(actress.id));
    const magnets = [...html.matchAll(/href="magnet:\?xt=urn:btih:([A-Fa-f0-9]{40})[^"]*"[^>]*>\s*<span class="name">([^<]*)<\/span>([\s\S]*?)<\/a>/g)]
        .map(([, hash = '', name = '', rest = '']) => {
        const [, amount = '0', unit = 'MB'] = rest.match(/([\d.]+)\s*([KMGT]B)/i) ?? [];
        return {
            name: unescapeHtml(name), hash: hash.toLowerCase(), size: Math.round(Number(amount) * (UNITS[unit.toUpperCase()] ?? 0)),
            hd: rest.includes('高清'), cnsub: rest.includes('字幕'),
        };
    });
    return { title: unescapeHtml(title), date, actresses, magnets };
}
export class JavdbWeb {
    http;
    constructor(http) {
        this.http = http ?? new HttpClient({
            label: 'JavDB 网页', concurrency: 3, minIntervalMs: 800, timeoutMs: 25_000, proxy: process.env.NAS_MOVIE_PROXY || undefined,
        });
    }
    // 同一次运行里整理要演员、选片要磁力，可能问同一部；只取一次。失败的不留，下次重取。
    pages = new Map();
    // 429（Please take a rest）是短时限流：歇 5 秒再试一次。
    async page(path) {
        const get = () => this.http.bytes(`${WEB}${path}`, { headers: HEADERS, retries: 1, retryStatus: [408, 500, 502, 503, 504] });
        try {
            return (await get()).toString('utf8');
        }
        catch (error) {
            if (!(error instanceof HttpError) || error.status !== 429)
                throw error;
            await sleep(5000);
            return (await get()).toString('utf8');
        }
    }
    async actorIds(name) {
        return webActorIds(await this.page(`/search?q=${encodeURIComponent(name)}&f=actor`));
    }
    movie(id) {
        let pending = this.pages.get(id);
        if (!pending) {
            pending = this.page(`/v/${encodeURIComponent(id)}`).then(parseMoviePage);
            pending.catch(() => this.pages.delete(id));
            this.pages.set(id, pending);
        }
        return pending;
    }
}
