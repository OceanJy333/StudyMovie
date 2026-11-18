// input: 剧集标题/目录样本；output: 集数解析、候选选择与归档的回归测试；pos: 剧集订阅测试。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cleanShowName, episodeKey, matchesShow, parseEpisode, parseSeason } from './shows/parse.ts';
import { buildGroups, hasChineseSubtitle, qualityScore } from './shows/search.ts';
import { organizeShows, scanShows } from './shows/library.ts';
import { checkShows } from './shows/run.ts';
import type { ShowSubscription } from './shows/types.ts';
import type { JackettResult } from './jackett.ts';
import type { Config } from './config.ts';

const sub = (over: Partial<ShowSubscription> = {}): ShowSubscription => ({
  name: '幕府将军', query: 'Shogun', aliases: ['Shogun', '幕府将军'], kind: 'tv',
  season: 1, totalEpisodes: null, subtitle: 'any', year: 2024,
  enabled: true, minSizeMB: 80, maxSizeMB: 30_000, ...over,
});

const result = (title: string, over: Partial<JackettResult> = {}): JackettResult => ({
  title, magnet: `magnet:?xt=urn:btih:${(over.hash ?? 'a'.repeat(40))}`, hash: 'a'.repeat(40),
  sizeBytes: 1024 ** 3, seeds: 10, peers: 2, categories: [5000], publishDate: null, details: '', ...over,
});

test('集数解析覆盖 S01E03 / 1x03 / 第3集 / 动画独立集数', () => {
  assert.deepEqual(parseEpisode('Shogun.S01E03.1080p.WEB-DL'), { season: 1, episode: 3, range: null, pack: false });
  assert.deepEqual(parseEpisode('Shogun.1x04.HDTV'), { season: 1, episode: 4, range: null, pack: false });
  assert.deepEqual(parseEpisode('某剧 第03集'), { season: null, episode: 3, range: null, pack: false });
  assert.deepEqual(parseEpisode('第2季 第05话'), { season: 2, episode: 5, range: null, pack: false });
  assert.deepEqual(parseEpisode('[Lilith-Raws] Show - 07 [1080p]'), { season: null, episode: 7, range: null, pack: false });
  assert.deepEqual(parseEpisode('[Group][Show][12][1080p]'), { season: null, episode: 12, range: null, pack: false });
});

test('合集解析出集数区间，画质数字不会被当成集数', () => {
  assert.deepEqual(parseEpisode('Shogun.S01E01-E12.1080p'), { season: 1, episode: null, range: [1, 12], pack: true });
  assert.deepEqual(parseEpisode('[Group] Show [01-12][1080p]'), { season: null, episode: null, range: [1, 12], pack: true });
  assert.equal(parseEpisode('Shogun.2024.2160p.WEB-DL.x264').episode, null);
  assert.equal(parseEpisode('Shogun.1080p.x265.10bit').episode, null);
  assert.equal(parseEpisode('Shogun.2024.COMPLETE.1080p').episode, null);
  assert.equal(parseSeason('Shogun.S02.1080p'), 2);
});

test('剧名清洗和别名匹配', () => {
  assert.equal(cleanShowName('Shogun.2024.S01E03.1080p.WEB-DL.x264-GROUP'), 'Shogun');
  assert.equal(cleanShowName('[Lilith-Raws] One Piece - 1080 [Baha][WEB-DL][1080p][AVC AAC][CHT][MP4]'), 'One Piece');
  assert.equal(matchesShow('Shogun.2024.S01E03.1080p', ['幕府将军', 'Shogun']), true);
  assert.equal(matchesShow('The Bear S01E01', ['Shogun']), false);
  assert.equal(matchesShow('【喵萌奶茶屋】★10月新番★[葬送的芙莉莲][03][1080p]', ['葬送的芙莉莲']), true);
});

test('每集选最优种子，同 hash 的多集合成一个分组', () => {
  const groups = buildGroups(sub(), [
    result('Shogun.S01E01.720p.WEB-DL', { hash: 'b'.repeat(40), seeds: 60, sizeBytes: 500 * 1024 ** 2 }),
    result('Shogun.S01E01.1080p.WEB-DL', { hash: 'a'.repeat(40), seeds: 10, sizeBytes: 2 * 1024 ** 3 }),
    result('Shogun.S01E01-E03.1080p.WEB-DL', { hash: 'c'.repeat(40), seeds: 8, sizeBytes: 6 * 1024 ** 3 }),
    result('Other.Show.S01E01.1080p', { hash: 'd'.repeat(40) }),
    result('Shogun.S02E01.1080p', { hash: 'e'.repeat(40) }),
    result('Shogun.S01E04.1080p.CAM', { hash: 'f'.repeat(40), seeds: 99 }),
  ]);
  const byHash = new Map(groups.map(group => [group.hash.slice(0, 1), group]));
  assert.equal(byHash.get('a')?.episodes.join(','), '1');
  assert.equal(byHash.get('c')?.episodes.join(','), '2,3');
  assert.equal(byHash.get('d'), undefined);
  assert.equal(byHash.get('e'), undefined, '季号不匹配的候选要排除');
  assert.equal(byHash.get('f'), undefined, '枪版不应入选');
  assert.equal(qualityScore('Show.1080p.WEB-DL'), 38);
});

