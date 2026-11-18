// input: 临时文件与并发任务；output: 基础设施行为；pos: core 回归测试。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readJsonDoc, readJsonFile, writeJsonAtomic } from './core/json.ts';
import { mapLimit, Semaphore, sleep } from './core/async.ts';
import { windowCutoff } from './core/time.ts';
import { parseEnvFile } from './core/paths.ts';

test('JSON：缺文件用默认值，坏文件明确报错，原子写不留临时文件', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nas-core-'));
  try {
    assert.deepEqual(await readJsonFile(join(dir, 'missing.json'), { ok: true }), { ok: true });
    const corrupt = join(dir, 'corrupt.json');
    await writeFile(corrupt, '{oops');
    await assert.rejects(readJsonFile(corrupt, {}), /不是合法 JSON/);
    await assert.rejects(readJsonDoc(corrupt, raw => raw as object, {}), /不是合法 JSON/);

    const target = join(dir, 'state.json');
    await writeJsonAtomic(target, { a: 1 }, { pretty: true });
    assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), { a: 1 });
    assert.deepEqual(await readdir(dir), ['corrupt.json', 'state.json']);

    // 并发写同一个账本：最后一定是完整的某一份，不会出现半个 JSON。
    await Promise.all(Array.from({ length: 20 }, (_, index) => writeJsonAtomic(target, { index })));
    const final = JSON.parse(await readFile(target, 'utf8')) as { index: number };
    assert.equal(typeof final.index, 'number');
    assert.deepEqual(await readdir(dir), ['corrupt.json', 'state.json'], '没有 .tmp 残留');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('并发：mapLimit 保序且不超上限，Semaphore 串行到宽度', async () => {
  let active = 0, peak = 0;
  const rows = await mapLimit([5, 1, 4, 2, 3], 2, async value => {
    active++;
    peak = Math.max(peak, active);
    await sleep(5);
    active--;
    return value * 2;
  });
  assert.deepEqual(rows, [10, 2, 8, 4, 6]);
  assert.equal(peak, 2);

  const gate = new Semaphore(2);
  let running = 0, maxRunning = 0;
  await Promise.all(Array.from({ length: 6 }, () => gate.run(async () => {
    running++;
    maxRunning = Math.max(maxRunning, running);
    await sleep(3);
    running--;
  })));
  assert.equal(maxRunning, 2);
});

test('窗口起点按自然日计算', () => {
  assert.equal(windowCutoff(30, new Date('2026-10-17T20:00:00+08:00')), '2026-09-17');
  assert.equal(windowCutoff(0, new Date('2026-10-17T20:00:00+08:00')), '2026-10-17');
});

test('个人设置文件：KEY=VALUE，值可带引号，注释和空行忽略', () => {
  assert.deepEqual(parseEnvFile('# 注释\nNAS_SSH=nas\n\nNAS_MOVIE_BOOKMARKS_FILE="C:/Users/me/Edge User Data/Bookmarks"\nbad line\n'),
    { NAS_SSH: 'nas', NAS_MOVIE_BOOKMARKS_FILE: 'C:/Users/me/Edge User Data/Bookmarks' });
});
