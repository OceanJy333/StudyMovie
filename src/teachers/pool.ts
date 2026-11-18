// input: 老师片单页；output: 按发行日期排序的补片池与已校验候选；pos: 补片池与磁力校验。
import { mapLimit } from '../core/async.ts';
import { stderrNote } from '../core/log.ts';
import { FIXED_CODES, resolveActor } from '../javdb/actor.ts';
import { looksLikeCompilation } from '../javdb/classify.ts';
import { bestHash, bestMagnet, usableMagnets } from '../javdb/magnet.ts';
import type { Catalog, Magnet, Movie, SubscriptionCatalog } from '../javdb/types.ts';
import { sourceLabel, resolveSubscription, sourceMovies } from './sources.ts';
import { orderCandidates } from './latest.ts';
import type { Candidate, PoolEntry } from './types.ts';

const PAGE_SHORT = 8;
const MAX_POOL_PAGES = 8;
const JOBS = 6;

/** 片单行转池条目：必须有番号，拼盘不收。有没有磁力由 sukebei 决定，不看 JavDB 自己的磁力数。 */
export function listed(source: string, movie: Movie): PoolEntry | null {
  if (!movie.id || !movie.number) return null;
  if (looksLikeCompilation(movie.title || movie.origin_title)) return null;
  return {
    id: movie.id, number: movie.number, date: movie.release_date || null,
    title: movie.title || movie.origin_title || null, source,
  };
}

export function orderPool(entries: readonly PoolEntry[]): PoolEntry[] {
  return [...entries].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.number.localeCompare(b.number));
}

export function dedupePool(groups: readonly PoolEntry[][]): PoolEntry[] {
  const seen = new Set<string>();
  const merged: PoolEntry[] = [];
  for (const entry of groups.flat()) {
    const key = entry.number.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }
  return orderPool(merged);
}

// 池子凑不满 want 时还要继续翻页；凑满后，某人手里最旧的一部仍不早于第 want 名，下一页可能还有更能挤进池子的作品。
export function poolFrontier(entries: readonly PoolEntry[], want: number): { enough: boolean; cutoff: string | null } {
  const ordered = orderPool(entries);
  if (ordered.length < want) return { enough: false, cutoff: null };
  return { enough: true, cutoff: ordered[want - 1]?.date ?? null };
}

interface FilmCursor {
  source: string; type: number; id: string; page: number; exhausted: boolean; oldest: string | null; entries: PoolEntry[];
}

function oldestDate(movies: readonly Movie[]): string | null {
  return movies.reduce<string | null>((oldest, movie) => {
    const date = movie.release_date || '';
    if (!date) return oldest;
    return !oldest || date < oldest ? date : oldest;
  }, null);
}

async function openCursor(bookmark: string, catalog: Catalog): Promise<FilmCursor | null> {
  const fixed = FIXED_CODES[bookmark];
  if (fixed) {
    const movie = await catalog.searchMovie(fixed);
    const entry = movie && (movie.number || '').toUpperCase() === fixed.toUpperCase() ? listed(bookmark, movie) : null;
    return {
      source: bookmark, type: 0, id: '', page: 1, exhausted: true,
      oldest: entry?.date ?? null, entries: entry ? [entry] : [],
    };
  }
  const actor = await resolveActor(bookmark, catalog);
  if (!actor) return null;
  return {
    source: actor.name || bookmark, type: Number(actor.type) === 0 ? 0 : Number(actor.type), id: actor.id,
    page: 0, exhausted: false, oldest: null, entries: [],
  };
}

async function pullPage(cursor: FilmCursor, catalog: Catalog): Promise<void> {
  if (cursor.exhausted || !cursor.id) { cursor.exhausted = true; return; }
  cursor.page += 1;
  const batch = await catalog.actorMovies(cursor.type, cursor.id, cursor.page);
  cursor.entries.push(...batch.map(movie => listed(cursor.source, movie)).filter((row): row is PoolEntry => Boolean(row)));
  const oldest = oldestDate(batch);
  if (oldest && (!cursor.oldest || oldest < cursor.oldest)) cursor.oldest = oldest;
  if (batch.length < PAGE_SHORT || cursor.page >= MAX_POOL_PAGES) cursor.exhausted = true;
}

function pendingCursors(cursors: readonly FilmCursor[], entries: readonly PoolEntry[], want: number, since?: string): FilmCursor[] {
  return cursors.filter(cursor => {
    if (cursor.exhausted) return false;
    // 增量只追窗口起点之后的作品，某人手里最旧的一部已经早于起点就不用再翻。
    if (since) return (cursor.oldest ?? '') >= since;
    const { enough, cutoff } = poolFrontier(entries, want);
    if (!enough || !cutoff) return !enough;
    return (cursor.oldest ?? '') >= cutoff;
  });
}

