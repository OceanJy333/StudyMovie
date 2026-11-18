// input: parseArgs 结果；output: 校验后的 CLI 参数；pos: 命令参数校验。
export type Values = Record<string, string | boolean | undefined>;

export class UsageError extends Error {
  constructor(message: string) { super(message); this.name = 'UsageError'; }
}

export function text(values: Values, key: string): string | undefined {
  const value = values[key];
  return typeof value === 'string' ? value : undefined;
}

export function flag(values: Values, key: string): boolean {
  return values[key] === true;
}

/** 整数参数：有默认值、上下界，非法输入直接报中文错误。 */
export function integer(values: Values, key: string, options: { fallback: number; min: number; max: number; label?: string }): number {
  const raw = text(values, key);
  if (raw === undefined) return options.fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < options.min || value > options.max) {
    throw new UsageError(`${options.label ?? key} 需要 ${options.min} 到 ${options.max} 的整数`);
  }
  return value;
}

export function decimal(values: Values, key: string, options: { fallback?: number; min: number; label?: string }): number | undefined {
  const raw = text(values, key);
  if (raw === undefined) return options.fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < options.min) throw new UsageError(`${options.label ?? key} 需要 ≥${options.min} 的数值`);
  return value;
}

export function list(values: Values, key: string): string[] {
  const raw = text(values, key);
  return raw ? raw.split(',').map(item => item.trim()).filter(Boolean) : [];
}

export function oneOf<T extends string>(values: Values, key: string, allowed: readonly T[], fallback: T): T {
  const raw = text(values, key);
  if (raw === undefined) return fallback;
  if (!(allowed as readonly string[]).includes(raw)) throw new UsageError(`${key} 只能是 ${allowed.join(' / ')}`);
  return raw as T;
}

export function requiredArg(args: readonly string[], index: number, usage: string): string {
  const value = args[index];
  if (!value) throw new UsageError(usage);
  return value;
}

export function yearArg(values: Values): number | undefined {
  const raw = text(values, 'year');
  if (raw === undefined) return undefined;
  if (!/^\d{4}$/.test(raw)) throw new UsageError('year 需要四位年份');
  return Number(raw);
}
