// input: bookmark and catalog fixtures; output: performer matching checks; pos: teacher subscription regression tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actorAliases, bestMagnet, chooseActor, javdbQuery, javdbSign, jdbCover, movieByNumber, usableMagnets } from './javdb/index.ts';
import { sourceFeed, resolveSubscription } from './teachers/sources.ts';
import { feedFor, mergeFeed, onlyDownloadable, orderFeed, planFeed } from './teachers/feed.ts';
import { latestFor } from './teachers/latest.ts';
import { dedupePool, magnetDue, mergeCandidates, performerPool, poolFrontier, selectBackfill, selectUpdates, subscriptionCandidates } from './teachers/pool.ts';
import { performerNames, pinRoster, readRoster } from './teachers/bookmarks.ts';
import { Javdb, numberPrefix } from './javdb/client.ts';
import { webActorIds, parseMoviePage } from './javdb/web.ts';
import { mentionsNumber, parseRss, pickReleases } from './sukebei.ts';
import { bestHash } from './javdb/magnet.ts';
import { HttpClient } from './core/http.ts';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { arrange, present } from './teachers/run.ts';
import type { PoolEntry } from './teachers/types.ts';
import type { Actor, Catalog, Movie, SubscriptionCatalog } from './javdb/types.ts';

const bookmarkDoc = { roots: { bookmark_bar: { type: 'folder', name: '收藏夹栏', children: [
  { type: 'folder', name: '33', children: [
    { type: 'url', name: '青空ひかり出演的AV在線看 - Jable.TV', url: 'https://jable.tv/models/hikari/' },
    { type: 'url', name: '松本いちか 出演的AV在線看 - Jable.TV', url: 'https://jable.tv/models/ichika/' },
    { type: 'url', name: '青空ひかり出演的AV在線看 - Jable.TV', url: 'https://jable.tv/models/hikari-2/' },
    { type: 'url', name: 'IPZZ-410 さくらわかな 櫻若菜 - Jable.TV', url: 'https://jable.tv/videos/ipzz-410/' },
    { type: 'url', name: '少女', url: 'https://jable.tv/tags/girl/' },
    { type: 'url', name: 'Tiny 出演的AV在線看 - Jable.TV', url: 'https://jable.tv/models/tiny/' },
  ] },
] } } };

test('签名、查询和书签只保留 Jable 演员页', () => {
  assert.equal(javdbSign(1700000000), '1700000000.lpw6vgqzsp.dacaffcd8b4e1b35c2752f065e906f3a');
  assert.equal(javdbQuery({ filter_by: '0:a:NPD3', page: 1 }), 'filter_by=0:a:NPD3&page=1');
  assert.deepEqual(performerNames(bookmarkDoc, '33'), ['青空ひかり', '松本いちか', 'Tiny']);
  assert.throws(() => performerNames({ roots: {} }), /找到 0 个/);
});

test('磁力只按 40 位 hash 校验，标题和磁力名不再过滤；别名优先于同名的空演员', () => {
  assert.equal(usableMagnets([{ name: '幼女', hash: 'a'.repeat(40) }]).length, 1);
  assert.equal(usableMagnets([{ name: '赤ちゃん', hash: 'b'.repeat(40) }]).length, 1);
  assert.equal(usableMagnets([{ name: '女子校生', hash: 'd'.repeat(40) }]).length, 1);
  assert.equal(usableMagnets([{ name: '普通', hash: 'c'.repeat(39) }]).length, 0);
  assert.equal(usableMagnets([{ name: '普通', hash: null }]).length, 0);
  const duplicate: Actor[] = [
    { id: 'nezE6', type: 1, name: '松本いちか' },
    { id: 'AOqm', type: 0, name: '松本一香', other_name: 'いちか,いちかちゃん' },
  ];
  assert.equal(chooseActor('松本いちか', duplicate)?.id, 'AOqm');
  assert.equal(chooseActor('松本いちか', [duplicate[0]]), null);
  assert.equal(chooseActor('青空ひかり', [{ id: 'b5Z0', type: 0, name: '青空光', videos_count: 126 }])?.id, 'b5Z0');
  assert.equal(chooseActor('青空ひかり', [{ id: 'a', type: 0, name: '甲' }, { id: 'b', type: 0, name: '乙' }]), null);
  assert.equal(chooseActor('同名', [
    { id: 'stub', type: 0, name: '同名', videos_count: 1 },
    { id: 'main', type: 0, name: '同名', videos_count: 20 },
  ])?.id, 'main');
  assert.equal(chooseActor('同名', [
    { id: 'a', type: 0, name: '同名', videos_count: 4 },
    { id: 'b', type: 0, name: '同名', videos_count: 4 },
  ]), null);
  assert.equal(chooseActor('青空ひかり', [{ id: 'hit', type: 0, name: '青空ひかり' }])?.id, 'hit');
  assert.deepEqual(actorAliases({ id: 'Xa1G', name: '白桃花', other_name: 'はな,ももか' }), ['白桃花', 'はな', 'ももか']);
});

