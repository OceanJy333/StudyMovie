// input: 片库文件名和 Range 头样本；output: 解析与分片规则的回归测试；pos: 影片墙回归测试。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildLibrary } from './library/scan.ts';
import { parseLibraryName } from './library/naming.ts';
import { esc } from './core/text.ts';
import { groupByActress, mergeWall, wallCounts } from './web/wall.ts';
import { parseRange } from './web/media.ts';
import { isBluRayEdition, looksLikeCompilation } from './javdb/classify.ts';

test('片库文件名解析出日期、番号和演员', () => {
  assert.deepEqual(parseLibraryName('2025-04-24 FSDSS-990 時田亜美.mp4'),
    { date: '2025-04-24', number: 'FSDSS-990', actress: '時田亜美' });
  assert.deepEqual(parseLibraryName('EDEA-551 未知演员.mp4'),
    { date: null, number: 'EDEA-551', actress: '未知演员' });
  // 同番号第二片带序号后缀，序号不进演员名。
  assert.deepEqual(parseLibraryName('EDEA-559 未知演员 (2).mp4'),
    { date: null, number: 'EDEA-559', actress: '未知演员' });
  assert.deepEqual(parseLibraryName('2024-11-05 XVSR-782 宮城りえ.mkv'),
    { date: '2024-11-05', number: 'XVSR-782', actress: '宮城りえ' });
  // 没整理过的名字（带站点前缀、没有演员）不认，交给 organize 处理。
  assert.equal(parseLibraryName('hhd800.com@FSDSS-917.mp4'), null);
  assert.equal(parseLibraryName('sone-446.mp4'), null);
  assert.equal(parseLibraryName('.整理记录-日本番号.json'), null);
});

