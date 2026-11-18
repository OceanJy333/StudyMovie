// input: JSON 文件路径；output: 校验后的对象 / 原子写入；pos: 状态账本读写。
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 读 JSON；文件不存在返回 fallback。解析失败直接抛错，避免静默丢账本。 */
export async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw error;
  }
  try {
    return JSON.parse(text.replace(/^\uFEFF/, '')) as T;
  } catch {
    throw new Error(`${path} 不是合法 JSON；请修复或移走它再运行`);
  }
}

/** 读出后用调用方的守卫校验；结构不对就抛错，不把脏数据带进业务。 */
export async function readJsonDoc<T>(path: string, parse: (raw: unknown) => T, fallback: T): Promise<T> {
  const raw = await readJsonFile<unknown>(path, undefined);
  return raw === undefined ? fallback : parse(raw);
}

let sequence = 0;
/**
 * 先写临时文件再 rename：断电或并发读都不会看到半个 JSON。
 * 临时名带 pid + 序号，web 服务和定时任务同时写也不会互相覆盖。
 */
export async function writeJsonAtomic(path: string, value: unknown, options: { pretty?: boolean; mode?: number } = {}) {
  const { pretty = false, mode = 0o600 } = options;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.${sequence++}.tmp`;
  try {
    await writeFile(tmp, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`, { mode });
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}
