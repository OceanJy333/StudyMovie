// input: 收藏夹老师名册 + JavDB 片单页；output: 全量作品目录（带拼盘/BD 标记）；pos: 作品目录同步。
import { mapLimit } from "../core/async.js";
import { stderrNote } from "../core/log.js";
import { FIXED_CODES, resolveActor } from "../javdb/actor.js";
import { isBluRayEdition, looksLikeCompilation } from "../javdb/classify.js";
import { Javdb } from "../javdb/client.js";
import { catalogPath, readCatalog, writeCatalog } from "./store.js";
const PAGE_SHORT = 8; // JavDB 每页 10 条，不满一页说明翻到底了
const JOBS = 3; // keep-alive 之后 3 路并发足够快，再高容易 429
/**
 * 每位老师翻 pages 页片单，收录全部作品（含没有磁力的），因为墙上要能看到「有这部但下不了」。
 * 一部作品被多位老师翻到 = 多女优共演/拼盘；标题命中合集成语也算。bd = 蓝光重发版。
 * 增量规则：老师上次已完整同步过时，从第 2 页起只要整页番号都已在目录里就停——
 * 新作一定出现在按发行日期倒序的第一页，老页的磁力数不值得每天重扫。
 */
export async function syncCatalog(options) {
    const client = options.catalog ?? new Javdb();
    const note = options.onNote ?? stderrNote;
    const path = options.path ?? catalogPath;
    const now = options.now ?? new Date();
    const stamp = now.toISOString();
    const doc = await readCatalog(path);
    const before = Object.keys(doc.entries).length;
    const collected = new Map();
    const failed = [];
    let teachers = 0, pagesRead = 0;
    // 只按固定番号跟踪的人（Tiny）没有演员片单，不进目录。
    await mapLimit(options.names.filter(name => !FIXED_CODES[name]), JOBS, async (bookmark, index) => {
        const fail = (why) => { failed.push(bookmark); note(`老师 ${index + 1}/${options.names.length} ${bookmark} 失败：${why}`); };
        const actor = await resolveActor(bookmark, client).catch((error) => error instanceof Error ? error : new Error('查询失败'));
        if (actor instanceof Error) {
            fail(actor.message);
            return;
        }
        if (!actor) {
            fail('没有固定 id，名字也没找到唯一演员');
            return;
        }
        const actress = (actor.name || bookmark).trim();
        const previous = doc.teachers[bookmark];
        // 只有「上次已覆盖当前深度」才算已建立；把 --pages 调大时会自然回退到全量。
        const depth = previous?.depth ?? (previous?.complete ? options.pages : 0);
        const established = previous?.complete === true && depth >= options.pages;
        teachers++;
        let count = 0, read = 0, reachedEnd = false;
        for (let page = 1; page <= options.pages; page++) {
            // 翻页出错不能当成「翻到底」，否则会把这位老师误记为已完整同步；本次不更新她的同步记录。
            const batch = await client.actorMovies(Number(actor.type) === 0 ? 0 : Number(actor.type), actor.id, page)
                .catch((error) => error instanceof Error ? error : new Error('翻页失败'));
            if (batch instanceof Error) {
                fail(batch.message);
                return;
            }
            if (!batch.length) {
                reachedEnd = true;
                break;
            }
            read++;
            pagesRead++;
            // 按发行日期倒序：整页都早于窗口起点就没必要再翻。
            if (options.since && batch.every(movie => movie.release_date && movie.release_date < options.since))
                break;
            let novel = 0;
            for (const movie of batch) {
                const number = (movie.number || '').toUpperCase();
                if (!number || !movie.id)
                    continue;
                const date = movie.release_date || null;
                if (options.since && date && date < options.since)
                    continue;
                if (!doc.entries[number])
                    novel++;
                const current = collected.get(number) ?? {
                    date, title: movie.title || movie.origin_title || null, movieId: movie.id,
                    magnets: Number(movie.magnets_count) || 0, actresses: new Set(),
                };
                current.actresses.add(actress);
                collected.set(number, current);
                count++;
            }
            // 片单按发行日期倒序：整页都已在目录里，就说明没有新作，不必再翻更早的页。
            if (!options.full && established && novel === 0)
                break;
            if (batch.length < PAGE_SHORT) {
                reachedEnd = true;
                break;
            }
        }
        doc.teachers[bookmark] = {
            id: actor.id, name: actress, syncedAt: stamp, pages: read, depth: options.pages,
            // 翻到底、翻满配置深度、或已建立后提前收工，都说明「当前深度已覆盖」。
            complete: options.since ? (established || reachedEnd) : (established || reachedEnd || read >= options.pages),
        };
        note(`老师 ${index + 1}/${options.names.length} ${actress} 收录 ${count} 部（${read} 页${established ? '，增量' : ''}）`);
    });
    let multi = 0, bluray = 0;
    for (const [number, item] of collected) {
        const previous = doc.entries[number];
        // 增量同步只看得到部分页；来源必须和上次合并，否则深层页的共演片会被误降级成单体。
        const actresses = [...new Set([...(previous?.sources ?? []), ...item.actresses])].sort();
        const isMulti = actresses.length >= 2 || looksLikeCompilation(item.title);
        const bd = isBluRayEdition(item.title);
        if (isMulti)
            multi++;
        if (bd)
            bluray++;
        const entry = {
            number, date: item.date, title: item.title,
            // 共演片会被多位老师翻到，保留字母序第一位，避免每次同步来回改。
            actress: previous?.actress || actresses[0] || '',
            movieId: item.movieId, magnets: item.magnets,
            updatedAt: unchanged(previous, item, actresses) ? previous.updatedAt : stamp,
            sources: actresses, multi: isMulti, bd,
        };
        doc.entries[number] = entry;
    }
    doc.version = 2;
    doc.updatedAt = stamp;
    await writeCatalog(doc, path);
    const total = Object.keys(doc.entries).length;
    return {
        path, total, added: total - before, refreshed: collected.size,
        multi, bluray, failures: failed, teachers, pages: pagesRead,
    };
}
function unchanged(previous, item, actresses) {
    return Boolean(previous && (previous.title ?? '') === (item.title ?? '')
        && (previous.date ?? '') === (item.date ?? '') && previous.movieId === item.movieId
        && previous.magnets === item.magnets && previous.sources.join(',') === actresses.join(','));
}