test('磁力优先更小的非高清，番号精确匹配，输出不带 hash', () => {
  const sd = 'a'.repeat(40), hd = 'b'.repeat(40), bad = 'c'.repeat(39), sample = 'e'.repeat(40), small = 'd'.repeat(40);
  const picked = bestMagnet(usableMagnets([
    { name: 'hd-large', hash: hd, size: 5300, hd: true },
    { name: 'sd-small', hash: small, size: 900, hd: false },
    { name: 'short', hash: bad, hd: true },
    { name: 'sd', hash: sd, size: 1200, hd: false },
    { name: 'sample', hash: sample, size: 80, hd: false },
  ]));
  assert.equal(picked?.hash, small);
  assert.equal(picked?.size, 900);
  assert.equal(bestMagnet([{ hash: hd, size: 5300, hd: true }, { hash: 'f'.repeat(40), size: 3000, hd: true }])?.size, 3000);
  assert.equal(movieByNumber([{ id: 'new', number: 'WSA-002' }, { id: 'debut', number: 'WSA-001' }], 'WSA-001')?.id, 'debut');
  const shown = present({ bookmark: 'Tiny', official: 'Tiny', date: '2025-04-05', number: 'WSA-001', title: 't', magnets: 1, hd: true, cnsub: false, status: 'ok', hash: sd });
  assert.equal(JSON.stringify(shown).includes(sd), false);
  assert.equal(arrange([{ bookmark: 'b', status: 'none', date: null }, { bookmark: 'a', status: 'ok', date: '2026-01-01' }])[0].bookmark, 'a');
});

test('没磁力表和非法 hash 都会继续找到下一部，题材标题不再跳过', async () => {
  const calls: string[] = [], probes: string[] = [];
  const movies: Record<string, Movie[]> = { AOqm: [
    { id: 'new', number: 'NEW-1', title: '少女', origin_title: '幼女', magnets_count: 3, release_date: '2026-11-01' },
    { id: 'empty', number: 'NEW-2', title: '普通', magnets_count: 0, release_date: '2026-10-15' },
    { id: 'bad-hash', number: 'NEW-3', title: '普通', magnets_count: 2, release_date: '2026-10-08' },
    { id: 'ok', number: 'MIDA-794', title: '校服', magnets_count: 4, release_date: '2026-10-07' },
  ] };
  const catalog: Catalog = {
    async searchActors(name) {
      calls.push(name);
      if (name === '松本いちか') return [{ id: 'nezE6', type: 1, name: '松本いちか' }];
      return [{ id: 'AOqm', type: 0, name: '松本一香' }];
    },
    async actorMovies(_type, id, page) { return page === 1 ? movies[id] : []; },
    async magnets(number) {
      const id = Object.values(movies).flat().find(movie => movie.number === number)?.id ?? number;
      probes.push(id);
      if (id === 'bad-hash') return [{ name: '赤ちゃん', hash: 'e'.repeat(39), hd: true, size: 5 }];
      if (id === 'ok') return [{ name: 'release', hash: 'f'.repeat(40), hd: false, size: 2 }];
      return [];
    },
    async searchMovie() { throw new Error('不应按演员名去搜番号'); },
  };
  const row = await latestFor('松本いちか', catalog, 2);
  assert.equal(row.number, 'MIDA-794');
  assert.equal(row.official, '松本一香');
  // 内置固定身份直接用 id，不再按名字搜（搜索接口要登录）。
  assert.deepEqual(calls, []);
  assert.deepEqual(probes, ['new', 'bad-hash', 'ok']);
  const tinyCalls: string[] = [];
  const tiny = await latestFor('Tiny', {
    async searchActors() { tinyCalls.push('actor'); return [{ id: 'ZZMX', type: 2, name: 'Tina Tiny' }]; },
    async actorMovies() { return []; },
    async magnets() { return [{ name: 'debut', hash: '1'.repeat(40), hd: true, size: 1 }]; },
    async searchMovie(number) { tinyCalls.push(number); return { id: 'e844Gr', number, title: 'debut', release_date: '2025-04-05', magnets_count: 10 }; },
  });
  assert.deepEqual(tinyCalls, ['WSA-001']);
  assert.equal(tiny.number, 'WSA-001');
  assert.equal(tiny.date, '2025-04-05');
});

