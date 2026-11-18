// input: JavDB App 接口与网页搜索；output: 类型化查询结果；pos: 外部元数据适配器。
// 2026-11-10 起 App 的 /api/v2/search 与 /api/v2/movies/:id 要求登录，日常链路只用免登录的按 id 接口：
// 演员片单 0:a:<id>、厂牌 0:m:<id>、番号前缀 0:c:<前缀>、演员资料 /api/v1/actors/:id。
// 2026-11-14 起磁力接口也要登录：磁力改由 sukebei 按番号提供，JavDB 只负责「有哪些作品」。
// 名字找人只在补新老师时走 javdb.com 网页搜索（限流很紧），结果固化进名册。
import { HttpClient, HttpError } from "../core/http.js";
import { isRecord } from "../core/json.js";
import { mapLimit } from "../core/async.js";
import { movieByNumber } from "./actor.js";
import { javdbSign, javdbUrl } from "./sign.js";
import { Sukebei } from "../sukebei.js";
import { JavdbWeb } from "./web.js";
import { usableMagnets } from "./magnet.js";
const PAGE_SIZE = 10;
const PROBES = 15;
function collection(data, key) {
    const value = data[key];
    if (!Array.isArray(value))
        throw new HttpError(`JavDB 响应缺少 ${key}`);
    return value;
}
/** 番号前缀：`SSIS-001` → `SSIS`，`FC2-PPV-1` → `FC2-PPV`。 */
export function numberPrefix(number) {
    return number.toUpperCase().replace(/-?\d+$/, '');
}
function digitsOf(number) {
    return Number((number ?? '').match(/(\d+)$/)?.[1] ?? NaN);
}
export class Javdb {
    http;
    torrents;
    web;
    constructor(http, torrents, web) {
        this.http = http ?? new HttpClient({ label: 'JavDB', concurrency: 8, timeoutMs: 25_000 });
        this.torrents = torrents ?? new Sukebei();
        this.web = web ?? new JavdbWeb();
    }
    /** 名字找人：网页搜索拿候选 id，再用免登录的演员资料补全类型、别名和作品数。 */
    async searchActors(name) {
        return mapLimit((await this.web.actorIds(name)).slice(0, 6), 3, id => this.actor(id));
    }
    async actor(id) {
        const data = await this.get(`/api/v1/actors/${encodeURIComponent(id)}`);
        if (!isRecord(data.actor))
            throw new HttpError(`JavDB 演员 ${id} 响应异常`);
        return data.actor;
    }
    actorMovies(type, id, page) {
        return this.byFilter(`${type}:a:${id}`, page);
    }
    /** 影片页：标题、日期和女演员（App 详情接口要登录，网页不要）。 */
    moviePage(id) {
        return this.web.movie(id);
    }
    /**
     * 磁力两个来源：有 JavDB id 时先看影片网页（每秒 2 次），没有可用磁力或网页失败再问 sukebei（每秒不到 1 次）。
     * 两边都失败才抛错。
     */
    async magnets(number, id) {
        if (id) {
            try {
                const found = usableMagnets((await this.web.movie(id)).magnets);
                if (found.length)
                    return found;
            }
            catch { /* 网页失败就交给 sukebei，sukebei 也失败才算故障 */ }
        }
        return this.torrents.magnets(number);
    }
    async byFilter(filter, page, order = 'desc') {
        const data = await this.get('/api/v1/movies/tags', { filter_by: filter, sort_by: 'release', order_by: order, page });
        return collection(data, 'movies');
    }
    /**
     * 番号精确查：同前缀片单按发行日倒序、每页 10 部，番号大体同序。按番号差估算跳页，
     * 落到番号区间内再看相邻两页（发行日和番号不完全同序），最多 PROBES 次请求。
     */
    async searchMovie(number) {
        const filter = `0:c:${numberPrefix(number)}`;
        const target = digitsOf(number);
        if (!Number.isFinite(target))
            return null;
        const seen = new Set();
        const queue = [1];
        let lastFull = 1;
        while (queue.length && seen.size < PROBES) {
            const page = queue.shift();
            if (page < 1 || seen.has(page))
                continue;
            seen.add(page);
            const batch = await this.byFilter(filter, page);
            const hit = movieByNumber(batch, number);
            if (hit)
                return hit;
            const digits = batch.map(movie => digitsOf(movie.number)).filter(Number.isFinite);
            // 跳过了片单末尾：退回到上一个有数据的页和这里的中点。
            if (!digits.length) {
                if (page > lastFull + 1)
                    queue.push(Math.ceil((page + lastFull) / 2));
                continue;
            }
            lastFull = Math.max(lastFull, page);
            const low = Math.min(...digits), high = Math.max(...digits);
            if (target > high)
                queue.push(page - Math.max(1, Math.round((target - high) / PAGE_SIZE)));
            else if (target < low)
                queue.push(page + Math.max(1, Math.round((low - target) / PAGE_SIZE)));
            else
                queue.push(page + 1, page - 1);
        }
        return null;
    }
    /** `success !== 1`（如 JWTVerificationError）一律抛错，不能当成空结果——那会让每日任务静默空转。 */
    async get(path, params) {
        const payload = await this.http.json(javdbUrl(path, params), {
            headers: {
                'accept-language': 'zh-TW',
                jdsignature: javdbSign(Math.floor(Date.now() / 1000)),
                'user-agent': 'Dart/3.5 (dart:io)',
            },
            timeoutMs: 25_000,
        });
        if (!isRecord(payload) || payload.success !== 1 || !isRecord(payload.data)) {
            const why = isRecord(payload) ? [payload.action, payload.message].filter(Boolean).join(' ') : '';
            throw new HttpError(`JavDB 接口拒绝 ${path}${why ? `：${why}` : ''}`);
        }
        return payload.data;
    }
}
