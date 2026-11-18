// input: 真实文件名样本；output: 番号提取、演员判定和命名规则的回归测试；pos: 存档整理回归测试。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  flatName, flatPattern, learnPrefixes, legacyRename, numberCandidates, numberMatches, pickActress, rankCandidates, safeSegment, splitActresses,
} from './library/naming.ts';
import { junkEligible, needsRelabel } from './library/organize.ts';
import { MetaStore } from './library/meta.ts';

const best = (name: string, known: string[] = []) => rankCandidates(numberCandidates(name), new Set(known))[0]?.number;

test('番号提取覆盖真实文件名写法', () => {
  assert.equal(best('hhd800.com@MIDA184.mp4'), 'MIDA-184');
  assert.equal(best('mida-220ch.mp4'), 'MIDA-220');
  assert.equal(best('mird-245ch.mp4'), 'MIRD-245');
  assert.equal(best('SDHS-057.[4K]@R90s.mkv'), 'SDHS-057');
  assert.equal(best('169bbs.com@SDHS-057_[4K].mkv'), 'SDHS-057');
  assert.equal(best('18bt.net_CAWD-773C.mp4'), 'CAWD-773');
  assert.equal(best('448589_3xplanet_FSDSS-939.mp4'), 'FSDSS-939');
  assert.equal(best('dxxdom.com@START350.mp4'), 'START-350');
  assert.equal(best('dccdom.com@START290C.mp4'), 'START-290');
  assert.equal(best('4k2.com@rebd-944.mp4'), 'REBD-944');
  assert.equal(best('sone-446.mp4'), 'SONE-446');
  assert.equal(best('STARS-656-HD.mp4'), 'STARS-656');
  assert.equal(best('FNS-031.H265.mp4'), 'FNS-031');
  assert.equal(best('4k688.com@APAK-339.mp4'), 'APAK-339');
  assert.equal(best('FNS-046.H265.mp4'), 'FNS-046');
  assert.equal(best('5 EDEA-434 18岁新人“Mia”初体验.mp4'), 'EDEA-434');
  assert.equal(best('Ed Mosaic EDEA-341無預警！瑜珈老師', ['EDEA']), 'EDEA-341');
});

test('长字母串取尾部，站点前缀不会被当成番号', () => {
  // Ed MosaicEDEA-559 这种：字母串是 MOSAICEDEA，真番号前缀是尾部 EDEA。
  const ranked = rankCandidates(numberCandidates('Ed MosaicEDEA-559 22y短发可爱系哈密瓜.mp4'), new Set(['EDEA']));
  assert.equal(ranked[0].number, 'EDEA-559');
  // 同一处匹配里更长的前缀优先，但已知厂牌永远排最前。
  assert.ok(rankCandidates(numberCandidates('Ed MosaicEDEA-559 x.mp4'), new Set()).length > 1);
  // kss55.cc@SNOS-394：已知厂牌 SNOS 赢过站点前缀 KSS。
  assert.equal(best('kss55.cc@SNOS-394', ['SNOS', 'KSS']), 'SNOS-394');
  // 站点前缀排在前面、真番号在后面时，靠后的匹配赢。
  assert.equal(best('kfa55.com@FSDSS907.mp4', ['FSDSS']), 'FSDSS-907');
});

test('只有单一候选的文件名才用来扩充厂牌白名单', () => {
  const known = new Set<string>();
  assert.equal(learnPrefixes(['hhd800.com@FSDSS-917.mp4'], known), 0); // 两个候选，不学 HHD
  assert.equal(known.has('HHD'), false);
  const known2 = new Set<string>();
  assert.equal(learnPrefixes(['Ed Mosaic EDEA-341無預警！'], known2), 1);
  assert.equal(known2.has('EDEA'), true);
  assert.equal(numberMatches('fns-010.mp4').length, 1);
});

test('演员判定：多人共演全写上，主演或已知老师在前', () => {
  const known = new Set(['時田亜美', '涼宮遙香']);
  const names = (actresses: string[]) => actresses.map(name => ({ name }));
  assert.deepEqual(pickActress('', names(['天馬ゆい', '涼宮遙香']), known),
    { name: '涼宮遙香、天馬ゆい', names: ['涼宮遙香', '天馬ゆい'], how: 'known', learn: false });
  assert.deepEqual(pickActress('', names(['九野ひなの']), known), { name: '九野ひなの', names: ['九野ひなの'], how: 'solo', learn: true });
  assert.equal(pickActress('', names(['甲', '乙', '丙', '丁', '戊']), known).name, '甲、乙、丙、丁等');
  // 主演来自目录名或旧文件名；不在演员表里多半是别名写法，不配共演。
  assert.equal(pickActress('', names(['天馬ゆい', '時田亜美']), known, '時田亜美').name, '時田亜美、天馬ゆい');
  assert.equal(pickActress('', names(['七澤美亞', '天馬ゆい']), known, '七沢みあ').name, '七沢みあ');
  assert.equal(pickActress('生徒指導 時田亜美', [], known).name, '時田亜美');
  assert.equal(pickActress('無名の作品', [], known).name, '未知演员');
  assert.deepEqual(splitActresses('甲、乙、丙、丁等'), ['甲', '乙', '丙', '丁']);
});

