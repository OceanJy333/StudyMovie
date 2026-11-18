// input: 书签名字与 JavDB 片单；output: 每人最新一部可下载作品；pos: 老师最新作品解析。
import { FIXED_CODES, resolveActor } from "../javdb/actor.js";
import { looksLikeCompilation } from "../javdb/classify.js";
import { bestMagnet, usableMagnets } from "../javdb/magnet.js";
import { mapLimit } from "../core/async.js";
import { stderrNote } from "../core/log.js";
const PAGE_SHORT = 8;
const JOBS = 2;
export function blank(bookmark, status, official = null) {
    return { bookmark, official, date: null, number: null, title: null, magnets: null, hd: null, cnsub: null, status };
}
export async function takeMovie(bookmark, official, movie, catalog) {
    if (!movie.id || !movie.number)
        return null;
    // 拼盘合集直接跳过，让这个人去找她自己的下一部。
    if (looksLikeCompilation(movie.title || movie.origin_title))
        return null;
    const usable = usableMagnets(await catalog.magnets(movie.number));
    const best = bestMagnet(usable);
    if (!best?.hash)
        return null;
    return {
        bookmark, official, date: movie.release_date || null, number: movie.number, title: movie.title || null,
        magnets: usable.length, hd: Boolean(best.hd), cnsub: Boolean(best.cnsub), status: 'ok', hash: best.hash.toLowerCase(),
    };
}
export async function latestFor(bookmark, catalog, maxPages = 4) {
    const fixed = FIXED_CODES[bookmark];
    if (fixed) {
        const movie = await catalog.searchMovie(fixed);
        const picked = movie && (movie.number || '').toUpperCase() === fixed.toUpperCase() ? await takeMovie(bookmark, bookmark, movie, catalog) : null;
        return picked ?? blank(bookmark, 'none', bookmark);
    }
    const actor = await resolveActor(bookmark, catalog);
    if (!actor)
        return blank(bookmark, 'unmatched');
    const movies = [];
    for (let page = 1; page <= maxPages; page++) {
        const batch = await catalog.actorMovies(Number(actor.type) === 0 ? 0 : Number(actor.type), actor.id, page);
        movies.push(...batch);
        if (batch.length < PAGE_SHORT)
            break;
    }
    for (const movie of movies) {
        if (movie.magnets_count === 0)
            continue;
        const picked = await takeMovie(bookmark, actor.name || bookmark, movie, catalog);
        if (picked)
            return picked;
    }
    return blank(bookmark, 'none', actor.name || null);
}
export function orderCandidates(candidates) {
    return [...candidates].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.number.localeCompare(b.number));
}
// 自动下载只收「磁力已校验」的候选：演员走 latestFor（逐条取磁力并选最优）。
export async function teacherCandidates(names, catalog, pages) {
    const failed = [];
    const rows = await mapLimit(names, JOBS, async (bookmark, index) => {
        try {
            const row = await latestFor(bookmark, catalog, pages);
            stderrNote(`老师 ${index + 1}/${names.length} ${row.status}${row.number ? ` ${row.number}` : ''}`);
            return row;
        }
        catch (error) {
            failed.push(bookmark);
            stderrNote(`老师 ${index + 1}/${names.length} error ${error instanceof Error ? error.message : '失败'}`);
            return blank(bookmark, 'error');
        }
    });
    const candidates = rows.filter(row => row.status === 'ok' && row.hash).map(row => ({
        number: row.number, hash: row.hash, date: row.date, source: row.bookmark, title: row.title,
    }));
    return { candidates: orderCandidates(candidates), failed };
}