test('Range 解析按 RFC 7233 单区间处理', () => {
  assert.equal(parseRange(undefined, 1000), null);
  assert.deepEqual(parseRange('bytes=0-99', 1000), { start: 0, end: 99 });
  assert.deepEqual(parseRange('bytes=500-', 1000), { start: 500, end: 999 });
  assert.deepEqual(parseRange('bytes=0-', 1000), { start: 0, end: 999 });
  // 后缀写法：最后 200 字节。
  assert.deepEqual(parseRange('bytes=-200', 1000), { start: 800, end: 999 });
  // 超出末尾要截断，不足一帧时按整段返回。
  assert.deepEqual(parseRange('bytes=900-5000', 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange('bytes=0-5000', 1000), { start: 0, end: 999 });
  // 起止倒置、起点越界、格式错误都回 416。
  assert.equal(parseRange('bytes=500-100', 1000), 'invalid');
  assert.equal(parseRange('bytes=1000-', 1000), 'invalid');
  assert.equal(parseRange('bytes=-', 1000), 'invalid');
  assert.equal(parseRange('items=0-10', 1000), 'invalid');
  assert.equal(parseRange('bytes=0-10,20-30', 1000), 'invalid');
  // 后缀比文件还长时从头开始，不能出现负偏移。
  assert.deepEqual(parseRange('bytes=-5000', 1000), { start: 0, end: 999 });
});

test('片库扫描只收整理过规范的视频，按发行日期倒序', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nas-movie-web-'));
  try {
    await writeFile(join(root, '2024-11-05 XVSR-782 宮城りえ.mp4'), Buffer.alloc(10));
    await writeFile(join(root, '2026-10-14 APAK-339 佐々倉ひより.mp4'), Buffer.alloc(20));
    await writeFile(join(root, 'EDEA-551 未知演员.mp4'), Buffer.alloc(30));
    await writeFile(join(root, 'hhd800.com@FSDSS-917.mp4'), Buffer.alloc(40));
    await writeFile(join(root, '2024-11-05 XVSR-782 宮城りえ.torrent'), Buffer.alloc(1));
    await mkdir(join(root, '某目录'));
    const cache = { 'XVSR-782': { number: 'XVSR-782', id: 'abc', title: '标题', at: '' } };
    const items = await buildLibrary(root, cache);
    assert.deepEqual(items.map(item => item.number), ['APAK-339', 'XVSR-782', 'EDEA-551']);
    assert.equal(items[1].title, '标题');
    assert.equal(items[1].cover, '/cover/XVSR-782.jpg');
    assert.equal(items[0].cover, null); // 缓存里没有就不给封面地址
    assert.equal(items[2].date, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('页面输出对文件名转义', () => {
  assert.equal(esc('<script>"x"&y\'</script>'), '&lt;script&gt;&quot;x&quot;&amp;y&#39;&lt;/script&gt;');
});

test('老编号写法不污染演员名', () => {
  // 整理脚本早期给同番号多片加序号时写成 `演员 2`，序号不能算进演员名。
  assert.equal(parseLibraryName('2026-10-11 SIVR-525 瀬戸環奈 3.mp4')?.actress, '瀬戸環奈');
  assert.equal(parseLibraryName('2026-10-22 CARD-002 未知演员 1.mp4')?.actress, '未知演员');
  // 括号写法一直是对的。
  assert.equal(parseLibraryName('EDEA-559 未知演员 (2).mp4')?.actress, '未知演员');
  assert.equal(parseLibraryName('2025-06-03 MIDA-184 八木奈々.mp4')?.actress, '八木奈々');
});

test('演员分组按作品数倒序，封片取最新一部有封面的', () => {
  const item = (file: string, actress: string, date: string | null, number: string, cover: string | null,
    downloaded = true, magnets = 1) =>
    ({ file, actress, date, number, cover, title: null, sizeBytes: 100, addedAt: '2026-10-01T00:00:00.000Z',
       downloaded, magnets, submitted: false, bd: false });
  const groups = groupByActress([
    item('a.mp4', '八木奈々', '2026-10-06', 'MIDA-807', '/cover/MIDA-807.jpg'),
    item('b.mp4', '八木奈々', '2025-06-03', 'MIDA-184', '/cover/MIDA-184.jpg'),
    item('c.mp4', '時田亜美', '2025-03-20', 'FSDSS-987', null),
    item('d.mp4', '時田亜美', '2025-01-23', 'FSDSS-939', '/cover/FSDSS-939.jpg'),
    item('e.mp4', '時田亜美', '2024-11-21', 'FSDSS-917', '/cover/FSDSS-917.jpg'),
  ]);
  assert.deepEqual(groups.map(g => [g.name, g.count, g.total]), [['時田亜美', 3, 3], ['八木奈々', 2, 2]]);
  // 最新那条没有封面时，往下找第一条有封面的；最新番号仍然记最新那条。
  assert.equal(groups[0].cover, '/cover/FSDSS-939.jpg');
  assert.equal(groups[0].latestNumber, 'FSDSS-939');
  assert.equal(groups[1].cover, '/cover/MIDA-807.jpg');
  assert.equal(groups[0].totalBytes, 300);
  // 共演作品算进每位演员名下。
  const shared = groupByActress([item('f.mp4', '涼宮遙香、天馬ゆい', '2026-09-10', 'STCV-604', null)]);
  assert.deepEqual(shared.map(g => g.name).sort(), ['天馬ゆい', '涼宮遙香'].sort());
});

test('作品目录并进墙：本地优先、按番号去重、缺的标成未下载', () => {
  const local = [{
    file: 'a.mp4', number: 'MIDA-807', date: '2026-10-06', actress: '八木奈々', title: '本地标题',
    cover: '/cover/MIDA-807.jpg', sizeBytes: 100, addedAt: '2026-10-10T00:00:00.000Z',
  }];
  const catalog = {
    'MIDA-807': { number: 'MIDA-807', date: '2026-10-06', title: '目录标题', actress: '八木奈々', movieId: 'x', magnets: 3, updatedAt: '', sources: ['八木奈々'], multi: false, bd: false },
    'FSDSS-999': { number: 'FSDSS-999', date: '2026-09-01', title: '没下的', actress: '時田亜美', movieId: 'y', magnets: 2, updatedAt: '', sources: ['時田亜美'], multi: false, bd: false },
    'FSDSS-998': { number: 'FSDSS-998', date: null, title: null, actress: '時田亜美', movieId: '', magnets: 0, updatedAt: '', sources: ['時田亜美'], multi: false, bd: false },
    'FCDSS-037': { number: 'FCDSS-037', date: '2022-09-08', title: '16位美少女8時間', actress: '時田亜美', movieId: 'z', magnets: 2, updatedAt: '', sources: ['時田亜美', '八木奈々'], multi: true, bd: false },
  };
  const wall = mergeWall(local, catalog, new Set(['FSDSS-999']));
  assert.equal(wall.length, 3, '已下载的不会被目录重复加进来');
  const byNum = Object.fromEntries(wall.map(item => [item.number, item]));
  assert.equal(byNum['MIDA-807'].downloaded, true);
  assert.equal(byNum['MIDA-807'].title, '本地标题');
  assert.equal(byNum['FSDSS-999'].downloaded, false);
  assert.equal(byNum['FSDSS-999'].submitted, true);
  assert.equal(byNum['FSDSS-999'].magnets, 2);
  assert.equal(byNum['FSDSS-998'].cover, null, '没有影片 id 就不给封面地址');
  assert.deepEqual(wall.map(item => item.number), ['MIDA-807', 'FSDSS-999', 'FSDSS-998'], '按发行日期倒序，缺日期排最后');
  assert.equal(wall.some(item => item.number === 'FCDSS-037'), false, '拼盘合集不上墙');
  assert.deepEqual(wallCounts(wall, 1), { total: 3, downloaded: 1, missing: 2, multi: 1, totalBytes: 100 });
});

test('拼盘识别：宁可漏不可错，单体作品不能被误杀', () => {
  const compilations = [
    '自FALENO出道的16位美少女們的初次登場8小時！！',
    'FALENOガール28人8時間ベスト',
    'FALENOガール14人8時間ベスト【完全版】',
    'FALENO4周年！16人の人気女優が魅せた2022年総集編16時間！',
    'FALENO娘のコスプレフルコース8時間ベスト！！',
    '時田亜美 FALENO専属デビューからの1年分12タイトル超ボリューム16時間ベスト',
    'FALENOガールズの水着グラビア8時間ベスト！',
    'FALENO娘×一般男性 お宅訪問ドキュメントベスト8時間！！',
    '旅行大好き4時間ベスト！',
    '飲み会後の帰り道ドキュメント2 4名収録',
    '美少女の笑顔ベスト',
    '【MOODYZ！ S1！ アイデアポケット！】美少女パラダイス 夢の大共演スペシャル！！',
  ];
  for (const title of compilations) assert.ok(looksLikeCompilation(title), title);

  // 这些都是单体作品，数字出现在「1人のスター」「2人きり」「21発」「24時間」「1位」里。
  const solos = [
    '押しに弱いエステティシャン',
    '解禁 女優A 10年に1人のスター 初めての主演 （BOD）',
    '天性のモテ女子 女優B が2人きり、丸2日間の相部屋お泊まり会！',
    '28発のクラッカー大騒ぎ！ノンストップ・ノーカットで30本の花火 女優C',
    '特濃21発 ノーカット2本番 女優D',
    '最強ヒロインと24時間ずっと一緒…全てアドリブ‘素’の女優E',
    '【FANZA限定】FANZA同人ランキング1位シリーズ累計10万部突破 実写版 パパ活セーブデータ',
    '隣人のゴミ部屋を55回掃除した記録',
  ];
  for (const title of solos) assert.equal(looksLikeCompilation(title), false, title);

  assert.ok(isBluRayEdition('Ami Dreaming travel time・時田亜美 ブルーレイエディション（ブルーレイディスク） チェキ'));
  assert.equal(isBluRayEdition('押しに弱いエステティシャン'), false);
});

