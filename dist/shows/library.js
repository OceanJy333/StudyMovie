// input: 剧集根目录 + 订阅；output: 剧集库清单与归档动作；pos: 剧集库扫描和整理。
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, sep } from 'node:path';
import { safeSegment, videoExtensions } from "../library/naming.js";
import { cleanShowName, episodeTag, matchesShow, parseEpisode, parseSeason } from "./parse.js";
const SUBTITLE = new Set(['.srt', '.ass', '.ssa', '.vtt', '.sup', '.sub', '.idx']);
async function walkVideos(dir, out = []) {
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    }
    catch {
        return out;
    }
    for (const entry of entries) {
        if (entry.name.startsWith('.'))
            continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory())
            await walkVideos(full, out);
        else if (entry.isFile() && videoExtensions.has(extname(entry.name).toLowerCase()))
            out.push(full);
    }
    return out;
}
function isCanonical(relativePath) {
    const segments = relativePath.split(sep);
    return segments.length === 3 && /^Season \d{1,2}$/i.test(segments[1] ?? '');
}
/** 只把「剧名/Season NN/文件」结构的文件算进剧集库；还没归档的留在下载目录。 */
export async function scanShows(root, subscriptions = []) {
    const names = new Set(subscriptions.map(subscription => subscription.name));
    const groups = new Map();
    for (const file of await walkVideos(root)) {
        const rel = relative(root, file);
        if (!isCanonical(rel))
            continue;
        const [name = '', seasonDir = ''] = rel.split(sep);
        const season = parseSeason(seasonDir);
        const info = parseEpisode(basename(file));
        if (!season || !info.episode)
            continue;
        const group = groups.get(name) ?? { episodes: [], totalBytes: 0, updatedAt: '', seen: new Set() };
        const key = `${season}E${info.episode}`;
        if (group.seen.has(key))
            continue;
        group.seen.add(key);
        const info2 = await stat(file).catch(() => null);
        if (!info2)
            continue;
        group.episodes.push({
            season, episode: info.episode, file: rel, sizeBytes: info2.size, addedAt: info2.mtime.toISOString(),
        });
        group.totalBytes += info2.size;
        if (!group.updatedAt || info2.mtime.toISOString() > group.updatedAt)
            group.updatedAt = info2.mtime.toISOString();
        groups.set(name, group);
    }
    return [...groups.entries()].map(([name, group]) => ({
        name, episodes: group.episodes.sort((a, b) => a.season - b.season || a.episode - b.episode),
        totalBytes: group.totalBytes, updatedAt: group.updatedAt || new Date(0).toISOString(),
        subscribed: names.has(name),
    })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name, 'zh'));
}
function aliasesOf(subscription) {
    return subscription.aliases.length ? subscription.aliases : [subscription.query, subscription.name];
}
/** 先按订阅别名匹配目录名，匹配不到再从目录名里剥掉画质/集数标签。 */
export function inferShow(segments, subscriptions) {
    const candidates = segments.slice(0, 2).filter(segment => !/^Season \d{1,2}$/i.test(segment));
    for (const subscription of subscriptions) {
        const aliases = aliasesOf(subscription);
        if (candidates.some(segment => matchesShow(segment, aliases)))
            return { name: subscription.name, subscription };
    }
    const first = candidates[0];
    return { name: first ? cleanShowName(first) : '未分类', subscription: null };
}
async function siblings(dir, stem) {
    const out = [];
    for (const entry of await readdir(dir).catch(() => [])) {
        if (SUBTITLE.has(extname(entry).toLowerCase()) && basename(entry, extname(entry)) === stem)
            out.push(entry);
    }
    return out;
}
/**
 * 把下载目录里的视频移进 `剧名/Season NN/剧名 - S01E03.ext`。
 * 只移动，不删除：目标已存在就跳过，同集不同版本加 (2)，字幕跟着主文件走。
 */