export async function performerPool(names: string[], catalog: Catalog, want: number, since?: string): Promise<{ entries: PoolEntry[]; failed: string[] }> {
  const failed: string[] = [];
  const cursors = (await mapLimit(names, JOBS, async (bookmark, index) => {
    try {
      const cursor = await openCursor(bookmark, catalog);
      if (!cursor) {
        failed.push(bookmark);
        stderrNote(`老师 ${index + 1}/${names.length} ${bookmark} 没有固定 id，名字也没找到唯一演员`);
        return null;
      }
      if (!cursor.exhausted) await pullPage(cursor, catalog);
      stderrNote(`老师 ${index + 1}/${names.length} ${cursor.entries[0]?.number ?? 'none'}`);
      return cursor;
    } catch (error) {
      failed.push(bookmark);
      stderrNote(`老师 ${index + 1}/${names.length} ${bookmark} 失败：${error instanceof Error ? error.message : '失败'}`);
      return null;
    }
  })).filter((cursor): cursor is FilmCursor => Boolean(cursor));
  for (;;) {
    const entries = dedupePool(cursors.map(cursor => cursor.entries));
    const pending = pendingCursors(cursors, entries, want, since);
    if (!pending.length) return { entries, failed };
    stderrNote(`池子 ${entries.length} 部，继续翻 ${pending.length} 人的更早作品`);
    await mapLimit(pending, JOBS, async cursor => {
      try { await pullPage(cursor, catalog); }
      catch (error) {
        cursor.exhausted = true;
        failed.push(cursor.source);
        stderrNote(`${cursor.source} 翻页失败：${error instanceof Error ? error.message : '失败'}`);
      }
    });
  }
}

