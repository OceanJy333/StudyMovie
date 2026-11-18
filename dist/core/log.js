export const stderrNote = line => process.stderr.write(`${line}\n`);
export function silently() {
    // 测试里吞掉进度输出。
}
/** 进度行格式固定成 `标签 当前/总数 描述`，日志好扫。 */
export function progress(note, label, index, total, detail = '') {
    note(`${label} ${index + 1}/${total}${detail ? ` ${detail}` : ''}`);
}
