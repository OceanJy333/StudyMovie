// input: 剧集账本 JSON；output: 已提交/已看过的集数；pos: 剧集去重账本。
import { readJsonDoc, writeJsonAtomic } from "../core/json.js";
import { paths } from "../core/paths.js";
export const showsStatePath = paths.showsState;
function parseState(raw) {
    if (typeof raw !== 'object' || raw === null)
        throw new Error('剧集账本结构异常');
    const doc = raw;
    return {
        version: 1,
        lastCheck: typeof doc.lastCheck === 'string' ? doc.lastCheck : null,
        seen: doc.seen && typeof doc.seen === 'object' ? doc.seen : {},
    };
}
export function readShowsState(path = showsStatePath) {
    return readJsonDoc(path, parseState, { version: 1, lastCheck: null, seen: {} });
}
export function writeShowsState(state, path = showsStatePath) {
    return writeJsonAtomic(path, state, { pretty: true });
}
