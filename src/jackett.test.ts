// input: indexer responses; output: matching and normalization checks; pos: Jackett tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesMovie, parseResults } from './jackett.ts';

test('片名按完整词匹配，年份排除续集和错误版本', () => {
  assert.ok(matchesMovie('The.Dark.Knight.2008.2160p', 'The Dark Knight', 2008));
  assert.ok(!matchesMovie('The.Dark.Knight.Rises.2012.2160p', 'The Dark Knight', 2008));
  assert.ok(!matchesMovie('Tenetish.2020.2160p', 'Tenet', 2020));
});

test('hash 去重、丢弃无效磁力，保留做种数更高的结果', () => {
  const row = { Title: 'The.Dark.Knight.2008.2160p', InfoHash: 'a'.repeat(40), Size: 1024 ** 3, Seeders: 2 };
  const results = parseResults({ Indexers: [{ Status: 2 }], Results: [row, { ...row, Seeders: 5 },
    { ...row, InfoHash: 'bad' }] }, 'The Dark Knight', 2008);
  assert.equal(results.length, 1);
  assert.equal(results[0].seeds, 5);
  assert.equal(results[0].sizeGB, 1);
});

test('来源失败不能当成成功的空搜索或不完整候选', () => {
  assert.throws(() => parseResults({ Indexers: [{ Status: 0, Error: 'timeout' }], Results: [] }, 'Tenet'));
  assert.throws(() => parseResults({ Indexers: [], Results: [] }, 'Tenet'));
});
test('人数缺失和非法值保留未知，不当作零', () => {
  const row = { Title: 'Tenet.2020.2160p', InfoHash: 'b'.repeat(40), Size: 1024 ** 3, Seeders: -1, Peers: null };
  const [result] = parseResults({ Indexers: [{ Status: 2 }], Results: [row] }, 'Tenet', 2020);
  assert.equal(result.seeds, null);
  assert.equal(result.peers, null);
});
