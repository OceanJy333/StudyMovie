// input: 片库根目录；output: 已排序的影片条目；pos: 片库扫描。
import { readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { mapLimit } from '../core/async.ts';
import { parseLibraryName, videoExtensions, type MovieMeta } from './naming.ts';

export interface LibraryItem {
  file: string; number: string; date: string | null; actress: string;
  title: string | null; cover: string | null; sizeBytes: number; addedAt: string;
}

/**
 * 片库扫描器。目录 mtime 和元数据版本都没变时直接返回上次结果（只花一次 stat）；
 * 有变化才 readdir + 并发 stat。片库是平铺的，几万文件也只是几百毫秒。
 */
export class LibraryScanner {
  private revision = 0;
  private cached: { rootStamp: string; metaVersion: string; items: LibraryItem[] } | null = null;

  /** 目录内容版本号；影片墙用它判断快照是否过期。 */
  get version(): number {
    return this.revision;
  }

  async scan(root: string, meta: Record<string, MovieMeta>, metaVersion = ''): Promise<LibraryItem[]> {
    const info = await stat(root).catch(() => null);
    const rootStamp = `${info?.mtimeMs ?? 0}:${info?.ino ?? 0}`;
    if (this.cached?.rootStamp === rootStamp && this.cached.metaVersion === metaVersion) return this.cached.items;

    const listing = await readdir(root, { withFileTypes: true });
    const items: LibraryItem[] = [];
    const names = listing.filter(entry => entry.isFile() && videoExtensions.has(extname(entry.name).toLowerCase())
      && parseLibraryName(entry.name) !== null).map(entry => entry.name);
    await mapLimit(names, 16, async name => {
      const parsed = parseLibraryName(name);
      const details = await stat(join(root, name)).catch(() => null);
      if (!parsed || !details?.isFile()) return;
      const cached = meta[parsed.number];
      items.push({
        file: name, ...parsed,
        title: cached?.title ?? null,
        cover: cached?.id ? `/cover/${encodeURIComponent(parsed.number)}.jpg` : null,
        sizeBytes: details.size,
        addedAt: new Date(details.mtimeMs).toISOString(),
      });
    });
    // 新的在前；同一天按番号排，同番号多片按文件名排，保证顺序稳定。
    items.sort((a, b) => (b.date ?? '0000').localeCompare(a.date ?? '0000')
      || a.number.localeCompare(b.number) || a.file.localeCompare(b.file));
    this.cached = { rootStamp, metaVersion, items };
    this.revision++;
    return items;
  }
}

/** 一次性扫描（测试和 CLI 用）。 */
export function buildLibrary(root: string, meta: Record<string, MovieMeta>): Promise<LibraryItem[]> {
  return new LibraryScanner().scan(root, meta);
}
