// input: 作品目录 JSON；output: 目录读写；pos: 片库墙「全部作品」的数据层。
import { readJsonDoc, writeJsonAtomic } from "../core/json.js";
import { paths } from "../core/paths.js";
export const catalogPath = paths.catalog;
export const CATALOG_VERSION = 2;
function parseDoc(raw) {
    if (typeof raw !== 'object' || raw === null)
        throw new Error('作品目录结构异常');
    const doc = raw;
    return {
        version: doc.version ?? 1,
        updatedAt: doc.updatedAt ?? '',
        entries: doc.entries && typeof doc.entries === 'object' ? doc.entries : {},
        teachers: doc.teachers && typeof doc.teachers === 'object' ? doc.teachers : {},
    };
}
export function emptyCatalog() {
    return { version: CATALOG_VERSION, updatedAt: '', entries: {}, teachers: {} };
}
export function readCatalog(path = catalogPath) {
    return readJsonDoc(path, parseDoc, emptyCatalog());
}
export function writeCatalog(doc, path = catalogPath) {
    return writeJsonAtomic(path, doc);
}
export function catalogEntries(doc) {
    return Object.values(doc.entries);
}
/** 目录里标记为拼盘的番号集合：自动下载用它兜住标题规则漏判的多人合集。 */
export function multiNumbers(doc) {
    const numbers = new Set();
    for (const entry of Object.values(doc.entries))
        if (entry.multi)
            numbers.add(entry.number.toUpperCase());
    return numbers;
}
