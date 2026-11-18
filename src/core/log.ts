// input: 运行期提示；output: stderr 进度行；pos: 统一日志出口。
export type Note = (line: string) => void;

export const stderrNote: Note = line => process.stderr.write(`${line}\n`);

export function silently(): void {
  // 测试里吞掉进度输出。
}

/** 进度行格式固定成 `标签 当前/总数 描述`，日志好扫。 */
export function progress(note: Note, label: string, index: number, total: number, detail = ''): void {
  note(`${label} ${index + 1}/${total}${detail ? ` ${detail}` : ''}`);
}
