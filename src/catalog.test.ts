// input: 假 JavDB 片单；output: 作品目录增量同步与拼盘/BD 标记；pos: 作品目录测试。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { syncCatalog } from './catalog/sync.ts';
import { readCatalog } from './catalog/store.ts';
import type { Actor, Catalog, Movie } from './javdb/types.ts';

function movie(index: number, title = `作品 ${index}`): Movie {
  return {
    id: `id-${index}`, number: `TEST-${String(index).padStart(3, '0')}`, title,
    release_date: `2025-01-${String((index % 28) + 1).padStart(2, '0')}`, magnets_count: index % 3,
  };
}

const teacherA = Array.from({ length: 45 }, (_, index) => movie(index + 1));
const teacherB = [movie(1), ...Array.from({ length: 9 }, (_, index) => movie(101 + index))];

const fake: Catalog = {
  async searchActors(name: string): Promise<Actor[]> {
    if (name === '甲') return [{ id: 'A', type: 0, name: '甲' }];
    if (name === '乙') return [{ id: 'B', type: 0, name: '乙' }];
    return [];
  },
  async actorMovies(_type: number, id: string, page: number): Promise<Movie[]> {
    const source = id === 'A' ? teacherA : id === 'B' ? teacherB : [];
    return source.slice((page - 1) * 10, page * 10);
  },
  async magnets() { return []; },
  async searchMovie() { return null; },
};

test('目录同步：首次翻满，之后从第 2 页起没有新番号就收工', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nas-catalog-'));
  const path = join(dir, 'catalog.json');
  try {
    const first = await syncCatalog({ names: ['甲', '乙'], pages: 5, catalog: fake, path, onNote: () => {} });
    assert.equal(first.total, 54);
    assert.equal(first.teachers, 2);
    assert.equal(first.pages, 6, '甲 5 页 + 乙 1 页（乙第 2 页为空，不计）');
    const afterFirst = await readCatalog(path);
    assert.equal(afterFirst.teachers['乙']?.complete, true, '空页说明片单翻到底');

    const second = await syncCatalog({ names: ['甲', '乙'], pages: 5, catalog: fake, path, onNote: () => {} });
    assert.equal(second.added, 0);
    assert.equal(second.pages, 2, '增量时每人只翻第 1 页就收工');
    assert.equal(second.total, 54, '已收录的旧作不能被删');

    // 乙这次只回第 1 页，共演片的另一个来源在甲的第 3 页；来源不能因此丢失。
    const partial: Catalog = { ...fake, async actorMovies(_type, id, page) {
      if (id === 'B') return page === 1 ? [movie(1)] : [];
      return teacherA.slice((page - 1) * 10, page * 10);
    } };
    await syncCatalog({ names: ['甲', '乙'], pages: 5, catalog: partial, path, onNote: () => {} });
    const doc = await readCatalog(path);
    assert.equal(doc.entries['TEST-001']?.multi, true);
    assert.ok((doc.entries['TEST-001']?.sources.length ?? 0) >= 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('目录标记：多人共演、合集标题、蓝光重发', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nas-catalog-'));
  const path = join(dir, 'catalog.json');
  const special: Catalog = {
    ...fake,
    async actorMovies(_type, id, page) {
      if (page > 1) return [];
      if (id === 'A') return [movie(1), movie(2, '8時間ベスト'), movie(3, '作品 3 ブルーレイ')];
      return [movie(1)];
    },
  };
  try {
    await syncCatalog({ names: ['甲', '乙'], pages: 2, catalog: special, path, onNote: () => {} });
    const doc = await readCatalog(path);
    assert.equal(doc.entries['TEST-001']?.sources.length, 2);
    assert.equal(doc.entries['TEST-001']?.multi, true);
    assert.equal(doc.entries['TEST-002']?.multi, true, '合集标题单人也要标拼盘');
    assert.equal(doc.entries['TEST-003']?.bd, true);
    assert.equal(doc.teachers['甲']?.complete, true, '只有一页且不足 8 条时算翻到底');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