test('feed 汇总最新作品：封面、番号链接按发布日期倒序', async () => {
  const catalog: Catalog = {
    async searchActors() { return [{ id: 'AOqm', type: 0, name: '松本一香' }]; },
    async actorMovies() { return [
      { id: 'bQ9M4', number: 'MIDA-800', title: '旧', release_date: '2026-10-01', magnets_count: 2, cover_url: 'https://tp.spfcas.com/tok/covers/bq/bQ9M4.jpg', thumb_url: 'https://tp.spfcas.com/tok/small_covers/bq/bQ9M4.jpg', duration: 120 },
      { id: 'aQ9M4', number: 'MIDA-801', title: '新', release_date: '2026-10-02', magnets_count: 0, duration: 150 },
      { id: 'x', number: 'MIDA-799', title: '幼女', release_date: '2026-09-30', magnets_count: 1, cover_url: 'https://cdn/c.jpg' },
    ]; },
    async magnets() { return []; },
    async searchMovie() { throw new Error('不应按演员名去搜番号'); },
  };
  const items = await feedFor('松本いちか', catalog, 3);
  assert.deepEqual(items.map(item => item.number), ['MIDA-801', 'MIDA-800', 'MIDA-799']);
  // 静态封面主机不带会话路径 token；id 太短时退回接口给的原始封面地址
  assert.equal(items[0].cover, 'https://c0.jdbstatic.com/covers/aq/aQ9M4.jpg');
  assert.equal(items[1].cover, 'https://c0.jdbstatic.com/covers/bq/bQ9M4.jpg');
  assert.equal(items[2].cover, 'https://cdn/c.jpg');
  assert.equal(jdbCover('2m8VMX'), 'https://c0.jdbstatic.com/covers/2m/2m8VMX.jpg');
  assert.equal(jdbCover('x'), null);
  assert.equal(items[0].jable, 'https://jable.tv/videos/mida-801/');
  assert.equal(items[0].magnets, 0);
  assert.equal(items[0].date, '2026-10-02');
  assert.equal(items[0].bookmark, '松本いちか');
  assert.equal(items[0].official, '松本一香');
  assert.equal(items[0].duration, 150);
  assert.equal((await feedFor('松本いちか', catalog, 1)).length, 1);
  const tied = orderFeed([
    { ...items[1], bookmark: '乙', date: '2026-10-02' },
    { ...items[1], bookmark: '甲', date: '2026-10-02' },
  ]);
  assert.deepEqual(tied.map(item => item.bookmark), ['甲', '乙']);
});

test('仅可下载过滤用列表快照里的磁力数', () => {
  const make = (number: string, magnets: number | null) => ({
    date: '2026-10-02', bookmark: '甲', official: '甲', number, title: null,
    cover: null, magnets, duration: null, id: 'aQ9M4', jable: null,
  });
  assert.deepEqual(onlyDownloadable([make('A-1', 3), make('A-2', 0), make('A-3', null)]).map(item => item.number), ['A-1']);
  assert.deepEqual(onlyDownloadable([make('A-4', 1)]).length, 1);
});

const subscriptionStub = (overrides: Partial<SubscriptionCatalog> = {}): SubscriptionCatalog => ({
  async searchActors() { return []; },
  async actorMovies() { return []; },
  async magnets() { return []; },
  async searchMovie() { return null; },
  async byFilter() { return []; },
  ...overrides,
});

