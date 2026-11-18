// input: candidate and state fixtures; output: automation window checks; pos: daily automation tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freshCandidates, heldNumbers, readRoster, readState, writeState, tokenExpiry } from './auto.ts';
import type { Candidate } from './teachers/types.ts';
import type { Config } from './config.ts';

const candidate = (number: string, date: string): Candidate => ({ number, hash: 'a'.repeat(40), date, source: '甲', title: null });

test('自动下载只挑窗口内且没记录过的作品，窗口外的旧作单独记账', () => {
  const now = new Date('2026-11-20T10:00:00Z');
  const state = { seen: { 'OLD-1': { hash: 'b'.repeat(40), date: '2026-01-01', source: '甲', at: '2026-01-02T00:00:00Z', action: 'created' } } };
  const { fresh, old, seen, cutoff } = freshCandidates([
    candidate('NEW-1', '2026-11-18'), candidate('OLD-1', '2026-01-01'),
    candidate('OLD-2', '2026-01-05'), candidate('NEW-2', '2026-10-25'),
  ], state, 30, now);
  assert.equal(cutoff, '2026-10-21');
  assert.deepEqual(fresh.map(item => item.number), ['NEW-1', 'NEW-2']);
  assert.deepEqual(old.map(item => item.number), ['OLD-2']);
  assert.deepEqual(seen.map(item => item.number), ['OLD-1']);
  assert.deepEqual(freshCandidates([candidate('X-1', 'nope')], { seen: {} }, 30, now).fresh.length, 1);
});

test('skip-old 不算已入库，真正提交过的番号才占补片名额', () => {
  const entry = { hash: 'b'.repeat(40), date: '2026-01-01', source: '甲', at: '2026-01-02T00:00:00Z', action: 'created' };
  const state = { seen: { 'A-1': entry, 'B-1': { ...entry, action: 'skip-old' }, 'C-1': { ...entry, action: 'existing' } } };
  assert.deepEqual([...heldNumbers(state)].sort(), ['A-1', 'C-1']);
});

test('状态文件原子读写、缺省为空；名册接受快照和数组', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nas-auto-'));
  try {
    const stateFile = join(dir, 'nested', 'auto.json');
    assert.deepEqual(await readState(stateFile), { seen: {} });
    await writeState({ seen: { 'A-1': { hash: 'c'.repeat(40), date: null, source: '甲', at: '2026-11-20T00:00:00Z', action: 'created' } } }, stateFile);
    assert.deepEqual(Object.keys((await readState(stateFile)).seen), ['A-1']);
    const roster = join(dir, 'names.json');
    await writeFile(roster, JSON.stringify({ folder: '33', names: ['甲', '乙'] }));
    assert.deepEqual(await readRoster(roster), ['甲', '乙']);
    await writeFile(roster, JSON.stringify(['丙']));
    assert.deepEqual(await readRoster(roster), ['丙']);
    await writeFile(roster, JSON.stringify({ names: [1] }));
    await assert.rejects(() => readRoster(roster), /名册文件结构异常/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('token 到期时间从 pan-auth 解出，坏 token 返回 null', () => {
  const base = { ssh: { host: 'localhost', port: 22, user: 'me' }, thunder: { baseUrl: 'http://127.0.0.1:5050/', headers: {}, space: 'x', downloadDir: '/home/me/Movie/' }, gying: { baseUrl: 'https://x/' } } as unknown as Config;
  const payload = Buffer.from(JSON.stringify({ exp: 1791999999 })).toString('base64url');
  const withToken = { ...base, thunder: { ...base.thunder, headers: { 'pan-auth': `a.${payload}.c` } } } as Config;
  assert.equal(tokenExpiry(withToken)?.toISOString(), '2026-10-14T17:46:39.000Z');
  assert.equal(tokenExpiry(base), null);
  const broken = { ...base, thunder: { ...base.thunder, headers: { 'pan-auth': 'not-a-jwt' } } } as Config;
  assert.equal(tokenExpiry(broken), null);
});
