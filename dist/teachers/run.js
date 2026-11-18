import { mapLimit } from "../core/async.js";
import { stderrNote } from "../core/log.js";
import { downloader } from "../downloader.js";
import { assertDownloadPath } from "../core/paths.js";
import { Javdb } from "../javdb/client.js";
import { pickNames } from "./bookmarks.js";
import { feedFor, mergeFeed, onlyDownloadable, planFeed } from "./feed.js";
import { blank, latestFor } from "./latest.js";
import { subscriptionFeeds } from "./sources.js";
const JOBS = 2;
export function present(row) {
    return {
        bookmark: row.bookmark, official: row.official, date: row.date, number: row.number, title: row.title,
        magnets: row.magnets, hd: row.hd, cnsub: row.cnsub, status: row.status, ...(row.error ? { error: row.error } : {}),
    };
}
export function arrange(rows) {
    const rank = { ok: 0, none: 1, unmatched: 2, error: 3 };
    return [...rows].sort((a, b) => rank[a.status] - rank[b.status] || (b.date ?? '').localeCompare(a.date ?? '')
        || a.bookmark.localeCompare(b.bookmark, 'zh'));
}
export async function runTeachers(options) {
    if (options.action === 'pull')
        assertDownloadPath(options.to);
    const selected = await pickNames(options);
    const client = new Javdb();
    const rows = await mapLimit(selected, JOBS, async (bookmark, index) => {
        try {
            const row = await latestFor(bookmark, client, options.pages);
            stderrNote(`${index + 1}/${selected.length} ${row.status}${row.number ? ` ${row.number}` : ''}`);
            return row;
        }
        catch (error) {
            stderrNote(`${index + 1}/${selected.length} error`);
            return { ...blank(bookmark, 'error'), error: error instanceof Error ? error.message : '失败' };
        }
    });
    const ordered = arrange(rows);
    if (options.action === 'list' || !options.apply) {
        return ordered.map(row => ({ ...present(row), ...(options.action === 'pull' ? { action: row.status === 'ok' ? 'planned' : 'skipped' } : {}) }));
    }
    const backend = downloader(options.config);
    await backend.ready();
    const submitted = [];
    for (const row of ordered) {
        if (row.status !== 'ok' || !row.hash) {
            submitted.push({ ...present(row), action: 'skipped' });
            continue;
        }
        try {
            const result = await backend.download(`magnet:?xt=urn:btih:${row.hash}`, options.to, false);
            submitted.push({ ...present(row), action: result.action, taskId: result.task?.id, phase: result.task?.phase, path: result.task?.path });
        }
        catch (error) {
            submitted.push({ ...present(row), action: 'error', error: error instanceof Error ? error.message : '下载失败' });
        }
    }
    return submitted;
}
export async function runTeachersFeed(options) {
    const client = new Javdb();
    let teacherItems = [];
    if (!options.noTeachers) {
        const selected = await pickNames(options);
        const groups = await mapLimit(selected, JOBS, async (bookmark, index) => {
            try {
                const items = await feedFor(bookmark, client, options.perTeacher);
                stderrNote(`${index + 1}/${selected.length} ${items[0]?.number ?? 'none'}`);
                return items;
            }
            catch (error) {
                stderrNote(`${index + 1}/${selected.length} error ${error instanceof Error ? error.message : '失败'}`);
                return [];
            }
        });
        teacherItems = mergeFeed(groups);
    }
    const tokens = options.subscriptions ?? [];
    const subs = tokens.length ? await subscriptionFeeds(tokens, client, options.perSource ?? 5) : [];
    if (options.downloadable) {
        stderrNote(`有磁力 演员 ${onlyDownloadable(teacherItems).length}/${teacherItems.length}，订阅 ${onlyDownloadable(subs).length}/${subs.length}`
            + '（按列表快照 magnets_count，未校验磁力有效性）');
    }
    return planFeed(teacherItems, subs, options.limit, options.downloadable);
}