test('订阅 APGH 走番号前缀过滤 0:c:，只留前缀命中的番号', async () => {
  const calls: string[] = [];
  const catalog = subscriptionStub({
    async byFilter(filter, page) {
      calls.push(`filter:${filter}:${page}`);
      return [
        { id: 'aQ9M4', number: 'APGH-060', release_date: '2026-10-13', magnets_count: 2, duration: 120 },
        { id: 'bQ9M4', number: 'APGH-059', release_date: '2026-09-08', magnets_count: 3 },
        // 过滤串失效时 JavDB 退回全站最新，前缀不符的必须丢掉。
        { id: 'zQ9M4', number: 'SDJS-303', release_date: '2025-04-10', magnets_count: 9 },
        { id: 'yQ9M4', number: 'APGHX-001', release_date: '2026-10-20', magnets_count: 9 },
      ];
    },
  });
  const source = resolveSubscription('APGH');
  assert.deepEqual(source, { label: 'APGH', kind: 'prefix', id: 'APGH', name: null });
  const rows = await sourceFeed(source, catalog, 2);
  assert.deepEqual(rows.map(row => row.number), ['APGH-060', 'APGH-059']);
  assert.equal(rows[0].bookmark, '系列·APGH');
  assert.equal(rows[0].cover, 'https://c0.jdbstatic.com/covers/aq/aQ9M4.jpg');
  assert.equal(rows[0].jable, 'https://jable.tv/videos/apgh-060/');
  assert.equal(rows[0].magnets, 2);
  assert.deepEqual(calls, ['filter:0:c:APGH:1']);
  assert.deepEqual(resolveSubscription('aprg'), { label: 'aprg', kind: 'prefix', id: 'APRG', name: null });
});

test('厂牌订阅用固化的厂牌 id 过滤，不按名字搜；演员行优先', async () => {
  const calls: string[] = [];
  const catalog = subscriptionStub({
    async byFilter(filter, page) {
      calls.push(`filter:${filter}:${page}`);
      return [{ id: 'qAGOMD', number: 'APKH-200', release_date: '2026-10-27', magnets_count: 0 }];
    },
  });
  const source = resolveSubscription('AP');
  assert.deepEqual(source, { label: 'AP', kind: 'maker', id: 'bwA', name: 'Aurora Project Annex' });
  const makerRows = await sourceFeed(source, catalog, 1);
  assert.equal(makerRows[0].bookmark, '厂牌·AP');
  assert.deepEqual(calls, ['filter:0:m:bwA:1']);
  const merged = mergeFeed([[{ ...makerRows[0], bookmark: '白羽舞菜' }], makerRows]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].bookmark, '白羽舞菜');
  assert.deepEqual((await sourceFeed(resolveSubscription('APGH'), subscriptionStub(), 3)), []);
});

test('限流时订阅行先占位，演员行补满且不超上限', () => {
  const teacher = (n: number, date: string) => ({
    date, bookmark: '甲', official: '甲', number: `A-${n}`, title: null,
    cover: null, magnets: 1, duration: null, id: `t${n}`, jable: null,
  });
  const teachers = Array.from({ length: 40 }, (_, i) => teacher(i, `2026-10-${String(31 - (i % 28)).padStart(2, '0')}`));
  const subs = [
    { date: '2026-10-13', bookmark: '系列·APGH', official: null, number: 'APGH-060', title: null, cover: null, magnets: 2, duration: null, id: 's1', jable: null },
    { date: '2026-08-11', bookmark: '系列·APGH', official: null, number: 'APGH-058', title: null, cover: null, magnets: 3, duration: null, id: 's2', jable: null },
    { date: '2026-10-27', bookmark: '厂牌·AP', official: 'Aurora Project Annex', number: 'APAK-340', title: null, cover: null, magnets: 0, duration: null, id: 's3', jable: null },
  ];
  const planned = planFeed(teachers, subs, 30);
  assert.equal(planned.length, 30);
  assert.deepEqual(planned.filter(row => row.number.startsWith('AP') || row.number.startsWith('APAK')).map(row => row.number).sort(), ['APAK-340', 'APGH-058', 'APGH-060']);
  assert.equal(planFeed(teachers, subs, 30, true).some(row => row.number === 'APAK-340'), false);
  assert.equal(planFeed([], subs, 2).length, 2);
  const dupe = planFeed([{ ...subs[0], bookmark: '白羽舞菜', id: 's1' }], [subs[0]], 5);
  assert.equal(dupe.length, 1);
  assert.equal(dupe[0].bookmark, '白羽舞菜');
});