async function readMagnets(catalog: Pick<Catalog, 'magnets'>, number: string, id?: string | null): Promise<Magnet[] | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return await catalog.magnets(number, id); }
    catch (error) {
      if (attempt === 1) {
        stderrNote(`${number} 磁力查询失败：${error instanceof Error ? error.message : '失败'}`);
        return null;
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  return null;
}

// 已入库的番号占住「最新 N」的名额；磁力不可用或查询失败不占名额，继续往下补。连续查询失败则停下，避免在封禁里空转。
export async function selectBackfill(
  entries: readonly PoolEntry[], catalog: Pick<Catalog, 'magnets'>, held: ReadonlySet<string>, limit: number,
): Promise<{ download: Candidate[]; held: number; skipped: number }> {
  let covered = 0, heldCount = 0, skipped = 0, streak = 0;
  const download: Candidate[] = [];
  for (const entry of entries) {
    if (covered >= limit) break;
    if (held.has(entry.number.toUpperCase())) { covered++; heldCount++; continue; }
    const magnets = await readMagnets(catalog, entry.number, entry.id);
    if (!magnets) {
      skipped++;
      if (++streak >= 8) { stderrNote('磁力源连续失败，先停下，已确认的留下次再补'); break; }
      continue;
    }
    streak = 0;
    const hash = bestHash(magnets);
    if (!hash) { skipped++; continue; }
    covered++;
    download.push({ number: entry.number, hash, date: entry.date, source: entry.source, title: entry.title });
  }
  return { download, held: heldCount, skipped };
}

// 增量只验「窗口内且账本没有」的作品。已记录的和更早的不查磁力；闸门截断的部分留下次，不记账。
/**
 * 今天要不要去查这部的磁力。sukebei 每秒只放行不到 1 次请求，池子里六成是还没发行的新片，
 * 不挑着查一次要 3 分钟。种子一般在发行前后出现：发行前一天开始查，两周内每天查，更早的冷门作品每周查一次。
 */
export function magnetDue(date: string | null | undefined, today: string): boolean {
  if (!date) return true;
  const age = Math.round((Date.parse(today) - Date.parse(date)) / 86_400_000);
  if (age < -1) return false;
  return age <= 14 || age % 7 === 0;
}

const MAGNET_BATCH = 4;

export async function selectUpdates(
  entries: readonly PoolEntry[], catalog: Pick<Catalog, 'magnets'>, seen: ReadonlySet<string>, cutoff: string, limit: number,
  today = new Date().toLocaleDateString('sv'),
): Promise<{ download: Candidate[]; seen: number; skipped: number; waiting: number; overflow: number; errors: string[] }> {
  let seenCount = 0, skipped = 0, waiting = 0, overflow = 0, streak = 0;
  const download: Candidate[] = [], errors: string[] = [];
  let capped = false, stopped = false;
  const due: PoolEntry[] = [];
  for (const entry of entries) {
    if (entry.date && entry.date < cutoff) continue;
    if (seen.has(entry.number.toUpperCase())) { seenCount++; continue; }
    if (!magnetDue(entry.date, today)) { waiting++; continue; }
    due.push(entry);
  }
  // 按池子顺序分批并发：每个磁力源的 HttpClient 自己节流，并发只是让网页和 sukebei 两边的等待重叠。
  // 批大小不超过还差的名额，闸门快满时不多查。
  for (let start = 0; start < due.length;) {
    const batch = due.slice(start, start + Math.max(1, Math.min(MAGNET_BATCH, limit - download.length)));
    start += batch.length;
    if (capped || stopped) { overflow += batch.length; continue; }
    const results = await Promise.all(batch.map(entry => readMagnets(catalog, entry.number, entry.id)));
    batch.forEach((entry, index) => {
      if (capped || stopped) { overflow++; return; }
      const magnets = results[index];
      // 查询出错和「还没有种子」分开记：前者是故障，要让任务失败；后者正常，明天再查。
      if (!magnets) {
        errors.push(entry.number);
        if (++streak >= 8) { stderrNote('磁力源连续失败，本次增量先停下'); stopped = true; }
        return;
      }
      streak = 0;
      const hash = bestHash(magnets);
      if (!hash) { skipped++; return; }
      download.push({ number: entry.number, hash, date: entry.date, source: entry.source, title: entry.title });
      if (download.length >= limit) capped = true;
    });
  }
  return { download, seen: seenCount, skipped, waiting, overflow, errors };
}

export async function subscriptionPool(
  tokens: string[], catalog: SubscriptionCatalog, since: string,
): Promise<{ entries: PoolEntry[]; notes: string[]; failed: string[] }> {
  const notes: string[] = [], failed: string[] = [], groups: PoolEntry[][] = [];
  for (const token of tokens) {
    try {
      const source = resolveSubscription(token);
      const movies = await sourceMovies(source, catalog, 4);
      const entries = movies.map(movie => listed(sourceLabel(source), movie)).filter((row): row is PoolEntry => Boolean(row))
        .filter(entry => !entry.date || entry.date >= since);
      notes.push(`订阅 ${token}：窗口内 ${entries.length} 部`);
      groups.push(entries);
    } catch (error) {
      failed.push(token);
      notes.push(`订阅 ${token}：${error instanceof Error ? error.message : '失败'}`);
    }
  }
  return { entries: dedupePool(groups), notes, failed };
}

export async function subscriptionCandidates(
  tokens: string[], catalog: SubscriptionCatalog, perSource: number,
): Promise<{ candidates: Candidate[]; notes: string[] }> {
  const notes: string[] = [], candidates: Candidate[] = [];
  for (const token of tokens) {
    try {
      const source = resolveSubscription(token);
      const movies = (await sourceMovies(source, catalog, 2)).slice(0, perSource);
      let verified = 0;
      for (const movie of movies) {
        if (!movie.id || !movie.number) continue;
        const hash = bestHash(await catalog.magnets(movie.number, movie.id));
        if (!hash) continue;
        verified++;
        candidates.push({
          number: movie.number, hash, date: movie.release_date ?? null,
          source: sourceLabel(source), title: movie.title ?? movie.origin_title ?? null,
        });
      }
      notes.push(`订阅 ${token}：${source.kind === 'prefix' ? '番号前缀' : '厂牌'} ${source.name ?? source.id}，最新 ${movies.length} 部里 ${verified} 部有可用磁力`);
    } catch (error) {
      notes.push(`订阅 ${token}：${error instanceof Error ? error.message : '失败'}`);
    }
  }
  return { candidates: orderCandidates(candidates), notes };
}

// 手动指定番号：直接按番号查磁力，不经 JavDB（按番号找作品要翻整个前缀片单）。
export async function manualCandidates(numbers: readonly string[], catalog: Pick<Catalog, 'magnets'>): Promise<{ candidates: Candidate[]; notes: string[]; failed: string[] }> {
  const notes: string[] = [], failed: string[] = [], candidates: Candidate[] = [];
  for (const raw of numbers) {
    const number = raw.toUpperCase();
    try {
      const best = bestMagnet(usableMagnets(await catalog.magnets(number)));
      if (!best?.hash) { failed.push(number); notes.push(`${number}：没有可用磁力`); continue; }
      candidates.push({ number, hash: best.hash.toLowerCase(), date: null, source: '手动挑选', title: best.name ?? null });
    } catch (error) {
      failed.push(number);
      notes.push(`${number}：${error instanceof Error ? error.message : '失败'}`);
    }
  }
  return { candidates: orderCandidates(candidates), notes, failed };
}

export async function mergeCandidates(groups: readonly Candidate[][]): Promise<Candidate[]> {
  const byNumber = new Set<string>(), byHash = new Set<string>();
  const merged: Candidate[] = [];
  for (const candidate of groups.flat()) {
    const number = candidate.number.toUpperCase(), hash = candidate.hash.toLowerCase();
    if (byNumber.has(number) || byHash.has(hash)) continue;
    byNumber.add(number);
    byHash.add(hash);
    merged.push(candidate);
  }
  return orderCandidates(merged);
}
