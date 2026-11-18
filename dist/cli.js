#!/usr/bin/env node
// input: CLI commands; output: JSON results; pos: nas-movie entry point.
import { parseArgs } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { configPath, readConfig } from "./config.js";
import { bookmarks } from "./core/paths.js";
import { assessment, features, infoHash, rankResources } from "./resources.js";
import { Thunder, summary } from "./thunder.js";
import { authExpiry } from "./thunder-auth.js";
import { isLocal, nasRequest, ssh } from "./ssh.js";
import { importSession } from "./browser.js";
import { runTeachers, runTeachersFeed } from "./teachers/run.js";
import { pinRoster, readRoster, selectedNames } from "./teachers/bookmarks.js";
import { Javdb } from "./javdb/client.js";
import { SUBSCRIPTIONS } from "./teachers/sources.js";
import { runAuto, runBackfill } from "./auto.js";
import { renderGallery } from "./gallery.js";
import { defaultArchiveRoot, defaultTrashDir, javdbCachePath, organizeLedgerPath, runOrganize, seedActresses, } from "./library/organize.js";
import { coverCacheDir, defaultPort, startWeb, submittedPath, webDefaults } from "./web/server.js";
import { catalogPath } from "./catalog/store.js";
import { addShow, readShows, removeShow } from "./shows/config.js";
import { checkShows, loadShowsSummary } from "./shows/run.js";
import { readShowsState } from "./shows/state.js";
import { organizeShows } from "./shows/library.js";
import { pushShowsConfig, runRemoteShows } from "./shows/remote.js";
import { syncCatalog } from "./catalog/sync.js";
import { decimal, flag, integer, list, oneOf, requiredArg, text, yearArg, UsageError } from "./cli/args.js";
const help = `nas-movie — NAS Jackett 搜索 → NAS 迅雷（SSH）

search <英文片名> [--year 2020]             搜索资源
resources <英文片名> --year 2020 [--dv]     按做种、画质、体积综合排序 4K 候选
fetch <英文片名> --year 2020 [--dv]         下载匹配片名、年份的首选资源
--hash <BTIH>                              从搜索候选中指定资源
--chinese --max-size 25                    要求标题中字，体积上限 25 GiB
--source gying --id ym24                   显式使用旧观影来源
add <magnet> [--to 迅雷目录]      添加指定资源，重复 hash 返回现有任务
preview <magnet>                           解析种子和文件列表
status [关键词或hash] [--all]              查询任务、实际速度和进度
paths                                     查询可用下载目录
teachers [--name 名字] [--folder 书签夹]  查询书签夹里每人最新可下载作品
teachers feed [--limit 20] [--per-teacher 1] [--downloadable] [--html 文件]
                                          汇总所有老师最新作品，带封面和名称
teachers feed [--sub APGH,AP] [--per-sub 5] [--no-sub] [--no-teachers]
                                          额外汇总番号系列/厂牌新作（默认订阅 APGH、AP）
teachers pull [--apply] [--to 目录]       计划下载；--apply 才提交到片库目录
teachers auto [--apply] [--days 30] [--limit 100] [--names 文件] [--numbers 番号,番号]
                                          每日把所有人的新作放进一个池，窗口内有几部下几部
teachers backfill [--apply] [--limit 100] [--names 文件]
                                          所有人放进一个池，按发行日期一次性补最新 N 部
teachers names [--save 文件] [--names 旧名册]  导出收藏夹名册并固定每人的 JavDB id（沿用旧名册的 id）
organize [--root 目录] [--apply] [--min-size 300] [--settle 15] [--limit 0] [--no-clean]
                                          把下载完成的片子平铺进片库，命名成「发行日期 番号 演员.ext」
                                          默认只输出计划；--apply 才移动文件，垃圾挪去回收目录
web [--port 8850] [--host 0.0.0.0] [--root 目录]  起局域网影片墙：全站作品 + 封面 + 在线播放 + 一键下载
catalog [--pages 8] [--since 2024-01-01] [--names 文件] [--full]
                                          把收藏夹老师的完整片单抓成作品目录，墙上才能看到「没下的」
shows list                                查看电视剧/番剧订阅
shows add <名字> --query "搜索词" [--season 1] [--episodes 12] [--subtitle zh] [--kind tv|anime]
shows remove <名字>                       删除订阅
shows check [--apply]                     搜索新集；--apply 才提交迅雷
shows organize [--apply]                  把下载完的剧集按「剧名/Season 01」归档
doctor                                    检查宿主 SSH 和迅雷登录态
auth --space 5 --nas-page p1 --site-page p2 导入已登录页面会话

--dry-run 仅输出下载计划，不创建任务。teachers pull 默认也是计划。
默认 Jackett 搜索与下载走 SSH，无需浏览器。旧观影来源可加 --space/--site-page。
配置：${configPath}
`;
const selection = (v) => ({
    dv: flag(v, 'dv'), chinese: flag(v, 'chinese'),
    maxSizeGB: decimal(v, 'max-size', { min: 0.001, label: 'max-size（GiB）' }),
});
const gyingBrowser = (v) => text(v, 'space') && text(v, 'site-page') ? { space: Number(v.space), page: String(v['site-page']) } : undefined;
const commands = {
    async search({ v, a, c }) {
        const legacy = oneOf(v, 'source', ['jackett', 'gying'], 'jackett') === 'gying';
        const query = requiredArg(a, 1, 'search 缺少片名');
        const year = yearArg(v);
        if (legacy) {
            const { Gying } = await import("./gying.js");
            const rows = await new Gying(c, gyingBrowser(v)).search(query);
            return rows.filter(row => !year || row.year === year);
        }
        const { Jackett } = await import("./jackett.js");
        const rows = await new Jackett(c).search(query, year);
        return rows.map(row => ({ ...row, hash: infoHash(row.magnet), features: features(row.title) }));
    },
    async resources({ v, a, c }) {
        const legacy = oneOf(v, 'source', ['jackett', 'gying'], 'jackett') === 'gying';
        const query = requiredArg(a, 1, 'resources 缺少片名');
        const year = yearArg(v);
        const rows = legacy
            ? await new (await import("./gying.js")).Gying(c, gyingBrowser(v)).resources(query)
            : await new (await import("./jackett.js")).Jackett(c).search(query, year);
        return rankResources(rows, selection(v)).map(row => ({
            ...row, hash: infoHash(row.magnet), features: features(row.title), ...assessment(row),
        }));
    },
    async fetch({ v, a, c }) {
        const legacy = oneOf(v, 'source', ['jackett', 'gying'], 'jackett') === 'gying';
        const query = requiredArg(a, 1, 'fetch 缺少片名');
        const year = yearArg(v);
        if (!legacy) {
            if (!year)
                throw new UsageError('fetch 需要 --year，避免同名影片误下');
            const { Jackett } = await import("./jackett.js");
            const resources = rankResources(await new Jackett(c).search(query, year), selection(v));
            const hash = text(v, 'hash')?.toLowerCase();
            const resource = hash ? resources.find(row => infoHash(row.magnet) === hash) : resources[0];
            if (!resource)
                throw new Error('没有符合片名、年份及画质要求的资源');
            return {
                source: 'jackett', selected: { ...resource, ...assessment(resource) },
                ...await new Thunder(c).download(resource.magnet, text(v, 'to'), flag(v, 'dry-run')),
            };
        }
        const { Gying, chooseMovie } = await import("./gying.js");
        const gying = new Gying(c, gyingBrowser(v));
        const movie = text(v, 'id') ? { id: String(v.id) } : chooseMovie(await gying.search(query), query, year);
        const resource = rankResources(await gying.resources(movie.id), selection(v))[0];
        if (!resource)
            throw new Error('没有符合条件的 4K 资源');
        return {
            movie, selected: resource,
            ...await new Thunder(c).download(resource.magnet, text(v, 'to'), flag(v, 'dry-run')),
        };
    },
    add: ({ v, a, c }) => new Thunder(c).download(requiredArg(a, 1, 'add 缺少 magnet'), text(v, 'to'), flag(v, 'dry-run')),
    preview: ({ a, c }) => new Thunder(c).preview(requiredArg(a, 1, 'preview 缺少 magnet')),
    async status({ v, a, c }) {
        const term = (a[1] || '').toLowerCase();
        const tasks = await new Thunder(c).tasks();
        return tasks
            .filter(task => (flag(v, 'all') || term || task.phase !== 'PHASE_TYPE_COMPLETE')
            && (!term || task.name.toLowerCase().includes(term) || task.params?.info_hash?.toLowerCase() === term))
            .map(summary);
    },
    async paths({ c }) {
        const folders = await nasRequest(c, 'device/download_paths');
        return folders.map(folder => ({ path: folder.RealPath, id: folder.Id }));
    },
    async teachers({ v, a, c }) {
        const sub = a[1];
        if (sub && !['pull', 'feed', 'auto', 'backfill', 'names'].includes(sub) || a[2]) {
            throw new UsageError('teachers 子命令：pull / feed / auto / backfill / names');
        }
        const folder = text(v, 'folder') || bookmarks.folder;
        const names = text(v, 'names') ? await readRoster(String(v.names)) : undefined;
        if (sub === 'names') {
            const roster = await selectedNames(folder);
            if (text(v, 'save')) {
                // --names 指向旧名册时沿用其中的固定 id（部署时传 NAS 上那份），只给新名字找人。
                const save = String(v.save);
                const { actors, unresolved } = await pinRoster(roster, new Javdb());
                await writeFile(save, JSON.stringify({ folder, savedAt: new Date().toISOString(), names: roster, actors }, null, 2) + '\n', { mode: 0o600 });
                return { saved: save, count: roster.length, pinned: Object.keys(actors).length, unresolved };
            }
            return roster;
        }
        if (sub === 'auto') {
            const numbers = list(v, 'numbers');
            const tokens = numbers.length || flag(v, 'no-sub') ? []
                : (text(v, 'sub') === undefined ? Object.keys(SUBSCRIPTIONS) : list(v, 'sub'));
            const roster = numbers.length || flag(v, 'no-teachers') ? [] : (names ?? await selectedNames(folder));
            return runAuto({
                config: c, names: roster, tokens, numbers, to: text(v, 'to') || defaultArchiveRoot,
                days: integer(v, 'days', { fallback: 30, min: 1, max: 3650 }),
                pages: integer(v, 'pages', { fallback: 4, min: 1, max: 20 }),
                perSource: integer(v, 'per-sub', { fallback: 5, min: 1, max: 20 }),
                limit: integer(v, 'limit', { fallback: 100, min: 1, max: 100 }),
                apply: flag(v, 'apply') && !flag(v, 'dry-run'), statePath: text(v, 'state'),
            });
        }
        if (sub === 'backfill') {
            return runBackfill({
                config: c, names: names ?? await selectedNames(folder), to: text(v, 'to') || defaultArchiveRoot,
                limit: integer(v, 'limit', { fallback: 100, min: 1, max: 200 }),
                apply: flag(v, 'apply') && !flag(v, 'dry-run'), statePath: text(v, 'state'),
            });
        }
        if (sub === 'feed') {
            if (flag(v, 'apply') || text(v, 'to'))
                throw new UsageError('teachers feed 只查询，不带 --apply/--to');
            const name = text(v, 'name');
            const tokens = flag(v, 'no-sub') || (name && text(v, 'sub') === undefined) ? []
                : (text(v, 'sub') === undefined ? Object.keys(SUBSCRIPTIONS) : list(v, 'sub'));
            const items = await runTeachersFeed({
                folder, name,
                perTeacher: integer(v, 'per-teacher', { fallback: 1, min: 1, max: 10 }),
                limit: integer(v, 'limit', { fallback: 20, min: 1, max: 200 }),
                downloadable: flag(v, 'downloadable'),
                subscriptions: tokens,
                perSource: integer(v, 'per-sub', { fallback: 5, min: 1, max: 20 }),
                noTeachers: flag(v, 'no-teachers'),
                names,
            });
            if (text(v, 'html')) {
                await writeFile(String(v.html), renderGallery(items, {
                    generatedAt: new Date().toISOString(),
                    label: [name, tokens.length ? `订阅 ${tokens.join('/')}` : null, flag(v, 'downloadable') ? '仅可下载' : null]
                        .filter(Boolean).join(' ') || undefined,
                }));
            }
            return items;
        }
        if (sub === 'pull') {
            const to = text(v, 'to') || defaultArchiveRoot;
            const { assertDownloadPath } = await import("./thunder.js");
            assertDownloadPath(to);
        }
        return runTeachers({
            action: sub === 'pull' ? 'pull' : 'list', apply: flag(v, 'apply') && !flag(v, 'dry-run'),
            name: text(v, 'name'), folder, to: text(v, 'to') || defaultArchiveRoot,
            pages: integer(v, 'pages', { fallback: 4, min: 1, max: 20 }), config: c, names,
        });
    },
    async organize({ v, c }) {
        return runOrganize({
            config: c, root: text(v, 'root') || defaultArchiveRoot,
            apply: flag(v, 'apply') && !flag(v, 'dry-run'),
            minSizeMb: decimal(v, 'min-size', { fallback: 300, min: 1, label: 'min-size（MiB）' }),
            settleMinutes: integer(v, 'settle', { fallback: 15, min: 0, max: 1440 }),
            limit: integer(v, 'limit', { fallback: 0, min: 0, max: 1000 }),
            clean: !flag(v, 'no-clean'),
            ledgerPath: text(v, 'ledger') || organizeLedgerPath, cachePath: text(v, 'cache') || javdbCachePath,
            trashDir: text(v, 'trash') || defaultTrashDir, extraActresses: await seedActresses(),
        });
    },
    async web({ v, c }) {
        const port = integer(v, 'port', { fallback: defaultPort, min: 1, max: 65535 });
        const handle = await startWeb({
            config: c, root: text(v, 'root') || defaultArchiveRoot, port, host: text(v, 'host') || webDefaults.host,
            cachePath: text(v, 'cache') || javdbCachePath, coverDir: coverCacheDir,
            catalogPath: text(v, 'catalog-file') || catalogPath, submittedPath, scanTtlMs: webDefaults.scanTtlMs,
        });
        process.stderr.write(`片库墙已启动：${handle.url}（Ctrl-C 退出）\n`);
        return { listening: handle.url, root: text(v, 'root') || defaultArchiveRoot, port: handle.port };
    },
    async catalog({ v }) {
        if (text(v, 'since') && !/^\d{4}-\d{2}-\d{2}$/.test(String(v.since)))
            throw new UsageError('since 需要 YYYY-MM-DD');
        const names = text(v, 'names') ? await readRoster(String(v.names)) : await selectedNames(text(v, 'folder') || bookmarks.folder);
        return syncCatalog({
            names, pages: integer(v, 'pages', { fallback: 12, min: 1, max: 30 }), since: text(v, 'since') ?? null,
            full: flag(v, 'full'), path: text(v, 'catalog-file') || catalogPath,
        });
    },
    async shows({ v, a, c }) {
        const sub = a[1] ?? 'list';
        if (!['list', 'add', 'remove', 'check', 'organize'].includes(sub)) {
            throw new UsageError('shows 子命令：list / add / remove / check / organize');
        }
        if (sub === 'add') {
            const name = requiredArg(a, 2, 'shows add 缺少剧名');
            const created = await addShow({
                name, query: text(v, 'query'),
                aliases: list(v, 'alias'),
                kind: oneOf(v, 'kind', ['tv', 'anime'], 'tv'),
                season: text(v, 'season') ? integer(v, 'season', { fallback: 1, min: 1, max: 99 }) : null,
                totalEpisodes: text(v, 'episodes') ? integer(v, 'episodes', { fallback: 12, min: 1, max: 1000 }) : null,
                subtitle: oneOf(v, 'subtitle', ['zh', 'any'], 'any'),
                year: yearArg(v) ?? null,
            });
            return syncConfig(c, created);
        }
        if (sub === 'remove') {
            const name = requiredArg(a, 2, 'shows remove 缺少剧名');
            return syncConfig(c, { removed: await removeShow(name), name });
        }
        // 远程模式下所有会读 NAS 状态的子命令都交给 NAS 本机的 dist 跑，账本/文件才在正确的主机上。
        if (!isLocal(c)) {
            if (sub === 'list')
                return runRemoteShows(c, 'list');
            await pushShowsConfig(c, await readShows());
            if (sub === 'check') {
                return runRemoteShows(c, 'check', [
                    ...(flag(v, 'apply') && !flag(v, 'dry-run') ? ['--apply'] : []),
                    '--limit', String(integer(v, 'limit', { fallback: 20, min: 1, max: 200 })),
                ]);
            }
            return runRemoteShows(c, 'organize', [
                ...(flag(v, 'apply') && !flag(v, 'dry-run') ? ['--apply'] : []),
                '--settle', String(integer(v, 'settle', { fallback: 15, min: 0, max: 1440 })),
            ]);
        }
        if (sub === 'list') {
            const config = await readShows();
            const summary = await loadShowsSummary();
            return {
                local: true, root: config.root, lastCheck: summary.lastCheck, subscriptions: config.subscriptions,
                totals: { shows: summary.shows.length, episodes: summary.episodes, totalBytes: summary.totalBytes },
                shows: summary.shows,
            };
        }
        if (sub === 'check') {
            const config = await readShows();
            return checkShows({
                config: c, shows: config, apply: flag(v, 'apply') && !flag(v, 'dry-run'),
                limit: integer(v, 'limit', { fallback: 20, min: 1, max: 200 }), statePath: text(v, 'state'),
            });
        }
        const config = await readShows();
        return organizeShows({
            root: config.root, subscriptions: config.subscriptions,
            apply: flag(v, 'apply') && !flag(v, 'dry-run'),
            settleMinutes: integer(v, 'settle', { fallback: 15, min: 0, max: 1440 }),
        });
    },
    async doctor({ c }) {
        const host = await ssh(c, 'hostname; id -un');
        const tasks = await new Thunder(c).tasks();
        const expiry = authExpiry(c.thunder.headers['pan-auth'] || '');
        const shows = await readShows();
        const showsState = await readShowsState();
        return {
            ssh: host.trim().split('\n'), thunder: 'ok', tasks: tasks.length,
            jackett: (await ssh(c, 'systemctl --user is-active jackett')).trim(),
            authExpiresAt: expiry ? new Date(expiry).toISOString() : null, downloadDir: c.thunder.downloadDir,
            shows: { root: shows.root, subscriptions: shows.subscriptions.length, lastCheck: showsState.lastCheck },
        };
    },
    async auth({ v, c }) {
        const space = integer(v, 'space', { fallback: 0, min: 1, max: 999 });
        if (!space || (!text(v, 'nas-page') && !text(v, 'site-page'))) {
            throw new UsageError('auth 需要 --space 和至少一个页面参数');
        }
        return importSession(c, space, text(v, 'nas-page'), text(v, 'site-page'));
    },
};
/** add/remove 后：本机文件已写入；远程配置顺手推给 NAS，推失败也不丢本地修改。 */
async function syncConfig(config, result) {
    if (isLocal(config))
        return result;
    try {
        await pushShowsConfig(config, await readShows());
        return { ...result, pushed: true };
    }
    catch (error) {
        return { ...result, pushed: false, note: `本地已保存，但同步 NAS 失败：${error instanceof Error ? error.message : '未知错误'}` };
    }
}
async function main() {
    const { values: v, positionals: a } = parseArgs({
        allowPositionals: true,
        options: {
            help: { type: 'boolean', short: 'h' }, year: { type: 'string' }, id: { type: 'string' },
            dv: { type: 'boolean' }, chinese: { type: 'boolean' }, all: { type: 'boolean' },
            to: { type: 'string' }, 'dry-run': { type: 'boolean' }, space: { type: 'string' },
            'nas-page': { type: 'string' }, 'site-page': { type: 'string' },
            source: { type: 'string' }, hash: { type: 'string' }, 'max-size': { type: 'string' },
            apply: { type: 'boolean' }, name: { type: 'string' }, folder: { type: 'string' }, pages: { type: 'string' },
            limit: { type: 'string' }, 'per-teacher': { type: 'string' }, html: { type: 'string' }, downloadable: { type: 'boolean' },
            sub: { type: 'string' }, 'per-sub': { type: 'string' }, 'no-sub': { type: 'boolean' },
            'no-teachers': { type: 'boolean' }, names: { type: 'string' }, state: { type: 'string' }, numbers: { type: 'string' },
            days: { type: 'string' }, save: { type: 'string' }, full: { type: 'boolean' },
            root: { type: 'string' }, 'min-size': { type: 'string' }, settle: { type: 'string' }, 'no-clean': { type: 'boolean' },
            ledger: { type: 'string' }, cache: { type: 'string' }, trash: { type: 'string' },
            port: { type: 'string' }, host: { type: 'string' }, since: { type: 'string' }, 'catalog-file': { type: 'string' },
            query: { type: 'string' }, season: { type: 'string' }, kind: { type: 'string' }, episode: { type: 'string' },
            'min-age': { type: 'string' }, alias: { type: 'string' }, episodes: { type: 'string' }, subtitle: { type: 'string' },
        },
    });
    if (v.help || !a[0]) {
        console.log(help);
        return;
    }
    const command = commands[a[0]];
    if (!command)
        throw new Error(`未知命令：${a[0]}`);
    const result = await command({ v, a, c: await readConfig() });
    console.log(JSON.stringify(result, null, 2));
    // 定时任务靠退出码暴露「部分失败」：结果里点名的失败项不为空就非零退出。
    const failures = result?.failures;
    if (Array.isArray(failures) && failures.length)
        process.exitCode = 1;
}
main().catch(error => {
    console.error(JSON.stringify({ error: error instanceof Error ? error.message : '命令失败' }));
    process.exitCode = 1;
});
