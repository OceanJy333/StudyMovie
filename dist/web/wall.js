import { splitActresses } from "../library/naming.js";
// 本地文件优先；目录里已经下过的按番号跳过，避免同一部出现两张卡。
export function buildWall(local, catalog, submitted) {
    const have = new Set(local.map(item => item.number));
    const items = local.map(item => ({
        number: item.number, date: item.date, actress: item.actress, title: item.title, cover: item.cover,
        sizeBytes: item.sizeBytes, addedAt: item.addedAt, file: item.file, downloaded: true, magnets: 1,
        submitted: false, bd: false,
    }));
    let multi = 0;
    for (const entry of Object.values(catalog)) {
        if (have.has(entry.number))
            continue;
        // 拼盘/合集不上墙：一部挂十几位老师的精选片，混进来会把每个人的缺口算高。
        if (entry.multi) {
            multi++;
            continue;
        }
        items.push({
            number: entry.number, date: entry.date, actress: entry.actress, title: entry.title,
            cover: entry.movieId ? `/cover/${encodeURIComponent(entry.number)}.jpg` : null,
            sizeBytes: 0, addedAt: null, file: null, downloaded: false,
            magnets: entry.magnets, submitted: submitted.has(entry.number), bd: Boolean(entry.bd),
        });
    }
    items.sort((a, b) => (b.date ?? '0000').localeCompare(a.date ?? '0000') || a.number.localeCompare(b.number));
    return { items, multi };
}
/** 只关心条目列表时的简写；拼盘计数用 buildWall。 */
export function mergeWall(local, catalog, submitted) {
    return buildWall(local, catalog, submitted).items;
}
export function wallCounts(items, multi = 0) {
    let downloaded = 0, totalBytes = 0;
    for (const item of items) {
        if (!item.downloaded)
            continue;
        downloaded++;
        totalBytes += item.sizeBytes;
    }
    return { total: items.length, downloaded, missing: items.length - downloaded, multi, totalBytes };
}
// 片库已按发行日期倒序，所以每个演员第一次出现的那条就是她最新的作品，拿来当封面。共演作品算进每位演员名下。
export function groupByActress(items) {
    const groups = new Map();
    for (const item of items)
        for (const name of splitActresses(item.actress)) {
            const group = groups.get(name)
                ?? { name, count: 0, total: 0, totalBytes: 0, cover: null, latestNumber: '', latestDate: null };
            group.total += 1;
            if (item.downloaded) {
                group.count += 1;
                group.totalBytes += item.sizeBytes;
            }
            if (!group.cover && item.cover) {
                group.cover = item.cover;
                group.latestNumber = item.number;
                group.latestDate = item.date;
            }
            groups.set(name, group);
        }
    return [...groups.values()].sort((a, b) => b.count - a.count || b.total - a.total || a.name.localeCompare(b.name, 'zh'));
}
