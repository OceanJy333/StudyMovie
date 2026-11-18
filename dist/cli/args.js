export class UsageError extends Error {
    constructor(message) { super(message); this.name = 'UsageError'; }
}
export function text(values, key) {
    const value = values[key];
    return typeof value === 'string' ? value : undefined;
}
export function flag(values, key) {
    return values[key] === true;
}
/** 整数参数：有默认值、上下界，非法输入直接报中文错误。 */
export function integer(values, key, options) {
    const raw = text(values, key);
    if (raw === undefined)
        return options.fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < options.min || value > options.max) {
        throw new UsageError(`${options.label ?? key} 需要 ${options.min} 到 ${options.max} 的整数`);
    }
    return value;
}
export function decimal(values, key, options) {
    const raw = text(values, key);
    if (raw === undefined)
        return options.fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < options.min)
        throw new UsageError(`${options.label ?? key} 需要 ≥${options.min} 的数值`);
    return value;
}
export function list(values, key) {
    const raw = text(values, key);
    return raw ? raw.split(',').map(item => item.trim()).filter(Boolean) : [];
}
export function oneOf(values, key, allowed, fallback) {
    const raw = text(values, key);
    if (raw === undefined)
        return fallback;
    if (!allowed.includes(raw))
        throw new UsageError(`${key} 只能是 ${allowed.join(' / ')}`);
    return raw;
}
export function requiredArg(args, index, usage) {
    const value = args[index];
    if (!value)
        throw new UsageError(usage);
    return value;
}
export function yearArg(values) {
    const raw = text(values, 'year');
    if (raw === undefined)
        return undefined;
    if (!/^\d{4}$/.test(raw))
        throw new UsageError('year 需要四位年份');
    return Number(raw);
}
