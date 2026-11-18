// input: 演员片单 / 订阅源；output: 展示用最新作品流；pos: 老师订阅 feed。
import { FIXED_CODES, jdbCover, resolveActor } from '../javdb/actor.ts';
import { looksLikeCompilation } from '../javdb/classify.ts';
import type { Catalog, Movie } from '../javdb/types.ts';
import type { FeedItem } from './types.ts';

export function feedItem(bookmark: string, official: string | null, movie: Movie): FeedItem {
  const number = movie.number || '';
  return {
    date: movie.release_date || null, bookmark, official, number, title: movie.title || movie.origin_title || null,
    cover: jdbCover(movie.id) ?? movie.cover_url ?? null,
    magnets: movie.magnets_count ?? null, duration: movie.duration ?? null, id: movie.id,
    jable: number ? `https://jable.tv/videos/${number.toLowerCase()}/` : null,
  };
}

export function orderFeed(items: readonly FeedItem[]): FeedItem[] {
  return [...items].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.bookmark.localeCompare(b.bookmark, 'zh'));
}

// magnets_count 来自列表快照，是「可能能下」的提示，不是校验过的种子。
export function onlyDownloadable(items: readonly FeedItem[]): FeedItem[] {
  return items.filter(item => (item.magnets ?? 0) > 0);
}

// 第 1 页片单就是最新作品；feed 从不查磁力。
export async function feedFor(bookmark: string, catalog: Catalog, perTeacher = 1): Promise<FeedItem[]> {
  const fixed = FIXED_CODES[bookmark];
  if (fixed) {
    const movie = await catalog.searchMovie(fixed);
    return movie && (movie.number || '').toUpperCase() === fixed.toUpperCase() ? [feedItem(bookmark, bookmark, movie)] : [];
  }
  const actor = await resolveActor(bookmark, catalog);
  if (!actor) return [];
  const movies = await catalog.actorMovies(Number(actor.type) === 0 ? 0 : Number(actor.type), actor.id, 1);
  const items = movies.filter(movie => movie.id && movie.number && !looksLikeCompilation(movie.title || movie.origin_title))
    .map(movie => feedItem(bookmark, actor.name || bookmark, movie));
  return orderFeed(items).slice(0, perTeacher);
}

export function mergeFeed(groups: readonly FeedItem[][]): FeedItem[] {
  const seen = new Set<string>();
  const merged: FeedItem[] = [];
  for (const item of groups.flat()) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
  }
  return orderFeed(merged);
}

// 订阅行先占位：limit 里先确保每个订阅源的点位，再用最新的演员行补满，避免订阅被老师新片挤掉。
export function planFeed(teacherItems: readonly FeedItem[], subRows: readonly FeedItem[], limit: number, downloadable = false): FeedItem[] {
  const pool = orderFeed(downloadable ? onlyDownloadable(teacherItems) : teacherItems);
  const subs = orderFeed(downloadable ? onlyDownloadable(subRows) : subRows);
  const budget = Math.max(0, limit - subs.length);
  const flat = mergeFeed([pool.slice(0, budget), subs]);
  const filled = flat.length < limit ? mergeFeed([flat, pool.slice(0, limit)]) : flat;
  return filled.slice(0, limit);
}