test('整理：移进 剧名/Season NN，字幕跟着走，重复不覆盖', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nas-shows-'));
  const root = join(dir, '剧集');
  const incoming = join(root, 'Shogun.S01E03.1080p.WEB-DL');
  await mkdir(incoming, { recursive: true });
  await writeFile(join(incoming, 'Shogun.S01E03.1080p.WEB-DL.mkv'), 'video');
  await writeFile(join(incoming, 'Shogun.S01E03.1080p.WEB-DL.srt'), 'subtitle');
  await writeFile(join(incoming, 'sample.mkv'), 'tiny');
  await mkdir(join(root, 'Other', 'Season 01'), { recursive: true });
  await writeFile(join(root, 'Other', 'Season 01', 'Other - S01E01.mkv'), 'kept');
  try {
    const plan = await organizeShows({ root, subscriptions: [sub()], apply: false, minEpisodeMB: 0, settleMinutes: 0 });
    assert.equal(plan.moved, 1, 'sample 这种小文件不能当成一集');
    const target = plan.items.find(item => item.source.includes('Shogun.S01E03.1080p.WEB-DL.mkv'))?.target;
    assert.equal(target, join(root, '幕府将军', 'Season 01', '幕府将军 - S01E03.mkv'));

    const applied = await organizeShows({ root, subscriptions: [sub()], apply: true, minEpisodeMB: 0, settleMinutes: 0 });
    assert.equal(applied.moved, 1);
    assert.equal(await readFile(target!, 'utf8'), 'video');
    assert.equal(await readFile(join(root, '幕府将军', 'Season 01', '幕府将军 - S01E03.srt'), 'utf8'), 'subtitle');
    assert.equal(await readFile(join(incoming, 'sample.mkv'), 'utf8'), 'tiny', '样片保留不删');
    assert.equal(await readFile(join(root, 'Other', 'Season 01', 'Other - S01E01.mkv'), 'utf8'), 'kept');

    const library = await scanShows(root, [sub()]);
    const show = library.find(item => item.name === '幕府将军');
    assert.equal(show?.episodes.length, 1);
    assert.equal(show?.episodes[0]?.episode, 3);
    assert.equal(show?.subscribed, true);
    assert.equal(show?.episodes[0]?.file, join('幕府将军', 'Season 01', '幕府将军 - S01E03.mkv'));

    // 第二遍：已经在规范位置的文件不再动，也不重复。
    const again = await organizeShows({ root, subscriptions: [sub()], apply: true, minEpisodeMB: 0, settleMinutes: 0 });
    assert.equal(again.moved, 0);
    assert.equal(episodeKey('幕府将军', 1, 3), '幕府将军|S1E3');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('中文字幕标记：巴哈 CHT、简日内嵌算，生肉不算', () => {
  assert.equal(hasChineseSubtitle('[绿茶字幕组] 学生会也有洞！ [01][简日内嵌]'), true);
  assert.equal(hasChineseSubtitle('[ANi] 學生會也有洞！ - 02 [Baha][WEB-DL][CHT][MP4]'), true);
  assert.equal(hasChineseSubtitle('[SubsPlease] Seitokai ni mo Ana wa Aru - 01 (1080p)'), false);
  const zhOnly = buildGroups(sub({ subtitle: 'zh', aliases: ['Seitokai ni mo Ana wa Aru'] }), [
    result('[SubsPlease] Seitokai ni mo Ana wa Aru - 01 (1080p)', { hash: 'a'.repeat(40), seeds: 999 }),
    result('[ANi] Seitokai ni mo Ana wa Aru - 01 [Baha][WEB-DL][CHT]', { hash: 'b'.repeat(40), seeds: 5 }),
  ]);
  assert.deepEqual(zhOnly.map(group => group.hash.slice(0, 1)), ['b'], '有中字版本时不能选生肉');
});

test('总集数封顶：只下到第 N 集，之后的候选不提交', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nas-shows-'));
  const config: Config = {
    ssh: { host: 'localhost', port: 22, user: 'me' },
    thunder: { baseUrl: 'http://127.0.0.1:5050/', headers: {}, space: '5', downloadDir: dir },
    gying: { baseUrl: 'http://127.0.0.1/' },
  };
  try {
    const show = sub({ totalEpisodes: 2, subtitle: 'any', season: null, aliases: ['Seitokai ni mo Ana wa Aru'] });
    const rows = [1, 2, 3].map(episode => result(
      `[ANi] Seitokai ni mo Ana wa Aru - 0${episode} [Baha][CHT]`,
      { hash: String(episode).repeat(40), seeds: 10 + episode },
    ));
    const checked = await checkShows({
      config, shows: { version: 1, root: dir, subscriptions: [show] },
      statePath: join(dir, 'state.json'), apply: false, limit: 10,
      search: async () => rows,
    });
    assert.deepEqual(checked.results.flatMap(row => row.episodes), [1, 2]);
    assert.equal(checked.counts.submitted, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
