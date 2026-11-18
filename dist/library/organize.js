// input: 片库目录的视频文件、迅雷任务状态和 JavDB 元数据；output: 平铺且按日期命名的片库；pos: 片库整理。
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, sep } from 'node:path';
import { readJsonFile, writeJsonAtomic } from "../core/json.js";
import { paths } from "../core/paths.js";
import { Javdb } from "../javdb/client.js";
import { downloader } from "../downloader.js";
import { MetaStore } from "./meta.js";
import { mapLimit } from "../core/async.js";
import { readCatalog } from "../catalog/store.js";
import { defaultArchiveRoot, flatName, flatPattern, learnPrefixes, legacyRename, numberCandidates, parseLibraryName, pickActress, rankCandidates, splitActresses, unknownActress, videoExtensions, PREFIX_SEED, } from "./naming.js";
export { defaultArchiveRoot, videoExtensions, unknownActress };
export const defaultTrashDir = paths.trash;
export const organizeLedgerPath = paths.organized;
export const javdbCachePath = paths.javdb;
export const performerRosterPath = paths.roster;
export const autoLedgerPath = paths.auto;
// 已知女优名单：收藏夹名册 + 自动账本里以老师为来源的记录。两个文件都读不到时返回空集，不影响整理主流程。
export async function seedActresses(rosterPath = paths.roster, statePath = paths.auto) {
    const names = new Set();
    const roster = await readJsonFile(rosterPath, {});
    if (Array.isArray(roster?.names))
        for (const name of roster.names)
            if (typeof name === 'string' && name.trim())
                names.add(name.trim());
    const state = await readJsonFile(statePath, {});
    for (const entry of Object.values(state?.seen ?? {})) {
        const source = (entry?.source ?? '').trim();
        if (source && !source.includes('手动') && !source.includes('系列') && !source.includes('·'))
            names.add(source);
    }
    return [...names].sort();
}
// 已入库的文件每轮都按元数据重算一次名字（多人共演补全、未知演员、缺日期），有变化才改名。
// 元数据查过就进缓存，之后每轮只读缓存，不再请求；名字是否已更新只看文件名本身，不看缓存。
export function needsRelabel(name) {
    return parseLibraryName(name) !== null;
}
export async function normalizeRootNames(root, apply) {
    const changes = [];
    for (const entry of await readdir(root, { withFileTypes: true })) {
        if (!entry.isFile() || !videoExtensions.has(extname(entry.name).toLowerCase()))
            continue;
        const to = legacyRename(entry.name);
        if (!to)
            continue;
        const twin = await stat(join(root, to)).catch(() => null);
        if (twin)
            continue; // 目标已存在就不动，留给人工处理
        if (apply)
            await rename(join(root, entry.name), join(root, to));
        changes.push({ from: entry.name, to });
    }
    return changes;
}
export async function collectVideos(root) {
    const out = [];
    const walk = async (dir) => {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
            if (entry.name.startsWith('.'))
                continue;
            const full = join(dir, entry.name);
            if (entry.isDirectory())
                await walk(full);
            else if (entry.isFile() && videoExtensions.has(extname(entry.name).toLowerCase()))
                out.push(full);
        }
    };
    await walk(root);
    return out;
}
// 清完文件后把空目录收掉；被未完成任务引用的目录不能删，迅雷还指着那个目录 id。
export async function sweepEmptyDirs(root, activePaths, depth = 3) {
    const removed = [];
    const walk = async (dir, level) => {
        const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
        let empty = true;
        for (const entry of entries) {
            if (entry.name.startsWith('.'))
                continue;
            if (entry.isDirectory()) {
                const child = join(dir, entry.name);
                const childEmpty = level < depth ? await walk(child, level + 1) : false;
                if (!childEmpty)
                    empty = false;
            }
            else
                empty = false;
        }
        if (empty && dir !== root && !activePaths.has(dir)) {
            await rm(dir, { recursive: true, force: true });
            removed.push(dir);
            return true;
        }
        return empty;
    };
    await walk(root, 0);
    return removed;
}
// 只装垃圾的目录主循环看不见（里面压根没有视频文件）：剩 0 字节 .xltd 的失败残渣、没下完但任务已消失的目录。
// 保护规则：非空 .xltd 一律不动（那可能是一个还在的几十 GB 半成品），任务仍在下载的目录不动。
export function junkEligible(name, size, dir, active, completed) {
    if (active.has(dir))
        return false;
    const lower = name.toLowerCase();
    if (lower.endsWith('.xltd'))
        return size === 0 || completed.has(dir);
    return true;
}
export async function sweepOrphans(root, activePaths, completedPaths, trashDir, apply, handled) {
    const items = [];
    const day = new Date().toISOString().slice(0, 10);
    let trashed = 0, removed = 0;
    const walk = async (dir, level) => {
        // 主循环已经处理过的目录不重复处理；下载中的目录本身不能删，但里面的孤儿子目录还是要扫。
        if (dir !== root && handled.has(dir))
            return true;
        const protectedDir = activePaths.has(dir);
        let entries = [];
        try {
            entries = await readdir(dir, { withFileTypes: true });
        }
        catch {
            return true;
        }
        let keep = false;
        for (const entry of entries) {
            if (entry.name.startsWith('.'))
                continue;
            if (entry.isDirectory()) {
                if (await walk(join(dir, entry.name), level + 1))
                    keep = true;
            }
            else if (videoExtensions.has(extname(entry.name).toLowerCase()))
                keep = true;
        }
        if (keep || dir === root || level > 4 || protectedDir)
            return true;
        const files = [];
        for (const entry of entries) {
            if (entry.name.startsWith('.') || entry.isDirectory())
                continue;
            files.push({ name: entry.name, size: (await stat(join(dir, entry.name))).size });
        }
        const blocked = files.filter(file => !junkEligible(file.name, file.size, dir, activePaths, completedPaths));
        if (blocked.length) {
            items.push({
                action: 'skip', source: dir, sizeBytes: blocked.reduce((sum, file) => sum + file.size, 0),
                note: `没有视频，但有 ${blocked.length} 个不能动的文件（${blocked.slice(0, 2).map(f => f.name).join('、')}），保留`,
            });
            return true;
        }
        for (const file of files) {
            const full = join(dir, file.name);
            const to = join(trashDir, day, relative(root, full));
            if (apply) {
                await mkdir(dirname(to), { recursive: true });
                await rename(full, to);
            }
            trashed++;
            items.push({ action: 'trash', source: full, sizeBytes: file.size, target: to, note: '孤儿目录残渣' });
        }
        if (apply)
            await rm(dir, { recursive: true, force: true });
        else
            items.push({ action: 'trash', source: dir, sizeBytes: 0, note: '目录清空后删除' });
        removed++;
        return false;
    };
    await walk(root, 0);
    return { items, trashed, removed };
}
export async function runOrganize(options) {
    const ledger = await readJsonFile(options.ledgerPath, { version: 1, actresses: [], prefixes: [], moved: {} });
    ledger.actresses = Array.isArray(ledger.actresses) ? ledger.actresses : [];
    ledger.prefixes = Array.isArray(ledger.prefixes) ? ledger.prefixes : [];
    ledger.moved = ledger.moved && typeof ledger.moved === 'object' ? ledger.moved : {};
    const known = new Set([...PREFIX_SEED, ...ledger.prefixes]);
    const actresses = new Set([...ledger.actresses, ...(options.extraActresses ?? [])]);
    let tasks = [];
    let taskWarning = null;
    try {
        tasks = await downloader(options.config).tasks();
    }
    catch (error) {
        taskWarning = error instanceof Error ? error.message : '下载任务查询失败';
    }
    const activePaths = new Set();
    const completedPaths = new Set();
    for (const task of tasks) {
        for (const value of [task.path, task.dir]) {
            if (!value)
                continue;
            const trimmed = value.replace(/\/+$/, '');
            if (task.done)
                completedPaths.add(trimmed);
            else
                activePaths.add(trimmed);
        }
    }
    // 先把老编号写法改回括号，再扫库，避免重名判断拿到旧名。
    const renames = await normalizeRootNames(options.root, options.apply);
    const videos = await collectVideos(options.root);
    learnPrefixes(videos.map(file => basename(file)), known);
    const meta = await MetaStore.open(options.cachePath, new Javdb());
    // 作品目录里记着几千部的 JavDB id，直接用，省掉按番号翻片单。
    const catalogIds = new Map(Object.values((await readCatalog().catch(() => null))?.entries ?? {})
        .filter(entry => entry.movieId).map(entry => [entry.number.toUpperCase(), entry.movieId]));
    const dirs = new Map();
    for (const file of videos) {
        if (dirname(file) === options.root && flatPattern.test(basename(file)) && !needsRelabel(basename(file)))
            continue;
        const list = dirs.get(dirname(file)) ?? [];
        list.push(file);
        dirs.set(dirname(file), list);
    }
    const minBytes = options.minSizeMb * 1024 * 1024;
    const settleMs = options.settleMinutes * 60000;
    const now = Date.now();
    const items = [];
    const emptyDirs = [];
    let moved = 0, trashed = 0;
    for (const change of renames) {
        items.push({
            action: 'rename', source: join(options.root, change.from), sizeBytes: 0,
            target: join(options.root, change.to), note: '编号写法规范化',
        });
    }
    // 片库里要重认的旧文件先并发预取元数据（网页客户端自己节流），后面的逐个处理只读缓存。
    const relabel = [...new Set((dirs.get(options.root) ?? []).map(file => parseLibraryName(basename(file))?.number).filter(Boolean))];
    await mapLimit(relabel, 3, number => meta.resolve(number, catalogIds.get(number)));
    for (const [dir, files] of dirs) {
        if (options.limit && moved >= options.limit)
            break;
        const entries = await readdir(dir);
        const sized = [];
        for (const file of files) {
            const info = await stat(file);
            sized.push({ file, size: info.size, mtime: info.mtimeMs });
        }
        const settled = sized.filter(item => now - item.mtime > settleMs);
        if (!settled.length) {
            items.push({ action: 'skip', source: dir, sizeBytes: 0, note: '文件刚写入，等下一轮' });
            continue;
        }
        // 主视频 = 体积达标的文件。一个都没有，说明这个目录只剩广告碎片，整目录不动，留人工确认。
        const keep = settled.filter(item => item.size >= minBytes).sort((a, b) => b.size - a.size);
        if (!keep.length) {
            items.push({ action: 'skip', source: dir, sizeBytes: Math.max(...settled.map(i => i.size)), note: '没有达标的主视频，整目录保留' });
            continue;
        }
        // 先把这个目录里每个主视频都解析出来，再决定是否需要加序号：只有同一个番号的多片才编号。
        const plans = [];
        let dirMoved = 0, dirError = false;
        for (const item of keep) {
            if (options.limit && moved + plans.length >= options.limit)
                break;
            if (entries.includes(`${basename(item.file)}.xltd`)) {
                items.push({ action: 'skip', source: item.file, sizeBytes: item.size, note: '同名 .xltd 还在，说明没下完' });
                continue;
            }
            const candidates = rankCandidates(numberCandidates(basename(item.file)).concat(numberCandidates(dir)), known);
            let number = null, resolved = null, errored = false;
            for (const candidate of candidates.slice(0, 5)) {
                const probe = await meta.resolve(candidate.number, catalogIds.get(candidate.number));
                if (probe.error) {
                    items.push({ action: 'error', source: item.file, sizeBytes: item.size, note: probe.error });
                    // 下载目录要整目录一起搬（编号、清垃圾）；片库根目录里的文件互不相干，一个查失败只跳过它，下轮再试。
                    if (dir !== options.root)
                        dirError = true;
                    errored = true;
                    break;
                }
                if (!probe.miss) {
                    number = probe.number;
                    resolved = probe;
                    break;
                }
                // JavDB 没有收录（EDEA 这类无码厂牌）时，只认已经确认为厂牌的前缀，避免乱猜。
                if (known.has(candidate.prefix)) {
                    number = candidate.number;
                    resolved = probe;
                    break;
                }
            }
            if (dirError)
                break;
            if (errored)
                continue;
            if (!number || !resolved) {
                items.push({
                    action: 'skip', source: item.file, sizeBytes: item.size,
                    note: `识别不出番号（候选 ${candidates.slice(0, 4).map(c => c.number).join('/') || '无'}）`,
                });
                continue;
            }
            // 主演：已入库的旧文件用原来的名字；新下载的看路径里有没有已知演员目录名。其余由 JavDB 女演员表补全。
            const previous = dirname(item.file) === options.root ? parseLibraryName(basename(item.file)) : null;
            const segments = relative(options.root, dirname(item.file)).split(sep).filter(Boolean);
            const primary = previous ? (previous.actress === unknownActress ? null : splitActresses(previous.actress)[0] ?? null)
                : segments.find(segment => actresses.has(segment))
                    ?? segments.filter(segment => /[\u3400-\u9fff]/.test(segment))
                        .flatMap(segment => [...actresses].filter(name => name.length >= 2 && segment.includes(name)))
                        .sort((a, b) => b.length - a.length)[0]
                    ?? null;
            const pick = pickActress(resolved.title, resolved.actresses, actresses, primary);
            if (pick.learn)
                actresses.add(pick.name);
            // 旧文件重认后名字和日期都没变，就原样留着，不进计划。
            if (previous && pick.name === previous.actress && (previous.date || !resolved.date))
                continue;
            plans.push({ file: item.file, size: item.size, number, meta: resolved, actress: pick.name, how: pick.how });
        }
        const movedAway = new Set();
        const repeated = new Map();
        for (const plan of plans)
            repeated.set(plan.number, (repeated.get(plan.number) ?? 0) + 1);
        const seenNumber = new Map();
        for (const plan of plans) {
            const index = (seenNumber.set(plan.number, (seenNumber.get(plan.number) ?? 0) + 1), seenNumber.get(plan.number));
            // 括号编号：`番号 演员 (2).ext`。写成 `演员 2` 会被片库解析器当成演员名的一部分。
            const numbered = (repeated.get(plan.number) ?? 0) > 1 ? `${plan.actress} (${index})` : plan.actress;
            const ext = extname(plan.file);
            const target = join(options.root, flatName(plan.meta.date, plan.number, numbered, ext));
            if (!options.apply) {
                movedAway.add(basename(plan.file));
                items.push({
                    action: 'move', source: plan.file, sizeBytes: plan.size, number: plan.number, date: plan.meta.date ?? null,
                    actress: plan.actress, how: plan.how, target,
                });
                moved++;
                dirMoved++;
                continue;
            }
            let finalTarget = target;
            if (basename(target) !== basename(plan.file)) {
                const twin = await stat(target).catch(() => null);
                if (twin) {
                    if (twin.size === plan.size) {
                        await rm(plan.file);
                        movedAway.add(basename(plan.file));
                        items.push({ action: 'skip', source: plan.file, sizeBytes: plan.size, number: plan.number, target, note: '目标已存在且体积一致，删掉重复文件' });
                        moved++;
                        dirMoved++;
                        continue;
                    }
                    finalTarget = target.replace(ext, ` (2)${ext}`);
                }
            }
            if (plan.file !== finalTarget)
                await rename(plan.file, finalTarget);
            if (dirname(plan.file) === options.root)
                delete ledger.moved[basename(plan.file)];
            movedAway.add(basename(plan.file));
            moved++;
            dirMoved++;
            ledger.moved[basename(finalTarget)] = {
                number: plan.number, file: basename(finalTarget), from: plan.file, sizeBytes: plan.size,
                actress: plan.actress, how: plan.how, date: plan.meta.date ?? null, at: new Date().toISOString(),
            };
            items.push({
                action: 'move', source: plan.file, sizeBytes: plan.size, number: plan.number, date: plan.meta.date ?? null,
                actress: plan.actress, how: plan.how, target: finalTarget,
            });
        }
        if (dirError)
            continue;
        // 根目录就是片库本身，里面除了这轮的文件全是已入库的片子，绝不能按「垃圾」清。
        if (!dirMoved || !options.clean || dir === options.root)
            continue;
        // 清垃圾：种子文件、广告小片、已完结任务的 .xltd 残渣，一律挪去回收目录而不是直接删。
        // 只清「本来就不是主视频」的东西：凡是进来时被当成候选的文件一律不碰，避免漏搬就误删。
        const day = new Date().toISOString().slice(0, 10);
        const protectedNames = new Set([...keep.map(item => basename(item.file)), ...plans.map(plan => basename(plan.file))]);
        const doomed = [];
        for (const entry of await readdir(dir, { withFileTypes: true })) {
            if (entry.name.startsWith('.') || entry.isDirectory())
                continue;
            if (protectedNames.has(entry.name))
                continue;
            const info = await stat(join(dir, entry.name));
            if (!junkEligible(entry.name, info.size, dir, activePaths, completedPaths))
                continue;
            doomed.push(entry.name);
        }
        for (const name of doomed) {
            const full = join(dir, name);
            const to = join(options.trashDir, day, relative(options.root, full));
            if (options.apply) {
                await mkdir(dirname(to), { recursive: true });
                await rename(full, to);
            }
            trashed++;
            items.push({ action: 'trash', source: full, sizeBytes: 0, target: to, note: '挪去回收目录' });
        }
        if (dir !== options.root && !activePaths.has(dir)) {
            const rest = (await readdir(dir)).filter(name => !name.startsWith('.') && !doomed.includes(name) && !movedAway.has(name));
            if (!rest.length) {
                if (options.apply)
                    await rm(dir, { recursive: true, force: true });
                else {
                    emptyDirs.push(dir);
                    items.push({ action: 'trash', source: dir, sizeBytes: 0, note: '目录清空后删除' });
                }
            }
        }
    }
    let removedDirs = emptyDirs.length;
    if (options.clean) {
        const orphans = await sweepOrphans(options.root, activePaths, completedPaths, options.trashDir, options.apply, new Set(dirs.keys()));
        items.push(...orphans.items);
        trashed += orphans.trashed;
        removedDirs += orphans.removed;
    }
    await meta.flush(); // 元数据缓存不涉及文件移动，dry-run 也存，省得每次重查 JavDB。
    if (options.apply) {
        removedDirs += (await sweepEmptyDirs(options.root, activePaths)).length;
        ledger.prefixes = [...known].filter(prefix => !PREFIX_SEED.includes(prefix)).sort();
        ledger.actresses = [...actresses].sort();
        await writeJsonAtomic(options.ledgerPath, ledger);
    }
    const counts = {
        dirs: dirs.size, move: items.filter(i => i.action === 'move').length,
        skip: items.filter(i => i.action === 'skip').length, error: items.filter(i => i.action === 'error').length,
        trash: trashed, removedDirs,
    };
    // 没认出演员的要人眼过一遍。
    const review = items.filter(item => item.action === 'move' && (!item.actress || item.actress === unknownActress))
        .map(item => ({ number: item.number, actress: item.actress, how: item.how, source: item.source }));
    return {
        apply: options.apply, root: options.root, taskWarning, counts, review, items,
        knownPrefixes: [...known].length, actresses: [...actresses].sort(),
    };
}
