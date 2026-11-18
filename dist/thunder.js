// input: magnets and NAS config; output: torrent preview and task status; pos: Thunder API adapter.
import { thunderConfig } from "./config.js";
import { nasRequest } from "./ssh.js";
import { infoHash } from "./resources.js";
import { assertDownloadPath, settings } from "./core/paths.js";
import { ensureThunderAuth } from "./thunder-auth.js";
import { mkdir, readFile, writeFile, unlink, rmdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { configPath } from "./config.js";
export function selectedFiles(root) {
    if (!root.is_dir)
        return [{ index: '-1', name: root.name, size: root.file_size }];
    const flatten = (dir, parent = '') => {
        if (!dir.dir?.resources || dir.dir.next_page_token)
            throw new Error('种子目录尚未完整展开，请稍后重试 preview');
        const leaves = dir.dir.resources.flatMap(file => file.is_dir ? flatten(file, parent + file.name + '/')
            : [{ file, path: parent + file.name }]);
        if (leaves.length !== dir.file_count)
            throw new Error('种子文件数量不完整，无法确定文件索引');
        return leaves;
    };
    const selected = flatten(root).filter(({ file: f, path }) => !/(^|[\/ ._-])sample([\/ ._-]|$)/i.test(path)
        && /\.(mkv|mp4|m2ts|ts|avi|mov|srt|ass|ssa|sup|sub|idx)$/i.test(f.name)
        && (!/\.(mkv|mp4|m2ts|ts|avi|mov)$/i.test(f.name) || f.file_size > 10 * 1024 * 1024));
    if (!selected.some(({ file: f }) => /\.(mkv|mp4|m2ts|ts|avi|mov)$/i.test(f.name) && f.file_size > 10 * 1024 * 1024))
        throw new Error('没有找到正片文件');
    const indexes = new Set();
    return selected.map(({ file: f, path }) => {
        const index = Number.isSafeInteger(f.file_index) && f.file_index >= 0 ? String(f.file_index) : f.id.slice(root.id.length + 1);
        if (!/^\d+$/.test(index))
            throw new Error('迅雷文件索引结构变化');
        if (indexes.has(index))
            throw new Error('迅雷文件索引重复');
        indexes.add(index);
        return { index, name: path, size: f.file_size };
    });
}
export function taskBody(root, magnet, config, folderId, path) {
    const files = selectedFiles(root);
    return { type: 'user#download-url', name: root.name, file_name: root.name,
        file_size: String(files.reduce((n, f) => n + f.size, 0)), space: thunderConfig(config).space,
        params: { target: thunderConfig(config).space, url: magnet, total_file_count: String(root.file_count),
            // Thunder's UI encodes a single-file torrent with this range sentinel.
            parent_folder_id: folderId, parent_folder_path: path, sub_file_index: root.is_dir ? files.map(f => f.index).join(',') : '--1,',
            mime_type: '', file_id: '' } };
}
// 多文件种子（正片 + 广告/说明）有时迅雷只列出前几个文件，选文件会漏掉正片。
// 这种时候整包提交：少下的风险为零，广告文件由 organize 清到回收目录。
export function wholeTorrentBody(root, magnet, config, folderId, path) {
    return { type: 'user#download-url', name: root.name, file_name: root.name,
        file_size: String(root.file_size), space: thunderConfig(config).space,
        params: { target: thunderConfig(config).space, url: magnet, total_file_count: String(root.file_count),
            parent_folder_id: folderId, parent_folder_path: path, sub_file_index: '--1,', mime_type: '', file_id: '' } };
}
export function summary(task) {
    const size = Number(task.file_size), downloaded = Number(task.params?.checked_size || 0);
    return { id: task.id, name: task.name, phase: task.phase, done: task.phase === 'PHASE_TYPE_COMPLETE', hash: task.params?.info_hash,
        sizeBytes: size, downloadedBytes: downloaded,
        percent: size > 0 ? Number((downloaded / size * 100).toFixed(2)) : task.progress || 0,
        bytesPerSecond: Number(task.params?.speed || 0), path: task.params?.real_path, dir: task.params?.parent_folder_path };
}
export function planFolder(paths, wanted, blocked = settings.blockedDirs) {
    assertDownloadPath(wanted, blocked);
    if (!paths.every(folder => typeof folder?.Id === 'string' && typeof folder?.RealPath === 'string'))
        throw new Error('迅雷目录结构变化');
    const norm = (value) => value.replace(/\\/g, '/').replace(/\/+$/, '');
    const target = norm(wanted);
    const exact = paths.find(folder => norm(folder.RealPath) === target);
    if (exact)
        return { kind: 'exact', id: exact.Id, path: exact.RealPath };
    const parent = paths.filter(folder => target.startsWith(norm(folder.RealPath) + '/'))
        .sort((a, b) => norm(b.RealPath).length - norm(a.RealPath).length)[0];
    const segments = parent ? target.slice(norm(parent.RealPath).length + 1).split('/').filter(Boolean) : [];
    if (!parent || !segments.length)
        throw new Error('下载目录不在迅雷已有目录中，请使用 paths 查看可选目录');
    return { kind: 'child', parentId: parent.Id, path: `${target}/`, segments };
}
export class Thunder {
    kind = 'thunder';
    config;
    space;
    constructor(config) { this.config = config; this.space = thunderConfig(config).space; }
    ready() { return ensureThunderAuth(this.config); }
    async tasks() { return (await this.rawTasks()).map(summary); }
    async rawTasks() {
        const tasks = [], seen = new Set();
        let page = '';
        do {
            const q = new URLSearchParams({ space: this.space, limit: '100', page_token: page });
            const data = await nasRequest(this.config, 'drive/v1/tasks?' + q);
            if (!Array.isArray(data.tasks))
                throw new Error('迅雷任务列表结构变化');
            tasks.push(...data.tasks.filter((t) => ['user#download-url', 'user#download'].includes(t.type)));
            page = data.next_page_token || '';
            if (page && seen.has(page))
                throw new Error('迅雷分页游标重复');
            seen.add(page);
        } while (page);
        return tasks;
    }
    async existing(magnet) {
        const hash = infoHash(magnet);
        return (await this.rawTasks()).find(t => t.params?.info_hash?.toLowerCase() === hash ||
            (t.params?.url?.startsWith('magnet:') && infoHash(t.params.url) === hash));
    }
    async preview(magnet) {
        infoHash(magnet);
        const data = await nasRequest(this.config, 'drive/v1/resource/list', { page_size: 2000, urls: magnet });
        if (!data.list?.resources?.length)
            throw new Error('迅雷尚未解析出种子文件');
        return data;
    }
    async findChildFolder(parentId, name) {
        let page = '';
        const seen = new Set();
        do {
            const params = new URLSearchParams({ space: this.space, parent_id: parentId, limit: '200',
                filters: JSON.stringify({ kind: { eq: 'drive#folder' } }) });
            if (page)
                params.set('page_token', page);
            const data = await nasRequest(this.config, 'drive/v1/files?' + params);
            if (!Array.isArray(data.files))
                throw new Error('迅雷目录结构变化');
            const hits = data.files.filter((file) => file.name === name && file.id);
            if (hits.length > 1)
                throw new Error('迅雷目录下有重名文件夹');
            if (hits.length === 1)
                return hits[0].id;
            page = data.next_page_token || '';
            if (page && seen.has(page))
                throw new Error('迅雷分页游标重复');
            seen.add(page);
        } while (page);
        throw new Error('下载目录不在迅雷已有目录中，请使用 paths 查看可选目录');
    }
    async resolveFolder(path) {
        const folders = await nasRequest(this.config, 'device/download_paths');
        if (!Array.isArray(folders))
            throw new Error('迅雷目录结构变化');
        const plan = planFolder(folders, path);
        if (plan.kind === 'exact')
            return { id: plan.id, path: plan.path };
        let parentId = plan.parentId;
        for (const segment of plan.segments)
            parentId = await this.findChildFolder(parentId, segment);
        return { id: parentId, path: plan.path };
    }
    async download(magnet, path = thunderConfig(this.config).downloadDir, dryRun = false) {
        const hash = infoHash(magnet);
        assertDownloadPath(path);
        const dir = dirname(configPath), lock = join(dir, 'download.lock');
        await mkdir(dir, { recursive: true, mode: 0o700 });
        try {
            await mkdir(lock, { mode: 0o700 });
        }
        catch {
            throw new Error('已有下载命令运行；若进程已退出，请先查 status 再清理 download.lock');
        }
        const pending = join(dir, `pending-${hash}.json`);
        try {
            const exists = await this.existing(magnet);
            if (exists) {
                await unlink(pending).catch(() => { });
                return { action: 'existing', task: summary(exists) };
            }
            if (!dryRun) {
                const previous = await readFile(pending, 'utf8').catch((e) => { if (e.code !== 'ENOENT')
                    throw e; return null; });
                if (previous)
                    throw new Error(`上次提交结果未确认，请先核对迅雷任务；记录：${pending}`);
            }
            const preview = await this.preview(magnet), root = preview.list.resources[0];
            const folder = await this.resolveFolder(path);
            let body, files = [], whole = false;
            try {
                files = selectedFiles(root);
                body = taskBody(root, magnet, this.config, folder.id, folder.path);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : '';
                if (!root.is_dir || !/文件数量不完整|尚未完整展开|没有找到正片文件/.test(message))
                    throw error;
                whole = true;
                body = wholeTorrentBody(root, magnet, this.config, folder.id, folder.path);
                files = [{ index: '-1', name: root.name, size: root.file_size }];
            }
            if (dryRun)
                return { action: 'preview', body, files, whole };
            await writeFile(pending, JSON.stringify({ hash, name: root.name, submittedAt: new Date().toISOString() }), { mode: 0o600, flag: 'wx' });
            // A lost response must not trigger another creation; the next call reconciles against Thunder.
            const receipt = await nasRequest(this.config, 'drive/v1/task', body);
            for (let attempt = 0; attempt < 5; attempt++) {
                const task = await this.existing(magnet);
                if (task) {
                    await unlink(pending);
                    return { action: 'created', task: summary(task), whole };
                }
                await new Promise(resolve => setTimeout(resolve, 1500));
            }
            throw new Error(`已提交，尚未在任务列表确认。请查 status；回执 ID：${receipt.task?.id || receipt.id || '未返回'}`);
        }
        finally {
            await rmdir(lock);
        }
    }
}
