// input: verified candidates, state ledger and downloader config; output: new downloads; pos: daily automation.
import type { Config } from './config.ts';
import { stderrNote } from './core/log.ts';
import { readJsonFile, writeJsonAtomic } from './core/json.ts';
import { paths } from './core/paths.ts';
import { multiNumbers, readCatalog } from './catalog/store.ts';
import { windowCutoff } from './core/time.ts';
import { downloader } from './downloader.ts';
import { assertDownloadPath } from './core/paths.ts';
import { authExpiry } from './thunder-auth.ts';
import { Javdb } from './javdb/client.ts';
import { readRoster } from './teachers/bookmarks.ts';
import { dedupePool, manualCandidates, performerPool, selectBackfill, selectUpdates, subscriptionPool } from './teachers/pool.ts';
import type { Candidate } from './teachers/types.ts';

export const autoStatePath = paths.auto;

export interface SeenEntry { hash: string; date: string | null; source: string; at: string; action: string; taskId?: string }
export interface AutoState { seen: Record<string, SeenEntry> }
export interface AutoResult extends Candidate { action: string; taskId?: string; phase?: string; path?: string; error?: string }
export interface AutoOptions {
  config: Config; names: string[]; tokens: string[]; to: string; days: number; pages: number;
  perSource: number; limit: number; apply: boolean; statePath?: string; numbers?: string[];
}
export interface BackfillOptions {
  config: Config; names: string[]; to: string; limit: number; apply: boolean; statePath?: string;
}

export async function readState(path = autoStatePath): Promise<AutoState> {
  const doc = await readJsonFile<Partial<AutoState>>(path, {});
  return { seen: doc?.seen && typeof doc.seen === 'object' ? doc.seen : {} };
}

export function writeState(state: AutoState, path = autoStatePath): Promise<void> {
  return writeJsonAtomic(path, state, { pretty: true });
}

export function tokenExpiry(config: Config): Date | null {
  const expiry = authExpiry(config.thunder?.headers['pan-auth'] || '');
  return expiry ? new Date(expiry) : null;
}

// skip-old 是每日任务把窗口外旧作记账、故意没下的。一次性补片不能把它们当成已经入库。
export function heldNumbers(state: AutoState): Set<string> {
  return new Set(Object.entries(state.seen).filter(([, entry]) => entry.action !== 'skip-old').map(([number]) => number.toUpperCase()));
}

export function seenNumbers(state: AutoState): Set<string> {
  return new Set(Object.keys(state.seen).map(number => number.toUpperCase()));
}

// 只下没有记录过、且在 days 天窗口内的作品；窗口外的旧作记账后不再补下，避免首次运行拖整个片库。
export function freshCandidates(candidates: readonly Candidate[], state: AutoState, days: number, now = new Date()) {
  const cutoff = windowCutoff(days, now);
  const fresh: Candidate[] = [], old: Candidate[] = [], seen: Candidate[] = [];
  for (const candidate of candidates) {
    if (state.seen[candidate.number.toUpperCase()]) { seen.push(candidate); continue; }
    if (candidate.date && candidate.date < cutoff) { old.push(candidate); continue; }
    fresh.push(candidate);
  }
  return { fresh, old, seen, cutoff };
}