test('候选去重按番号和 hash，演员在前；订阅候选逐条验磁力', async () => {
  const catalog = subscriptionStub({
    async byFilter() {
      return [
        { id: 'aQ9M4', number: 'APGH-060', release_date: '2026-10-13', magnets_count: 2 },
        { id: 'bQ9M4', number: 'APGH-059', release_date: '2026-09-08', magnets_count: 0 },
      ];
    },
    async magnets(number) {
      return number === 'APGH-060' ? [{ hash: 'A'.repeat(39) + 'b', size: 500, hd: false }] : [];
    },
  });
  const { candidates, notes } = await subscriptionCandidates(['APGH'], catalog as never, 5, );
  assert.deepEqual(candidates.map(row => row.number), ['APGH-060']);
  assert.equal(candidates[0].hash, 'a'.repeat(39) + 'b');
  assert.equal(candidates[0].source, '系列·APGH');
  assert.ok(notes[0].includes('最新 2 部里 1 部有可用磁力'));
  const merged = await mergeCandidates([
    [candidates[0]],
    [{ ...candidates[0], number: 'APGH-061', hash: 'd'.repeat(40) }],
    [{ ...candidates[0], hash: 'c'.repeat(40) }],
  ]);
  assert.deepEqual(merged.map(row => row.number), ['APGH-060', 'APGH-061']);
  assert.equal(merged[0].hash, 'a'.repeat(39) + 'b');
});

test('补片池按发行日期倒序，同番号只留先出现的人', () => {
  const row = (number: string, date: string, source: string): PoolEntry => ({ id: number, number, date, title: null, source });
  assert.deepEqual(poolFrontier([row('A-1', '2026-12-01', '甲')], 2), { enough: false, cutoff: null });
  assert.equal(poolFrontier([row('A-1', '2026-12-02', '甲'), row('A-2', '2026-12-01', '乙')], 2).cutoff, '2026-12-01');
  const merged = dedupePool([[row('A-1', '2026-11-01', '甲')], [row('a-1', '2026-11-01', '乙'), row('B-1', '2026-12-01', '乙')]]);
  assert.deepEqual(merged.map(item => `${item.number}:${item.source}`), ['B-1:乙', 'A-1:甲']);
});

test('所有人合成一个池后，手里已经早于第 N 名的人不再翻页', async () => {
  const pages: string[] = [];
  const movie = (id: string, number: string, date: string) => ({ id, number, release_date: date, magnets_count: 1 });
  const catalog: Catalog = {
    async searchActors(name) { return [{ id: name, type: 0, name }]; },
    async actorMovies(_type, id, page) {
      pages.push(`${id}:${page}`);
      if (id === '甲' && page === 1) return Array.from({ length: 8 }, (_, i) => movie(`a${i}`, `A-${i}`, `2026-12-${String(8 - i).padStart(2, '0')}`));
      if (id === '甲' && page === 2) return [movie('a8', 'A-8', '2026-11-30')];
      if (id === '乙' && page === 1) return Array.from({ length: 8 }, (_, i) => movie(`b${i}`, `B-${i}`, `2026-11-${String(8 - i).padStart(2, '0')}`));
      return [];
    },
    async magnets() { return []; },
    async searchMovie() { return null; },
  };
  const { entries, failed } = await performerPool(['甲', '乙'], catalog, 10);
  assert.deepEqual(failed, []);
  assert.ok(pages.includes('甲:2'));
  assert.equal(pages.includes('乙:2'), false);
  assert.equal(entries[0].number, 'A-0');
  assert.ok(entries.findIndex(item => item.number === 'A-8') < entries.findIndex(item => item.number === 'B-0'));
});

test('补片名额算已入库，坏磁力不占名额', async () => {
  const entries: PoolEntry[] = [
    { id: '1', number: 'NEW-1', date: '2026-12-01', title: null, source: '甲' },
    { id: '2', number: 'held-1', date: '2026-11-01', title: null, source: '乙' },
    { id: '3', number: 'BAD-1', date: '2026-10-01', title: null, source: '丙' },
    { id: '4', number: 'NEW-2', date: '2026-09-01', title: null, source: '丁' },
  ];
  const catalog = subscriptionStub({
    async magnets(number) {
      return number === 'BAD-1' ? [{ hash: 'nope' }] : [{ hash: 'a'.repeat(40), size: 800, hd: false }];
    },
  });
  const picked = await selectBackfill(entries, catalog, new Set(['HELD-1']), 3);
  assert.equal(picked.held, 1);
  assert.equal(picked.skipped, 1);
  assert.deepEqual(picked.download.map(item => item.number), ['NEW-1', 'NEW-2']);
  const flaky = subscriptionStub({
    async magnets(number) {
      if (number === 'NEW-1') throw new Error('sukebei 请求失败');
      return [{ hash: 'b'.repeat(40), size: 800, hd: false }];
    },
  });
  const retried = await selectBackfill(entries, flaky, new Set(), 1);
  assert.equal(retried.skipped, 1);
  assert.deepEqual(retried.download.map(item => item.number), ['held-1']);
});

