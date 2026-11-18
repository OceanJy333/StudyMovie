// input: CLI 选项；output: 老师列表 / 下载计划；pos: 老师订阅入口。
import type { Config } from '../config.ts';
import { mapLimit } from '../core/async.ts';
import { stderrNote } from '../core/log.ts';
import { Thunder, assertDownloadPath } from '../thunder.ts';
import { Javdb } from '../javdb/client.ts';
import { pickNames } from './bookmarks.ts';
import { feedFor, mergeFeed, onlyDownloadable, planFeed } from './feed.ts';
import { blank, latestFor } from './latest.ts';
import { subscriptionFeeds } from './sources.ts';
import type { FeedItem, Latest } from './types.ts';

const JOBS = 2;

export function present(row: Latest) {
  return {
    bookmark: row.bookmark, official: row.official, date: row.date, number: row.number, title: row.title,
    magnets: row.magnets, hd: row.hd, cnsub: row.cnsub, status: row.status, ...(row.error ? { error: row.error } : {}),
  };
}

export function arrange<T extends { status: Latest['status']; date: string | null; bookmark: string }>(rows: readonly T[]): T[] {
  const rank = { ok: 0, none: 1, unmatched: 2, error: 3 };
  return [...rows].sort((a, b) => rank[a.status] - rank[b.status] || (b.date ?? '').localeCompare(a.date ?? '')
    || a.bookmark.localeCompare(b.bookmark, 'zh'));
}

export async function runTeachers(options: {
  action: 'list' | 'pull'; apply: boolean; name?: string; folder: string; to: string; pages: number; config: Config;
  names?: string[];
}) {
  if (options.action === 'pull') assertDownloadPath(options.to);
  const selected = await pickNames(options);
  const client = new Javdb();
  const rows = await mapLimit(selected, JOBS, async (bookmark, index) => {
    try {
      const row = await latestFor(bookmark, client, options.pages);
      stderrNote(`${index + 1}/${selected.length} ${row.status}${row.number ? ` ${row.number}` : ''}`);
      return row;
    } catch (error) {
      stderrNote(`${index + 1}/${selected.length} error`);
      return { ...blank(bookmark, 'error'), error: error instanceof Error ? error.message : '失败' };
    }
  });
  const ordered = arrange(rows);
  if (options.action === 'list' || !options.apply) {
    return ordered.map(row => ({ ...present(row), ...(options.action === 'pull' ? { action: row.status === 'ok' ? 'planned' : 'skipped' } : {}) }));
  }
  const thunder = new Thunder(options.config);
  const submitted = [];
  for (const row of ordered) {
    if (row.status !== 'ok' || !row.hash) { submitted.push({ ...present(row), action: 'skipped' }); continue; }
    try {
      const result = await thunder.download(`magnet:?xt=urn:btih:${row.hash}`, options.to, false);
      submitted.push({ ...present(row), action: result.action, taskId: result.task?.id, phase: result.task?.phase, path: result.task?.path });
    } catch (error) {
      submitted.push({ ...present(row), action: 'error', error: error instanceof Error ? error.message : '下载失败' });
    }
  }
  return submitted;
}

export async function runTeachersFeed(options: {
  folder: string; name?: string; perTeacher: number; limit: number; downloadable?: boolean;
  subscriptions?: string[]; perSource?: number; noTeachers?: boolean; names?: string[];
}): Promise<FeedItem[]> {
  const client = new Javdb();
  let teacherItems: FeedItem[] = [];
  if (!options.noTeachers) {
    const selected = await pickNames(options);
    const groups = await mapLimit(selected, JOBS, async (bookmark, index) => {
      try {
        const items = await feedFor(bookmark, client, options.perTeacher);
        stderrNote(`${index + 1}/${selected.length} ${items[0]?.number ?? 'none'}`);
        return items;
      } catch (error) {
        stderrNote(`${index + 1}/${selected.length} error ${error instanceof Error ? error.message : '失败'}`);
        return [];
      }
    });
    teacherItems = mergeFeed(groups);
  }
  const tokens = options.subscriptions ?? [];
  const subs = tokens.length ? await subscriptionFeeds(tokens, client, options.perSource ?? 5) : [];
  if (options.downloadable) {
    stderrNote(`有磁力 演员 ${onlyDownloadable(teacherItems).length}/${teacherItems.length}，订阅 ${onlyDownloadable(subs).length}/${subs.length}`
      + '（按列表快照 magnets_count，未校验磁力有效性）');
  }
  return planFeed(teacherItems, subs, options.limit, options.downloadable);
}
