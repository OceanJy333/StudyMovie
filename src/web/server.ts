// input: 平铺片库 + 作品目录 + JavDB；output: 影片墙 HTTP 服务；pos: 片库浏览与补片。
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import type { Config } from '../config.ts';
import { HttpClient } from '../core/http.ts';
import { readJsonFile, writeJsonAtomic } from '../core/json.ts';
import { paths } from '../core/paths.ts';
import { readCatalog, catalogPath, type CatalogDoc } from '../catalog/store.ts';
import { defaultArchiveRoot, splitActresses, unknownActress, type MovieMeta } from '../library/naming.ts';
import { LibraryScanner, type LibraryItem } from '../library/scan.ts';
import { bestMagnet, jdbCover, usableMagnets } from '../javdb/index.ts';
import { Javdb } from '../javdb/client.ts';
import { downloader } from '../downloader.ts';
import { contentType, parseRange, safeMediaPath, safeNestedMediaPath } from './media.ts';
import { renderShowDetail, renderShows } from './shows.ts';
import { readShows, showsPath } from '../shows/config.ts';
import { scanShows } from '../shows/library.ts';
import { readShowsState } from '../shows/state.ts';
import type { ShowLibraryItem, ShowsConfig } from '../shows/types.ts';
import { renderActressWall, renderIndex } from './views.ts';
import { buildWall, groupByActress, wallCounts, type WallItem } from './wall.ts';

export const defaultPort = 8850;
export const coverCacheDir = paths.covers;
export const submittedPath = paths.submitted;

export interface WebOptions {
  config: Config; root: string; port: number; host: string; cachePath: string; coverDir: string;
  catalogPath: string; submittedPath: string; scanTtlMs: number; showsPath?: string; showsStatePath?: string;
}
export interface WebHandle { port: number; host: string; url: string; close(): Promise<void> }

interface Stamped<T> { stamp: string; value: T }
interface WallView {
  key: string; items: WallItem[]; counts: ReturnType<typeof wallCounts>; actresses: string[];
  etag: string; json?: Buffer; encoded: Map<string, Buffer>;
}

class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function sendHtml(req: IncomingMessage, res: ServerResponse, status: number, html: string, etag?: string) {
  if (etag && req.headers['if-none-match'] === etag) {
    res.writeHead(304, { etag, 'cache-control': 'no-cache' });
    res.end();
    return;
  }
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache',
    'content-length': String(Buffer.byteLength(html)), ...(etag ? { etag } : {}),
  });
  res.end(req.method === 'HEAD' ? undefined : html);
}

function pageTag(key: string, kind: string): string {
  return `W/"${createHash('sha1').update(`${key}:${kind}`).digest('base64url')}"`;
}

async function readBody(req: IncomingMessage, limit = 8192): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new ApiError(413, '请求体太大');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function fileStamp(path: string): Promise<string> {
  const info = await stat(path).catch(() => null);
  return info ? `${info.mtimeMs}:${info.size}` : 'missing';
}

/** `/api/items` 的线上格式：短数组省掉重复键，3.4k 部从 1.07 MB 降到 ~0.5 MB。 */
function compactItem(item: WallItem): unknown[] {
  return [
    item.number, item.date, item.actress, item.title, item.downloaded ? 1 : 0, item.sizeBytes,
    item.addedAt, item.file, item.magnets, item.submitted ? 1 : 0, item.bd ? 1 : 0, item.cover ? 1 : 0,
  ];
}


/** 影片与剧集共用：Range 分片、下载头、HEAD 支持。 */
async function serveMedia(req: IncomingMessage, res: ServerResponse, target: string, name: string, url: URL) {
  const info = await stat(target).catch(() => null);
  if (!info || !info.isFile()) { sendJson(res, 404, { error: '找不到文件' }); return; }
  const disposition = url.searchParams.get('dl') ? 'attachment' : 'inline';
  const range = parseRange(req.headers.range, info.size);
  if (range === 'invalid') {
    res.writeHead(416, { 'content-range': `bytes */${info.size}`, 'accept-ranges': 'bytes' });
    res.end();
    return;
  }
  const headers: Record<string, string> = {
    'content-type': contentType(name), 'accept-ranges': 'bytes', 'cache-control': 'no-store',
    'content-disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(basename(name))}`,
  };
  if (!range) {
    res.writeHead(200, { ...headers, 'content-length': String(info.size) });
    if (req.method === 'HEAD') { res.end(); return; }
    createReadStream(target).on('error', () => res.destroy()).pipe(res);
    return;
  }
  res.writeHead(206, {
    ...headers, 'content-range': `bytes ${range.start}-${range.end}/${info.size}`,
    'content-length': String(range.end - range.start + 1),
  });
  if (req.method === 'HEAD') { res.end(); return; }
  createReadStream(target, { start: range.start, end: range.end }).on('error', () => res.destroy()).pipe(res);
}

