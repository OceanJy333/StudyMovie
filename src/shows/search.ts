// input: Jackett 原始结果 + 订阅；output: 每集最优种子分组；pos: 剧集候选选择。
import type { JackettResult } from '../jackett.ts';
import { matchesShow, parseEpisode } from './parse.ts';
import type { ShowSubscription, TorrentGroup } from './types.ts';

const MB = 1024 * 1024;

/** 画质粗排：先分辨率，再来源，最后字幕；枪版直接排除。 */
export function qualityScore(title: string): number {
  if (/\b(?:cam|hdcam|ts|tc)\b|枪版/i.test(title)) return -100;
  let score = 0;
  if (/\b(?:2160p|4k|uhd)\b/i.test(title)) score += 40;
  else if (/\b1080p\b/i.test(title)) score += 30;
  else if (/\b720p\b/i.test(title)) score += 15;
  else if (/\b480p\b/i.test(title)) score += 4;
  if (/web[-_. ]?dl|webrip/i.test(title)) score += 8;
  else if (/bluray|bdrip|remux/i.test(title)) score += 10;
  else if (/hdtv/i.test(title)) score += 4;
  if (/\b(?:hdr|dovi|dolby[ ._-]?vision)\b/i.test(title)) score += 4;
  if (/中字|中文字幕|chs|cht|简中|繁中/i.test(title)) score += 3;
  return score;
}

export function seedScore(seeds: number | null): number {
  if (seeds === null || seeds <= 0) return 0;
  return Math.min(12, Math.log2(seeds + 1) * 3);
}

function aliasList(sub: ShowSubscription): string[] {
  return sub.aliases.length ? sub.aliases : [sub.query, sub.name];
}

const CHINESE_SUB = /中字|中文字幕|简日|繁日|简中|繁中|簡日|繁體|CHS|CHT|BIG5|Baha|巴哈|内嵌|內嵌|字幕组|字幕組|JPSC|\bGB\b/i;

/** 标题是否明确标注中文（简/繁/巴哈/内嵌）。只做「有标记」判断，不猜。 */
export function hasChineseSubtitle(title: string): boolean {
  return CHINESE_SUB.test(title);
}

/**
 * 每个单集只留一个最优种子；合集展开成多集后按 hash 合并成一个分组，
 * 这样一包 12 集只会提交一次迅雷任务。
 */
export function buildGroups(sub: ShowSubscription, results: readonly JackettResult[]): TorrentGroup[] {
  const best = new Map<number, { result: JackettResult; score: number; season: number }>();
  const aliases = aliasList(sub);
  for (const result of results) {
    if (!matchesShow(result.title, aliases)) continue;
    if (sub.subtitle === 'zh' && !hasChineseSubtitle(result.title)) continue;
    if (result.sizeBytes < sub.minSizeMB * MB || result.sizeBytes > sub.maxSizeMB * MB) continue;
    if (result.seeds !== null && result.seeds <= 0) continue;
    if (/\.(?:rar|zip|7z|iso)$/i.test(result.title)) continue;
    const info = parseEpisode(result.title);
    const season = info.season ?? sub.season ?? 1;
    if (sub.season !== null && season !== sub.season) continue;
    const episodes = info.range
      ? Array.from({ length: Math.min(200, info.range[1] - info.range[0] + 1) }, (_, index) => info.range![0] + index)
      : info.episode ? [info.episode] : [];
    if (!episodes.length) continue;
    const score = qualityScore(result.title) + seedScore(result.seeds);
    if (score < 0) continue;
    for (const episode of episodes) {
      const current = best.get(episode);
      if (!current || score > current.score
        || (score === current.score && result.sizeBytes < current.result.sizeBytes)) {
        best.set(episode, { result, score, season });
      }
    }
  }
  const groups = new Map<string, TorrentGroup>();
  for (const [episode, pick] of [...best].sort((a, b) => a[0] - b[0])) {
    const group = groups.get(pick.result.hash) ?? {
      show: sub.name, season: pick.season, episodes: [], title: pick.result.title,
      hash: pick.result.hash, magnet: pick.result.magnet, sizeBytes: pick.result.sizeBytes,
      seeds: pick.result.seeds, score: pick.score, pack: false,
    };
    group.episodes.push(episode);
    group.score = Math.max(group.score, pick.score);
    groups.set(pick.result.hash, group);
  }
  return [...groups.values()]
    .map(group => ({ ...group, pack: group.episodes.length > 1 }))
    .sort((a, b) => (a.episodes[0] ?? 0) - (b.episodes[0] ?? 0) || b.score - a.score);
}
