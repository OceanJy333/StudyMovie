// input: 番号系列/厂牌 token；output: 订阅源和最新作品；pos: 订阅源适配。
import { stderrNote } from '../core/log.ts';
import type { Movie, SubscriptionCatalog } from '../javdb/types.ts';
import { feedItem, orderFeed } from './feed.ts';
import type { FeedItem } from './types.ts';

// 订阅源：番号前缀（JavDB 过滤 `0:c:<前缀>`）或厂牌（`0:m:<厂牌 id>`）。AP 是 Aurora Project Annex 厂牌，
// APGH 是它的一个番号系列；两者新作都会进 feed，不受收藏夹演员限制。厂牌 id 固化在这里：按名字搜厂牌要登录。
export const SUBSCRIPTIONS: Record<string, { kind: 'prefix' | 'maker'; id?: string; name?: string }> = {
  APGH: { kind: 'prefix' },
  AP: { kind: 'maker', id: 'bwA', name: 'Aurora Project Annex' },
};

export interface Source { label: string; kind: 'prefix' | 'maker'; id: string; name: string | null }

function sourceLabel(source: Source): string {
  return `${source.kind === 'prefix' ? '系列' : '厂牌'}·${source.label}`;
}

export function sourceFilter(source: Source): string {
  return `0:${source.kind === 'prefix' ? 'c' : 'm'}:${source.id}`;
}

function dedupeMovies(movies: readonly Movie[]): Movie[] {
  const seen = new Set<string>();
  return movies.filter(movie => movie.id && movie.number && !seen.has(movie.id) && seen.add(movie.id));
}

// 未登记的 token 一律按番号前缀处理（--sub APRG,SNOS）。
export function resolveSubscription(token: string): Source {
  const hint = SUBSCRIPTIONS[token.toUpperCase()];
  if (hint?.kind === 'maker' && hint.id) return { label: token, kind: 'maker', id: hint.id, name: hint.name ?? null };
  return { label: token, kind: 'prefix', id: token.toUpperCase(), name: hint?.name ?? null };
}

// 过滤串写错时 JavDB 会退回全站最新片，所以前缀源再按番号前缀收一遍，厂牌源靠固化 id。
export async function sourceMovies(source: Source, catalog: SubscriptionCatalog, pages = 2): Promise<Movie[]> {
  const collected: Movie[] = [];
  for (let page = 1; page <= pages; page++) {
    const batch = await catalog.byFilter(sourceFilter(source), page);
    collected.push(...batch);
    if (batch.length < 8) break;
  }
  const ours = source.kind === 'prefix'
    ? collected.filter(movie => (movie.number || '').toUpperCase().startsWith(`${source.id}-`))
    : collected;
  return dedupeMovies(ours);
}

export async function sourceFeed(source: Source, catalog: SubscriptionCatalog, limit = 5, pages = 2): Promise<FeedItem[]> {
  const movies = await sourceMovies(source, catalog, pages);
  return orderFeed(movies.map(movie => feedItem(sourceLabel(source), source.name, movie))).slice(0, limit);
}

export async function subscriptionFeeds(tokens: string[], catalog: SubscriptionCatalog, perSource = 5): Promise<FeedItem[]> {
  const items: FeedItem[] = [];
  for (const token of tokens) {
    try {
      const source = resolveSubscription(token);
      const rows = await sourceFeed(source, catalog, perSource);
      stderrNote(`订阅 ${token}：${source.kind === 'prefix' ? '番号前缀' : '厂牌'} ${source.name ?? source.id}，${rows.length} 部`);
      items.push(...rows);
    } catch (error) {
      stderrNote(`订阅 ${token}：${error instanceof Error ? error.message : '失败'}`);
    }
  }
  return items;
}

export { sourceLabel };