test('垃圾判定不碰别人的半成品', () => {
  const active = new Set(['/home/me/Media/JAV/時田亜美']);
  const complete = new Set(['/home/me/Media/JAV/FNS-031']);
  // 43 GB 的 FCDSS-068.mp4.bt.xltd：没有任务、也没下完，绝不能当垃圾清掉。
  assert.equal(junkEligible('hhd800.com@FCDSS-068.mp4.bt.xltd', 43372744704, '/home/me/Media/JAV/五十嵐なつ', new Set(), new Set()), false);
  // 0 字节的 .xltd 只是失败残渣，可以清。
  assert.equal(junkEligible('ad-site.mp4.xltd', 0, '/home/me/Media/JAV/時田亜美/FNS-031', new Set(), complete), true);
  // 任务还在下载的目录整个不动。
  assert.equal(junkEligible('ad-site.mp4.xltd', 0, '/home/me/Media/JAV/時田亜美', active, new Set()), false);
  // 广告小片和种子文件照清。
  assert.equal(junkEligible('黃果短劇.mp4', 36_000_000, '/home/me/Media/JAV/kss55.cc@MIDA-807', new Set(), new Set()), true);
  assert.equal(junkEligible('ABC.torrent', 41305, '/home/me/Media/JAV/kss55.cc@MIDA-807', new Set(), new Set()), true);
});

test('命名和幂等判定', () => {  assert.equal(flatName('2025-04-24', 'FSDSS-990', '時田亜美', '.MP4'), '2025-04-24 FSDSS-990 時田亜美.mp4');
  assert.equal(flatName(null, 'EDEA-551', '未知演员', '.mp4'), 'EDEA-551 未知演员.mp4');
  assert.equal(flatName('2024-08-15', 'REBD-865', '時田亜美/坏字符', '.mp4'), '2024-08-15 REBD-865 時田亜美·坏字符.mp4');
  assert.ok(flatPattern.test('2025-04-24 FSDSS-990 時田亜美.mp4'));
  assert.ok(flatPattern.test('EDEA-551 未知演员.mp4'));
  assert.equal(flatPattern.test('hhd800.com@FSDSS-917.mp4'), false);
  assert.equal(flatPattern.test('sone-446.mp4'), false);
  assert.equal(flatPattern.test('FNS-010.H265.mp4.xltd'), false);
  assert.equal(safeSegment('a/b:c*d?e"f<g>h|i'), 'a·b·c·d·e·f·g·h·i');
});

test('老编号写法改回括号', () => {
  assert.equal(legacyRename('2026-10-11 SIVR-525 瀬戸環奈 1.mp4'), '2026-10-11 SIVR-525 瀬戸環奈 (1).mp4');
  assert.equal(legacyRename('2026-10-22 CARD-002 未知演员 2.mp4'), '2026-10-22 CARD-002 未知演员 (2).mp4');
  // 已经是括号写法、或名字里本来没有尾部数字的，不动。
  assert.equal(legacyRename('EDEA-559 未知演员 (2).mp4'), null);
  assert.equal(legacyRename('2025-06-03 MIDA-184 八木奈々.mp4'), null);
  // 四位数字不是序号（避免误伤年份之类的名字）。
  assert.equal(legacyRename('ABC-123 名前 2026.mp4'), null);
});

test('补认：已入库的规范文件每轮都按缓存重算名字', () => {
  assert.equal(needsRelabel('2026-11-18 MIDA-862 未知演员.mp4'), true);
  assert.equal(needsRelabel('2022-05-05 REBD-650 時田亜美.mp4'), true);
  assert.equal(needsRelabel('随便的下载名.mp4'), false);
});

test('元数据缓存：旧条目没有女演员表就重查，网页失败不写缓存', async () => {
  let pageCalls = 0, fail = true;
  const client = {
    async searchMovie(number: string) { return { id: 'Rkp0GR', release_date: '2026-11-18', title: number }; },
    async moviePage() { pageCalls++; if (fail) throw new Error('403'); return { title: 't', date: null, actresses: [{ id: 'g0W2Z', name: '九野ひなの' }] }; },
  };
  const store = await MetaStore.open('/nonexistent/cache.json', client, {
    'MIDA-862': { number: 'MIDA-862', id: 'Rkp0GR', date: '2026-11-18', title: 'old', at: '2026-11-18' },
  });
  assert.ok((await store.resolve('MIDA-862')).error);
  fail = false;
  assert.deepEqual((await store.resolve('MIDA-862')).actresses, [{ id: 'g0W2Z', name: '九野ひなの' }]);
  await store.resolve('MIDA-862');
  assert.equal(pageCalls, 2);
  const misses = await MetaStore.open('/nonexistent/cache.json', { ...client, async searchMovie() { return null; } }, {
    'SDDE-773': { number: 'SDDE-773', miss: true, actresses: [], at: '2026-01-01T00:00:00Z' },
  });
  assert.notEqual((await misses.resolve('SDDE-773')).at, '2026-01-01T00:00:00Z');
});
