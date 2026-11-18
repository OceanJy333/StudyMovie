// input: 浏览器（Edge/Chrome 格式）书签文件、已有名册；output: 带固定 JavDB id 的老师名册；pos: 名册来源与演员身份的唯一写源。
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bookmarks } from '../core/paths.ts';
import { FIXED_CODES, pinActors, pinFor, resolveActor, type Pins } from '../javdb/actor.ts';
import type { Catalog } from '../javdb/types.ts';

interface BookmarkNode { type?: string; name?: string; url?: string; children?: BookmarkNode[] }
interface BookmarkDoc { roots?: Record<string, BookmarkNode | null> }

/** 只认指定书签文件夹下的 Jable 演员页；同名去重，顺序保持书签顺序。 */
export function performerNames(doc: BookmarkDoc, folder: string = bookmarks.folder): string[] {
  const folders: BookmarkNode[] = [];
  const walk = (node: BookmarkNode | null | undefined) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'folder' && node.name === folder) folders.push(node);
    for (const child of node.children ?? []) walk(child);
  };
  for (const root of Object.values(doc.roots ?? {})) walk(root);
  if (folders.length !== 1) throw new Error(`书签文件夹 ${folder} 找到 ${folders.length} 个`);
  const names: string[] = [], seen = new Set<string>();
  const collect = (node: BookmarkNode) => {
    if (node.type === 'url' && node.url) {
      try {
        const url = new URL(node.url);
        if (url.hostname.toLowerCase().includes('jable') && url.pathname.startsWith('/models/')) {
          const name = (node.name || '').split('出演')[0].trim();
          if (name && !seen.has(name)) { seen.add(name); names.push(name); }
        }
      } catch { /* 跳过坏书签 URL */ }
    }
    for (const child of node.children ?? []) collect(child);
  };
  const only = folders[0];
  if (!only) throw new Error(`书签文件夹 ${folder} 不存在`);
  collect(only);
  if (!names.length) throw new Error(`书签文件夹 ${folder} 里没有 Jable 演员页`);
  return names;
}

/** 书签在本机就直接读；在另一台机器（NAS_MOVIE_BOOKMARKS_HOST）上就用 scp 取一份。 */
export async function readEdgeBookmarks(): Promise<BookmarkDoc> {
  const parse = (text: string) => JSON.parse(text.replace(/^\uFEFF/, '')) as BookmarkDoc;
  if (!bookmarks.host) return parse(await readFile(bookmarks.file, 'utf8'));
  const dir = await mkdtemp(join(tmpdir(), 'nas-teachers-'));
  const dest = join(dir, 'Bookmarks');
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('scp', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', `${bookmarks.host}:${bookmarks.file}`, dest],
        { stdio: ['ignore', 'ignore', 'pipe'] });
      const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('读取书签超时')); }, 60000);
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`读取 Edge 书签失败 (${code})`)); });
    });
    return parse(await readFile(dest, 'utf8'));
  } finally { await rm(dir, { recursive: true, force: true }); }
}

export async function selectedNames(folder: string, name?: string): Promise<string[]> {
  const names = performerNames(await readEdgeBookmarks(), folder);
  const selected = name ? names.filter(item => item === name) : names;
  if (name && !selected.length) throw new Error('书签里没有这个名字');
  return selected;
}

/**
 * 名册文件：`{names, actors}`，actors 是书签名 → JavDB 演员 id。也接受裸数组，方便手工维护。
 * 读名册即装入固定身份，之后的片单查询不再按名字搜人。
 */
export async function readRoster(path: string): Promise<string[]> {
  const doc = JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, '')) as { names?: unknown; actors?: unknown } | unknown[];
  const names = Array.isArray(doc) ? doc : doc?.names;
  if (!Array.isArray(names) || !names.every(name => typeof name === 'string')) throw new Error('名册文件结构异常');
  if (!Array.isArray(doc) && doc?.actors && typeof doc.actors === 'object') pinActors(doc.actors as Pins);
  return names as string[];
}

/** 给名册里每个人定身份：已有固定 id 的照用，新名字才搜（网页搜索会 403，失败的列出来，下次部署再补）。 */
export async function pinRoster(names: readonly string[], catalog: Pick<Catalog, 'searchActors'>): Promise<{ actors: Pins; unresolved: string[] }> {
  const actors: Pins = {}, unresolved: string[] = [];
  for (const name of names) {
    if (FIXED_CODES[name]) continue;
    const pin = pinFor(name);
    if (pin) { actors[name] = pin; continue; }
    const actor = await resolveActor(name, catalog).catch(() => null);
    if (actor) actors[name] = { id: actor.id, name: actor.name || name };
    else unresolved.push(name);
  }
  return { actors, unresolved };
}

/** 指定 --name 时只留这个人；名册里没有就报错，避免静默跑空。 */
export async function pickNames(options: { folder: string; name?: string; names?: string[] }): Promise<string[]> {
  const names = options.names ?? await selectedNames(options.folder, options.name);
  const selected = options.name ? names.filter(item => item === options.name) : names;
  if (options.name && !selected.length) throw new Error('名册里没有这个名字');
  return selected;
}