test('增量下载同一个人的多部新作，窗口外和已记录的不查磁力', async () => {
  const entries: PoolEntry[] = [
    { id: '1', number: 'NEW-1', date: '2026-10-20', title: null, source: '甲' },
    { id: '2', number: 'NEW-2', date: '2026-10-20', title: null, source: '甲' },
    { id: '3', number: 'SEEN-1', date: '2026-10-18', title: null, source: '乙' },
    { id: '4', number: 'OLD-1', date: '2026-08-01', title: null, source: '丙' },
  ];
  const calls: string[] = [];
  const catalog = subscriptionStub({
    async magnets(number) {
      calls.push(number);
      return [{ hash: 'a'.repeat(40), size: 800, hd: false }];
    },
  });
  const picked = await selectUpdates(entries, catalog, new Set(['SEEN-1']), '2026-09-15', 10, '2026-10-21');
  assert.deepEqual(picked.download.map(item => item.number), ['NEW-1', 'NEW-2']);
  assert.equal(picked.seen, 1);
  assert.equal(picked.overflow, 0);
  assert.deepEqual(calls, ['NEW-1', 'NEW-2']);
  assert.deepEqual(picked.errors, []);
  calls.length = 0;
  const capped = await selectUpdates(entries, catalog, new Set(['SEEN-1']), '2026-09-15', 1, '2026-10-21');
  assert.deepEqual(capped.download.map(item => item.number), ['NEW-1']);
  assert.equal(capped.overflow, 1);
  assert.deepEqual(calls, ['NEW-1']);
  // 磁力源出错算故障（让任务失败），不当成「还没有种子」。
  const broken = await selectUpdates(entries, subscriptionStub({ async magnets() { throw new Error('sukebei 超时'); } }), new Set(), '2026-09-15', 10, '2026-10-21');
  assert.deepEqual(broken.errors, ['NEW-1', 'NEW-2', 'SEEN-1']);
  assert.equal(broken.skipped, 0);
});

test('磁力查询日程：发行前一天开始，两周内每天，之后每周一次', () => {
  assert.equal(magnetDue('2026-12-15', '2026-11-18'), false);
  assert.equal(magnetDue('2026-11-19', '2026-11-18'), true);
  assert.equal(magnetDue('2026-11-04', '2026-11-18'), true);
  assert.equal(magnetDue('2026-11-03', '2026-11-18'), false);
  assert.equal(magnetDue('2026-10-28', '2026-11-18'), true);
  assert.equal(magnetDue(null, '2026-11-18'), true);
});

test('增量翻页停在窗口起点，更早的人不再翻', async () => {
  const pages: string[] = [];
  const movie = (id: string, number: string, date: string) => ({ id, number, release_date: date, magnets_count: 1 });
  const catalog: Catalog = {
    async searchActors(name) { return [{ id: name, type: 0, name }]; },
    async actorMovies(_type, id, page) {
      pages.push(`${id}:${page}`);
      if (id === '甲' && page === 1) return Array.from({ length: 8 }, (_, i) => movie(`a${i}`, `A-${i}`, `2026-12-${String(8 - i).padStart(2, '0')}`));
      if (id === '甲' && page === 2) return [movie('a8', 'A-8', '2026-11-30')];
      if (id === '乙' && page === 1) return Array.from({ length: 8 }, (_, i) => movie(`b${i}`, `B-${i}`, `2026-11-${String(8 - i).padStart(2, '0')}`));
      return [];
    },
    async magnets() { return []; },
    async searchMovie() { return null; },
  };
  const { entries } = await performerPool(['甲', '乙'], catalog, 1, '2026-12-01');
  assert.ok(pages.includes('甲:2'));
  assert.equal(pages.includes('乙:2'), false);
  assert.ok(entries.some(item => item.number === 'A-8'));
  assert.equal(entries[0].number, 'A-0');
});

