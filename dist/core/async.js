// input: 任务数组与并发上限；output: 有界并发执行；pos: 全项目并发控制。
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
/** 固定 worker 数的 map；结果顺序与输入一致，单个失败由调用方自行 catch。 */
export async function mapLimit(items, limit, run) {
    if (!items.length)
        return [];
    const width = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
    const out = new Array(items.length);
    let cursor = 0;
    const worker = async () => {
        for (;;) {
            const index = cursor++;
            if (index >= items.length)
                return;
            out[index] = await run(items[index], index);
        }
    };
    await Promise.all(Array.from({ length: width }, () => worker()));
    return out;
}
/** 简单的信号量：网络请求和封面抓取用它压住并发，避免被对端限流。 */
export class Semaphore {
    active = 0;
    waiting = [];
    width;
    constructor(width) { this.width = width; }
    async run(job) {
        if (this.active >= this.width)
            await new Promise(resolve => this.waiting.push(resolve));
        this.active++;
        try {
            return await job();
        }
        finally {
            this.active--;
            this.waiting.shift()?.();
        }
    }
}