export async function organizeShows(options) {
    const minBytes = (options.minEpisodeMB ?? 15) * 1024 * 1024;
    const settleMs = (options.settleMinutes ?? 15) * 60_000;
    const items = [];
    let moved = 0, skipped = 0;
    for (const file of await walkVideos(options.root)) {
        const rel = relative(options.root, file);
        if (isCanonical(rel))
            continue;
        const segments = rel.split(sep);
        const { name, subscription } = inferShow(segments, options.subscriptions);
        const sourceInfo = await stat(file).catch(() => null);
        if (!sourceInfo)
            continue;
        // 种子里的 sample/预告片不能当成一集搬进剧集库。
        if (sourceInfo.size < minBytes || /(?:^|[\s._-])(?:sample|trailer)(?:[\s._-]|$)/i.test(basename(file))) {
            skipped++;
            items.push({ action: 'skip', source: file, show: name, season: 1, episode: null, note: '样片/小文件，保留在下载目录' });
            continue;
        }
        // 迅雷下载中的文件名旁边会有 .xltd；刚写入的文件也要等一轮，避免搬到半个 mp4。
        const base = basename(file);
        const dirEntries = await readdir(dirname(file)).catch(() => []);
        if (dirEntries.some(name => name.startsWith(`${base}.`) && name.toLowerCase().endsWith('.xltd'))) {
            skipped++;
            items.push({ action: 'skip', source: file, show: name, season: 1, episode: null, note: '同名 .xltd 还在，说明没下完' });
            continue;
        }
        if (Date.now() - sourceInfo.mtimeMs < settleMs) {
            skipped++;
            items.push({ action: 'skip', source: file, show: name, season: 1, episode: null, note: '文件刚写入，等下一轮' });
            continue;
        }
        const fileInfo = parseEpisode(basename(file));
        const folderInfo = parseEpisode(segments[0] ?? '');
        const info = fileInfo.episode || fileInfo.range ? fileInfo : folderInfo;
        const episode = info.episode ?? info.range?.[0] ?? null;
        if (!episode) {
            skipped++;
            items.push({ action: 'skip', source: file, show: name, season: 1, episode: null, note: '识别不出集数' });
            continue;
        }
        const season = info.season ?? subscription?.season ?? 1;
        const dir = join(options.root, safeSegment(name), `Season ${String(season).padStart(2, '0')}`);
        const ext = extname(file).toLowerCase();
        let target = join(dir, `${safeSegment(name)} - ${episodeTag(season, episode)}${ext}`);
        const existing = await stat(target).catch(() => null);
        if (existing) {
            if (existing.size === sourceInfo.size) {
                skipped++;
                items.push({ action: 'skip', source: file, target, show: name, season, episode, note: '目标已存在且体积一致' });
                continue;
            }
            target = target.replace(ext, ` (2)${ext}`);
        }
        if (!options.apply) {
            moved++;
            items.push({ action: 'move', source: file, target, show: name, season, episode });
            continue;
        }
        await mkdir(dir, { recursive: true });
        const subtitles = await siblings(dirname(file), basename(file, extname(file)));
        await rename(file, target);
        for (const subtitle of subtitles) {
            const suffix = extname(subtitle).toLowerCase();
            const subtitleTarget = join(dir, basename(target, ext) + suffix);
            const clash = await stat(subtitleTarget).catch(() => null);
            if (!clash)
                await rename(join(dirname(file), subtitle), subtitleTarget).catch(() => undefined);
        }
        moved++;
        items.push({ action: 'move', source: file, target, show: name, season, episode });
    }
    if (options.apply)
        await sweepEmpty(options.root);
    return { items, moved, skipped };
}
/** 收掉搬空后的临时目录，保留根目录和还在用的目录。 */
async function sweepEmpty(root) {
    const walk = async (dir) => {
        const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
        let empty = true;
        for (const entry of entries) {
            if (entry.name.startsWith('.'))
                continue;
            if (entry.isDirectory()) {
                if (await walk(join(dir, entry.name)))
                    await rm(join(dir, entry.name), { recursive: true, force: true }).catch(() => undefined);
                else
                    empty = false;
            }
            else
                empty = false;
        }
        return empty;
    };
    await walk(root);
}