async function submitCandidates(
  picked: readonly Candidate[], to: string, config: Config, state: AutoState, statePath: string, at: string,
): Promise<AutoResult[]> {
  const backend = downloader(config);
  await backend.ready();
  const results: AutoResult[] = [];
  for (const candidate of picked) {
    try {
      const result = await backend.download(`magnet:?xt=urn:btih:${candidate.hash}`, to, false);
      state.seen[candidate.number.toUpperCase()] = {
        hash: candidate.hash, date: candidate.date, source: candidate.source, at, action: result.action, taskId: result.task?.id,
      };
      await writeState(state, statePath);
      results.push({ ...candidate, action: result.action, taskId: result.task?.id, phase: result.task?.phase, path: result.task?.path });
      stderrNote(`提交 ${candidate.number} ${result.action}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '下载失败';
      results.push({ ...candidate, action: 'error', error: message });
      stderrNote(`提交 ${candidate.number} 失败：${message}`);
    }
  }
  return results;
}

export async function runAuto(options: AutoOptions) {
  assertDownloadPath(options.to);
  const statePath = options.statePath || autoStatePath;
  const state = await readState(statePath);
  const client = new Javdb();
  const expiry = tokenExpiry(options.config);

  if (options.numbers?.length) {
    const manual = await manualCandidates(options.numbers, client);
    for (const note of manual.notes) stderrNote(note);
    const counts = {
      pool: manual.candidates.length, fresh: manual.candidates.length, picked: manual.candidates.length,
      overflow: 0, seen: 0, skipped: 0, failedTeachers: 0,
    };
    stderrNote(`手动指定 ${manual.candidates.length} 部`);
    if (!options.apply) {
      return {
        apply: false, statePath, counts, failures: manual.failed, expiry: expiry?.toISOString() ?? null, cutoff: '手动指定',
        results: manual.candidates.map(candidate => ({ ...candidate, action: 'would-download' })) as AutoResult[],
      };
    }
    const results = await submitCandidates(manual.candidates, options.to, options.config, state, statePath, new Date().toISOString());
    const rejected = results.filter(result => result.action === 'error').map(result => result.number);
    return { apply: true, statePath, counts, failures: [...manual.failed, ...rejected], expiry: expiry?.toISOString() ?? null, cutoff: '手动指定', results };
  }

  const cutoff = windowCutoff(options.days);
  const teacher = options.names.length ? await performerPool(options.names, client, 1, cutoff) : { entries: [], failed: [] };
  const subs = options.tokens.length ? await subscriptionPool(options.tokens, client, cutoff) : { entries: [], notes: [], failed: [] };
  for (const note of subs.notes) stderrNote(note);
  // 作品目录里的多人合集一律不进自动下载；标题规则漏掉的（如 MIZD-559）靠 sources 兜住。
  const multi = multiNumbers(await readCatalog().catch(() => ({ version: 2, updatedAt: '', entries: {}, teachers: {} })));
  const entries = dedupePool([teacher.entries, subs.entries])
    .filter(entry => !multi.has(entry.number.toUpperCase()));
  const picked = await selectUpdates(entries, client, seenNumbers(state), cutoff, options.limit);
  const counts = {
    pool: entries.length, fresh: picked.download.length, picked: picked.download.length, overflow: picked.overflow,
    seen: picked.seen, skipped: picked.skipped, waiting: picked.waiting, failedTeachers: teacher.failed.length,
  };
  // 有人或订阅源没查成，本次就不算成功：退出码非零，systemd 记 failed，日志里点名。
  const failures = [...teacher.failed, ...subs.failed, ...picked.errors.map(number => `${number} 磁力查询`)];
  stderrNote(`${new Date().toISOString()} 池子 ${counts.pool}｜窗口起点 ${cutoff}｜新 ${counts.fresh}｜已记录 ${counts.seen}`
    + `｜还没有种子 ${counts.skipped}｜未发行或本周已查 ${counts.waiting}｜闸门留下次 ${counts.overflow}｜失败 ${failures.length}`
    + `${failures.length ? `（${failures.join('、')}）` : ''}`
    + `${expiry ? `｜迅雷 token 到 ${expiry.toISOString()}` : ''}`);
  if (!options.apply || !picked.download.length) {
    return {
      apply: options.apply, statePath, counts, failures, expiry: expiry?.toISOString() ?? null, cutoff,
      results: picked.download.map(candidate => ({ ...candidate, action: 'would-download' })) as AutoResult[],
    };
  }
  const results = await submitCandidates(picked.download, options.to, options.config, state, statePath, new Date().toISOString());
  const rejected = results.filter(result => result.action === 'error').map(result => result.number);
  return { apply: true, statePath, counts, failures: [...failures, ...rejected], expiry: expiry?.toISOString() ?? null, cutoff, results };
}

// 所有老师的近期作品合成一个池，按发行日期覆盖最新 limit 部。已入库的占名额；窗口外没下过的仍可补进来。
export async function runBackfill(options: BackfillOptions) {
  if (!options.names.length) throw new Error('没有老师名册');
  assertDownloadPath(options.to);
  const statePath = options.statePath || autoStatePath;
  const state = await readState(statePath);
  const client = new Javdb();
  const { entries: pool, failed } = await performerPool(options.names, client, options.limit);
  const multi = multiNumbers(await readCatalog().catch(() => ({ version: 2, updatedAt: '', entries: {}, teachers: {} })));
  const entries = pool.filter(entry => !multi.has(entry.number.toUpperCase()));
  const picked = await selectBackfill(entries, client, heldNumbers(state), options.limit);
  const counts = {
    pool: entries.length, limit: options.limit, held: picked.held, download: picked.download.length,
    skipped: picked.skipped, failedTeachers: failed.length,
  };
  stderrNote(`池子 ${counts.pool}｜目标最新 ${options.limit}｜已入库 ${counts.held}｜待下 ${counts.download}`
    + `｜磁力不可用 ${counts.skipped}｜老师失败 ${counts.failedTeachers}`);
  if (!options.apply) {
    return { apply: false, statePath, counts, failures: failed, results: picked.download.map(candidate => ({ ...candidate, action: 'would-download' })) as AutoResult[] };
  }
  const results = await submitCandidates(picked.download, options.to, options.config, state, statePath, new Date().toISOString());
  await writeState(state, statePath);
  return { apply: true, statePath, counts, failures: failed, results };
}

export { readRoster, windowCutoff };