test('名册固化的 id 直接用，不按名字搜；没 id 又搜不到的算失败', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nas-roster-'));
  try {
    const path = join(dir, 'performers.json');
    await writeFile(path, JSON.stringify({ names: ['固定甲', '新人乙', 'Tiny'], actors: { 固定甲: { id: 'PIN1', name: '固定甲' } } }));
    assert.deepEqual(await readRoster(path), ['固定甲', '新人乙', 'Tiny']);
    const searched: string[] = [];
    const pages: string[] = [];
    const catalog: Catalog = {
      async searchActors(name) { searched.push(name); throw new Error('JavDB 接口拒绝 /api/v2/search：JWTVerificationError'); },
      async actorMovies(_type, id, page) { pages.push(`${id}:${page}`); return [{ id: 'm1', number: 'PIN-001', release_date: '2026-11-12', magnets_count: 1 }]; },
      async magnets() { return []; },
      async searchMovie() { return null; },
    };
    const { entries, failed } = await performerPool(['固定甲', '新人乙'], catalog, 1, '2026-10-14');
    assert.deepEqual(entries.map(entry => entry.number), ['PIN-001']);
    assert.deepEqual(failed, ['新人乙']);
    assert.deepEqual(searched, ['新人乙']);
    assert.ok(pages.includes('PIN1:1'));
    const pinnedRoster = await pinRoster(['固定甲', '新人乙', 'Tiny'], catalog);
    assert.deepEqual(pinnedRoster, { actors: { 固定甲: { id: 'PIN1', name: '固定甲' } }, unresolved: ['新人乙'] });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('JavDB 返回 success:0（要登录）时抛错，不当成空结果', async () => {
  const replies: Record<string, unknown> = {
    tags: { success: 1, data: { movies: [{ id: 'a', number: 'WSA-002' }, { id: 'b', number: 'WSA-001' }] } },
    denied: { success: 0, action: 'JWTVerificationError', message: '請登錄帳號', data: null },
  };
  const urls: string[] = [];
  const http = { async json(url: string) { urls.push(url); return url.includes('/actors/') ? replies.denied : replies.tags; } } as unknown as HttpClient;
  const asked: string[] = [];
  const client = new Javdb(http, { async magnets(number) { asked.push(number); return []; } });
  await assert.rejects(client.actor('x'), /JWTVerificationError/);
  await client.magnets('WSA-001');
  assert.deepEqual(asked, ['WSA-001']);
  assert.ok(!urls.some(url => url.includes('/magnets')));
  assert.equal((await client.searchMovie('wsa-001'))?.id, 'b');
  assert.ok(urls.some(url => url.includes('filter_by=0:c:WSA')));
  assert.equal(numberPrefix('FC2-PPV-1234'), 'FC2-PPV');
  assert.deepEqual(webActorIds('<a href="/actors/censored">有碼</a><a href="/actors/QV0p9" title="石川澪"><a href="/actors/QV0p9" title="石川澪">'), ['QV0p9']);
});

test('JavDB 影片页：只取 actor-female，非影片页抛错', () => {
  const html = `<strong class="current-title">究極の… 九野ひなの </strong><strong>日期:</strong>&nbsp;<span class="value">2026-11-18</span>
    <a class="actor-female" href="/actors/g0W2Z">九野ひなの</a>, <a href="/actors/9gAX">鮫島</a>, <a class="actor-female" href="/actors/g0W2Z">九野ひなの</a>
    <a href="magnet:?xt=urn:btih:8A4E4F05CF90BB784CA2479C649F41E955B60BBE&amp;dn=x" title="t">
      <span class="name">MIDA-862.torrent</span><div class="tags"><span class="tag">高清</span></div><span class="meta">6.08GB, 5個文件</span></a>`;
  assert.deepEqual(parseMoviePage(html), {
    title: '究極の… 九野ひなの', date: '2026-11-18', actresses: [{ id: 'g0W2Z', name: '九野ひなの' }],
    magnets: [{ name: 'MIDA-862.torrent', hash: '8a4e4f05cf90bb784ca2479c649f41e955b60bbe', size: 6226, hd: true, cnsub: false }],
  });
  assert.throws(() => parseMoviePage('<html>Just a moment...</html>'));
});

test('磁力双来源：JavDB 网页有就用，没有或失败再问 sukebei', async () => {
  const asked: string[] = [];
  const hash = 'a'.repeat(40);
  const page = (magnets: { hash: string }[]) => ({ title: '', date: null, actresses: [], magnets });
  let web: () => Promise<ReturnType<typeof page>> = async () => page([{ hash }]);
  const client = new Javdb(undefined, { async magnets(number) { asked.push(number); return [{ hash: 'b'.repeat(40) }]; } },
    { async actorIds() { return []; }, movie: () => web() });
  assert.equal((await client.magnets('MIDA-1', 'id1'))[0]?.hash, hash);
  web = async () => page([]);
  assert.equal((await client.magnets('MIDA-2', 'id2'))[0]?.hash, 'b'.repeat(40));
  web = async () => { throw new Error('429'); };
  await client.magnets('MIDA-3', 'id3');
  await client.magnets('MIDA-4');
  assert.deepEqual(asked, ['MIDA-2', 'MIDA-3', 'MIDA-4']);
});

test('番号查片：按番号差跳页，不必从头翻', async () => {
  const pages: number[] = [];
  const all = Array.from({ length: 900 }, (_, i) => ({ id: `id${900 - i}`, number: `MIDA-${900 - i}` }));
  const http = { async json(url: string) {
    const page = Number(new URL(url).searchParams.get('page'));
    pages.push(page);
    return { success: 1, data: { movies: all.slice((page - 1) * 10, page * 10) } };
  } } as unknown as HttpClient;
  const client = new Javdb(http, { async magnets() { return []; } }, { async actorIds() { return []; }, async movie() { throw new Error('不该取影片页'); } });
  assert.equal((await client.searchMovie('MIDA-764'))?.id, 'id764');
  assert.ok(pages.length <= 3, `翻了 ${pages.length} 页`);
  assert.equal(await client.searchMovie('MIDA-9999'), null);
});

test('sukebei：只认完整番号，有人做种优先，有原版不选 AI 去码版', () => {
  const xml = `<rss><channel>
    <item><title>MIDA-857 甘えていいですか 七沢みあ</title><nyaa:seeders>6</nyaa:seeders><nyaa:infoHash>E205329AA5A7A8AF202D542BD61D803195B6B007</nyaa:infoHash><nyaa:size>4.0 GiB</nyaa:size></item>
    <item><title>[Reducing Mosaic] MIDA-857 甘えて</title><nyaa:seeders>21</nyaa:seeders><nyaa:infoHash>${'d'.repeat(40)}</nyaa:infoHash><nyaa:size>1.2 GiB</nyaa:size></item>
    <item><title>[H265 1080p] MIDA857 中文</title><nyaa:seeders>1</nyaa:seeders><nyaa:infoHash>${'b'.repeat(40)}</nyaa:infoHash><nyaa:size>1.5 GiB</nyaa:size></item>
    <item><title>MIDA-8570 别的片</title><nyaa:seeders>50</nyaa:seeders><nyaa:infoHash>${'c'.repeat(40)}</nyaa:infoHash><nyaa:size>900 MiB</nyaa:size></item>
    <item><title>MIDA-857 没人做种</title><nyaa:seeders>0</nyaa:seeders><nyaa:infoHash>${'f'.repeat(40)}</nyaa:infoHash><nyaa:size>500 MiB</nyaa:size></item>
  </channel></rss>`;
  const items = parseRss(xml);
  assert.equal(items[0].hash, 'e205329aa5a7a8af202d542bd61d803195b6b007');
  assert.equal(items[0].size, 4096);
  assert.equal(items[2].hd, true);
  const picked = pickReleases(items, 'MIDA-857');
  assert.deepEqual(picked.map(item => item.hash![0]), ['e', 'b']);
  // 非高清优先：4 GiB 原版胜过 1080p 版。
  assert.equal(bestHash(picked), 'e205329aa5a7a8af202d542bd61d803195b6b007');
  assert.equal(mentionsNumber('[FHD] wsa-001 debut', 'WSA-001'), true);
  assert.equal(mentionsNumber('XMIDA-857', 'MIDA-857'), false);
  assert.equal(mentionsNumber('FC2-PPV-1234567 hello', 'FC2-PPV-1234567'), true);
});
