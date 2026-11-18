// input: ~/.config/nas-movie/shows.json；output: 校验后的订阅配置；pos: 剧集订阅配置。
import { readJsonDoc, writeJsonAtomic, isRecord } from '../core/json.ts';
import { paths } from '../core/paths.ts';
import type { ShowKind, ShowSubscription, ShowsConfig } from './types.ts';

export const showsPath = paths.shows;
// 非 JAV 的影视内容统一放 Movie 下；剧集单独一个子目录，整理只扫这里，不碰已有电影。
export const defaultShowsRoot = paths.showsRoot;

function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function subscription(raw: unknown, index: number): ShowSubscription {
  if (!isRecord(raw)) throw new Error(`shows.json 第 ${index + 1} 条订阅不是对象`);
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) throw new Error(`shows.json 第 ${index + 1} 条订阅缺少 name`);
  const query = typeof raw.query === 'string' && raw.query.trim() ? raw.query.trim() : name;
  const aliases = Array.isArray(raw.aliases)
    ? raw.aliases.filter((alias): alias is string => typeof alias === 'string' && Boolean(alias.trim()))
    : [];
  const kind: ShowKind = raw.kind === 'anime' ? 'anime' : 'tv';
  const minSizeMB = Number(raw.minSizeMB), maxSizeMB = Number(raw.maxSizeMB);
  return {
    name, query, aliases: aliases.length ? aliases : [query, name],
    kind, season: numberOrNull(raw.season), totalEpisodes: numberOrNull(raw.totalEpisodes),
    subtitle: raw.subtitle === 'zh' ? 'zh' : 'any',
    year: numberOrNull(raw.year),
    enabled: raw.enabled !== false,
    minSizeMB: Number.isFinite(minSizeMB) && minSizeMB > 0 ? minSizeMB : 80,
    maxSizeMB: Number.isFinite(maxSizeMB) && maxSizeMB > 0 ? maxSizeMB : 30_000,
  };
}

function parseConfig(raw: unknown): ShowsConfig {
  if (!isRecord(raw)) throw new Error('shows.json 结构异常');
  const subscriptions = Array.isArray(raw.subscriptions)
    ? raw.subscriptions.map((item, index) => subscription(item, index))
    : [];
  return {
    version: 1,
    root: typeof raw.root === 'string' && raw.root.trim() ? raw.root.trim() : defaultShowsRoot,
    subscriptions,
  };
}

export function readShows(path = showsPath): Promise<ShowsConfig> {
  return readJsonDoc(path, parseConfig, { version: 1, root: defaultShowsRoot, subscriptions: [] });
}

export function writeShows(config: ShowsConfig, path = showsPath): Promise<void> {
  return writeJsonAtomic(path, config, { pretty: true });
}

export function findShow(config: ShowsConfig, name: string): ShowSubscription | undefined {
  return config.subscriptions.find(item => item.name === name);
}

export async function addShow(input: {
  name: string; query?: string; aliases?: string[]; kind?: ShowKind; season?: number | null;
  totalEpisodes?: number | null; subtitle?: 'zh' | 'any'; year?: number | null;
}, path = showsPath): Promise<ShowSubscription> {
  const config = await readShows(path);
  const name = input.name.trim();
  if (!name) throw new Error('剧名不能为空');
  const query = input.query?.trim() || name;
  const draft = subscription({
    name, query,
    aliases: input.aliases?.length ? input.aliases : [query, name],
    kind: input.kind ?? 'tv', season: input.season ?? null, totalEpisodes: input.totalEpisodes ?? null,
    subtitle: input.subtitle ?? 'any', year: input.year ?? null,
  }, 0);
  const index = config.subscriptions.findIndex(item => item.name === name);
  if (index >= 0) config.subscriptions[index] = draft;
  else config.subscriptions.push(draft);
  await writeShows(config, path);
  return draft;
}

export async function removeShow(name: string, path = showsPath): Promise<boolean> {
  const config = await readShows(path);
  const next = config.subscriptions.filter(item => item.name !== name);
  if (next.length === config.subscriptions.length) return false;
  config.subscriptions = next;
  await writeShows(config, path);
  return true;
}
