// input: 作品目录 JSON；output: 目录读写；pos: 片库墙「全部作品」的数据层。
import { readJsonDoc, writeJsonAtomic } from '../core/json.ts';
import { paths } from '../core/paths.ts';

export const catalogPath = paths.catalog;
export const CATALOG_VERSION = 2;

export interface CatalogEntry {
  number: string; date: string | null; title: string | null; actress: string;
  movieId: string; magnets: number; updatedAt: string;
  /** 在哪些老师的片单里出现过；>=2 就是多女优共演/拼盘。 */
  sources: string[]; multi: boolean; bd: boolean;
}
export interface TeacherSync {
  id: string; name: string; syncedAt: string; complete: boolean; pages: number;
  /** 上次同步覆盖的配置深度（--pages）；调大 pages 会触发一次全量重扫。 */
  depth: number;
}
export interface CatalogDoc {
  version: number; updatedAt: string;
  entries: Record<string, CatalogEntry>;
  /** 每位老师的同步状态：complete 表示片单已翻到底，后续增量可从第一页之外提前收工。 */
  teachers: Record<string, TeacherSync>;
}

function parseDoc(raw: unknown): CatalogDoc {
  if (typeof raw !== 'object' || raw === null) throw new Error('作品目录结构异常');
  const doc = raw as Partial<CatalogDoc>;
  return {
    version: doc.version ?? 1,
    updatedAt: doc.updatedAt ?? '',
    entries: doc.entries && typeof doc.entries === 'object' ? doc.entries : {},
    teachers: doc.teachers && typeof doc.teachers === 'object' ? doc.teachers : {},
  };
}

export function emptyCatalog(): CatalogDoc {
  return { version: CATALOG_VERSION, updatedAt: '', entries: {}, teachers: {} };
}

export function readCatalog(path = catalogPath): Promise<CatalogDoc> {
  return readJsonDoc(path, parseDoc, emptyCatalog());
}

export function writeCatalog(doc: CatalogDoc, path = catalogPath): Promise<void> {
  return writeJsonAtomic(path, doc);
}

export function catalogEntries(doc: CatalogDoc): CatalogEntry[] {
  return Object.values(doc.entries);
}

/** 目录里标记为拼盘的番号集合：自动下载用它兜住标题规则漏判的多人合集。 */
export function multiNumbers(doc: CatalogDoc): Set<string> {
  const numbers = new Set<string>();
  for (const entry of Object.values(doc.entries)) if (entry.multi) numbers.add(entry.number.toUpperCase());
  return numbers;
}