export async function startWeb(options: WebOptions): Promise<WebHandle> {
  const scanner = new LibraryScanner();
  const javdb = new Javdb();
  const covers = new HttpClient({ label: 'JavDB 封面', concurrency: 6, timeoutMs: 20_000 });
  const backend = downloader(options.config);

  let meta: Stamped<Record<string, MovieMeta>> | null = null;
  let catalog: Stamped<CatalogDoc> | null = null;
  let submitted: Stamped<Set<string>> | null = null;
  let view: WallView | null = null;
  let showsDoc: Stamped<ShowsConfig> | null = null;
  let showsLibrary: { at: number; items: ShowLibraryItem[] } | null = null;
  const showsConfigPath = options.showsPath ?? showsPath;
  const showsStateFile = options.showsStatePath;
  const coverJobs = new Map<string, Promise<Buffer | null>>();
  const coverMisses = new Map<string, number>();

  const loadMeta = async (): Promise<Stamped<Record<string, MovieMeta>>> => {
    const stamp = await fileStamp(options.cachePath);
    if (meta?.stamp === stamp) return meta;
    meta = { stamp, value: await readJsonFile<Record<string, MovieMeta>>(options.cachePath, {}) };
    return meta;
  };
  const loadCatalog = async (): Promise<Stamped<CatalogDoc>> => {
    const stamp = await fileStamp(options.catalogPath);
    if (catalog?.stamp === stamp) return catalog;
    catalog = { stamp, value: await readCatalog(options.catalogPath) };
    return catalog;
  };
  const loadSubmitted = async (): Promise<Stamped<Set<string>>> => {
    const stamp = await fileStamp(options.submittedPath);
    if (submitted?.stamp === stamp) return submitted;
    const doc = await readJsonFile<Record<string, { at?: string }>>(options.submittedPath, {});
    const cutoff = Date.now() - 7 * 86_400_000;
    const value = new Set(Object.entries(doc)
      .filter(([, entry]) => Date.parse(entry?.at ?? '') > cutoff).map(([number]) => number));
    submitted = { stamp, value };
    return submitted;
  };
  const saveSubmitted = async (set: Set<string>) => {
    const now = new Date().toISOString();
    const doc: Record<string, { at: string }> = {};
    for (const number of set) doc[number] = { at: now };
    await writeJsonAtomic(options.submittedPath, doc, { pretty: true });
    submitted = { stamp: await fileStamp(options.submittedPath), value: set };
  };
  const loadLibrary = async (cache: Record<string, MovieMeta>, version: string): Promise<LibraryItem[]> => scanner.scan(options.root, cache, version);
  const loadShowsDoc = async (): Promise<Stamped<ShowsConfig>> => {
    const stamp = await fileStamp(showsConfigPath);
    if (showsDoc?.stamp === stamp) return showsDoc;
    showsDoc = { stamp, value: await readShows(showsConfigPath) };
    return showsDoc;
  };
  const loadShowsLibrary = async (): Promise<ShowLibraryItem[]> => {
    if (showsLibrary && Date.now() - showsLibrary.at < 15_000) return showsLibrary.items;
    const config = (await loadShowsDoc()).value;
    showsLibrary = { at: Date.now(), items: await scanShows(config.root, config.subscriptions) };
    return showsLibrary.items;
  };

  /**
   * 一次扫描 + 一次合并，然后缓存到「目录版本 / 元数据 / 目录 / 提交记录」任一变化为止。
   * 之前每个请求都要合并 3.4k 条并做 O(n²) 的拼盘计数，这是墙上最大的 CPU 浪费。
   */
  const snapshot = async (): Promise<WallView> => {
    const [metaCache, catalogDoc, submittedSet] = await Promise.all([loadMeta(), loadCatalog(), loadSubmitted()]);
    const local = await loadLibrary(metaCache.value, metaCache.stamp);
    const key = `${scanner.version}|${metaCache.stamp}|${catalogDoc.stamp}|${submittedSet.stamp}|${local.length}`;
    if (view?.key === key) return view;
    const merged = buildWall(local, catalogDoc.value.entries, submittedSet.value);
    const items = merged.items;
    const actresses = [...new Set(items.flatMap(item => splitActresses(item.actress)))].sort((a, b) => a.localeCompare(b, 'zh'));
    const next: WallView = {
      key, items, counts: wallCounts(items, merged.multi), actresses,
      etag: `W/"${createHash('sha1').update(key).digest('base64url')}"`, encoded: new Map(),
    };
    view = next;
    return next;
  };
  const itemsBody = (current: WallView, encoding: 'identity' | 'gzip' | 'br'): Buffer => {
    if (encoding !== 'identity') {
      const cached = current.encoded.get(encoding);
      if (cached) return cached;
    }
    if (!current.json) {
      current.json = Buffer.from(JSON.stringify({
        items: current.items.map(compactItem), counts: current.counts, generatedAt: new Date().toISOString(),
      }));
    }
    if (encoding === 'identity') return current.json;
    const body = encoding === 'br' ? brotliCompressSync(current.json) : gzipSync(current.json);
    current.encoded.set(encoding, body);
    return body;
  };

  // 封面首次从 JavDB 静态主机拉，之后落盘复用；同一张并发只拉一次，失败记一小时。
  const coverFor = (number: string): Promise<Buffer | null> => {
    const key = number.toUpperCase();
    const existing = coverJobs.get(key);
    if (existing) return existing;
    if (Date.now() - (coverMisses.get(key) ?? 0) < 600_000) return Promise.resolve(null);
    const job = (async (): Promise<Buffer | null> => {
      const metaCache = await loadMeta();
      const id = metaCache.value[key]?.id ?? (await loadCatalog()).value.entries[key]?.movieId;
      if (!id) return null;
      const file = join(options.coverDir, `${id}.jpg`);
      try { return await readFile(file); } catch { /* 未缓存，下面拉取 */ }
      const url = jdbCover(id);
      if (!url) return null;
      const body = await covers.bytes(url);
      await mkdir(options.coverDir, { recursive: true });
      await writeFile(file, body);
      return body;
    })().catch(() => null);
    coverJobs.set(key, job);
    job.then(body => {
      coverJobs.delete(key);
      if (!body) coverMisses.set(key, Date.now());
    });
    return job;
  };

  // 迅雷同一时间只允许一个提交（download.lock），用队列串起来。
  let chain: Promise<unknown> = Promise.resolve();
  const serialize = <T>(job: () => Promise<T>): Promise<T> => {
    const run = chain.then(job, job);
    chain = run.then(() => undefined, () => undefined);
    return run;
  };
  const download = async (raw: string) => {
    const number = raw.trim().toUpperCase();
    if (!/^[A-Z0-9-]{2,24}$/.test(number)) throw new ApiError(400, '番号不合法');
    const current = await snapshot();
    if (current.items.some(item => item.number === number && item.downloaded)) throw new ApiError(409, '这部已经下载了');
    const done = (await loadSubmitted()).value;
    if (done.has(number)) return { number, action: 'existing' };
    const magnets = usableMagnets(await javdb.magnets(number));
    const picked = bestMagnet(magnets);
    if (!picked?.hash) throw new ApiError(409, '这部没有可用磁力');
    await backend.ready();
    const result = await backend.download(`magnet:?xt=urn:btih:${picked.hash}`, options.root);
    done.add(number);
    await saveSubmitted(done);
    return { number, action: result.action, taskId: result.task?.id, phase: result.task?.phase, name: picked.name ?? null };
  };

  const server = createServer((req, res) => {
    handle(req, res).catch(error => {
      const status = error instanceof ApiError ? error.status : 500;
      const message = error instanceof Error ? error.message : '服务内部错误';
      if (!res.headersSent) sendJson(res, status, { error: message });
      else res.destroy();
    });
  });
  // 局域网/Tailscale 上单次请求可能跨几秒，长连接能省掉重复握手。
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url || '/', 'http://localhost');
    const path = decodeURIComponent(url.pathname);
    res.setHeader('x-content-type-options', 'nosniff');

    if (path === '/api/download') {
      if (req.method !== 'POST') { sendJson(res, 405, { error: '只支持 POST' }); return; }
      const text = await readBody(req);
      let payload: { number?: unknown } = {};
      try { payload = JSON.parse(text || '{}') as { number?: unknown }; } catch { throw new ApiError(400, '请求体不是 JSON'); }
      if (typeof payload.number !== 'string') { sendJson(res, 400, { error: '缺少 number' }); return; }
      sendJson(res, 200, await serialize(() => download(payload.number as string)));
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { sendJson(res, 405, { error: '只支持 GET' }); return; }

    if (path === '/') {
      const current = await snapshot();
      sendHtml(req, res, 200, renderIndex(current.counts, current.actresses), pageTag(current.key, 'index'));
      return;
    }
    if (path === '/actresses') {
      const current = await snapshot();
      const known = current.items.filter(item => item.actress !== unknownActress);
      sendHtml(req, res, 200, renderActressWall(known, { unknownCount: current.items.length - known.length }), pageTag(current.key, 'actresses'));
      return;
    }
    if (path === '/api/items') {
      const current = await snapshot();
      const accept = String(req.headers['accept-encoding'] ?? '');
      const encoding: 'identity' | 'gzip' | 'br' = accept.includes('br') ? 'br' : accept.includes('gzip') ? 'gzip' : 'identity';
      if (req.headers['if-none-match'] === current.etag) {
        res.writeHead(304, { etag: current.etag, 'cache-control': 'no-cache', vary: 'accept-encoding' });
        res.end();
        return;
      }
      const body = itemsBody(current, encoding);
      const headers: Record<string, string> = {
        'content-type': 'application/json; charset=utf-8', 'content-length': String(body.length),
        etag: current.etag, vary: 'accept-encoding', 'cache-control': 'no-cache',
      };
      if (encoding !== 'identity') headers['content-encoding'] = encoding;
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    if (path === '/api/actresses') {
      const current = await snapshot();
      const groups = groupByActress(current.items.filter(item => item.actress !== unknownActress));
      sendJson(res, 200, { groups });
      return;
    }
    if (path === '/api/health') {
      const current = await snapshot();
      const entries = Object.keys((await loadCatalog()).value.entries).length;
      const showsConfig = (await loadShowsDoc()).value;
      const showsState = await readShowsState(showsStateFile);
      sendJson(res, 200, {
        ok: true, root: options.root, items: current.items.length,
        downloaded: current.counts.downloaded, missing: current.counts.missing,
        excluded: current.counts.multi, catalog: entries,
        shows: { subscriptions: showsConfig.subscriptions.length, lastCheck: showsState.lastCheck },
      });
      return;
    }
    if (path === '/shows') {
      const config = (await loadShowsDoc()).value;
      const state = await readShowsState(showsStateFile);
      const items = await loadShowsLibrary();
      const name = url.searchParams.get('name');
      if (name) {
        const item = items.find(show => show.name === name)
          ?? { name, episodes: [], totalBytes: 0, updatedAt: '', subscribed: true };
        sendHtml(req, res, 200, renderShowDetail(item, config.subscriptions.find(subscription => subscription.name === name)));
        return;
      }
      sendHtml(req, res, 200, renderShows(items, config.subscriptions, { lastCheck: state.lastCheck, root: config.root }));
      return;
    }
    if (path === '/api/shows') {
      const config = (await loadShowsDoc()).value;
      const state = await readShowsState(showsStateFile);
      const items = await loadShowsLibrary();
      sendJson(res, 200, {
        root: config.root, subscriptions: config.subscriptions, lastCheck: state.lastCheck,
        shows: items,
        totals: {
          shows: items.length, episodes: items.reduce((sum, show) => sum + show.episodes.length, 0),
          totalBytes: items.reduce((sum, show) => sum + show.totalBytes, 0),
        },
      });
      return;
    }
    if (path.startsWith('/shows-media/')) {
      const name = path.slice('/shows-media/'.length);
      const config = (await loadShowsDoc()).value;
      const target = safeNestedMediaPath(config.root, name);
      if (!target) { sendJson(res, 400, { error: '文件名不合法' }); return; }
      await serveMedia(req, res, target, name, url);
      return;
    }
    if (path.startsWith('/cover/')) {
      const number = path.slice('/cover/'.length).replace(/\.jpg$/i, '');
      if (!/^[A-Za-z0-9-]{2,24}$/.test(number)) { sendJson(res, 400, { error: '番号不合法' }); return; }
      const body = await coverFor(number);
      if (!body) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('无封面'); return; }
      res.writeHead(200, {
        'content-type': 'image/jpeg', 'content-length': String(body.length),
        'cache-control': 'public, max-age=604800, immutable',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    if (path.startsWith('/media/')) {
      const name = path.slice('/media/'.length);
      const target = safeMediaPath(options.root, name);
      if (!target) { sendJson(res, 400, { error: '文件名不合法' }); return; }
      await serveMedia(req, res, target, name, url);
      return;
    }
    sendJson(res, 404, { error: '没有这个地址' });
  }

  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(options.port, options.host, () => done());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : options.port;
  return {
    port, host: options.host, url: `http://${options.host === '0.0.0.0' ? '127.0.0.1' : options.host}:${port}/`,
    close: () => new Promise<void>((done, fail) => {
      server.close(error => (error ? fail(error) : done()));
      covers.close();
    }),
  };
}

export const webDefaults = {
  root: defaultArchiveRoot, port: defaultPort, host: '0.0.0.0',
  cachePath: paths.javdb, coverDir: coverCacheDir, catalogPath, submittedPath, scanTtlMs: 30_000, showsPath,
};
