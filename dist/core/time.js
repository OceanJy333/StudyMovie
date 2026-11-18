// input: 时间点；output: 发行日期窗口计算；pos: 日期口径写源。
const DAY_MS = 86_400_000;
export function isoDay(date) {
    return date.toISOString().slice(0, 10);
}
export function nowIso() {
    return new Date().toISOString();
}
/** `days` 天前的日期（YYYY-MM-DD），自动下载窗口的唯一定义。 */
export function windowCutoff(days, now = new Date()) {
    return isoDay(new Date(now.getTime() - days * DAY_MS));
}
export function daysAgoIso(days, now = Date.now()) {
    return new Date(now - days * DAY_MS).toISOString();
}
