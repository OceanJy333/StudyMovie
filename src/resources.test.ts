// input: resource fixtures; output: selection and hash checks; pos: domain regression tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { features, infoHash, rankResources, type Resource } from './resources.ts';

const row = (title: string, sizeGB: number): Resource => ({ title, sizeGB, magnet: '', detail: '', seeds: 0 });
test('杜比音效不作为杜比视界，补帧不进入画质优先候选', () => {
  assert.equal(features('1080p H264 DolbyD 5.1').dv, false);
  assert.equal(features('2160p.Dolby.Vision.HDR10').dv, true);
  const ranked = rankResources([
    row('2160p BluRay 82GB', 82), row('2160p REMUX DV', 74.9),
    row('2160p DV AI-Enhanced 60fps', 100), row('2160p WEB-DL DV', 90),
  ], { dv: true });
  assert.deepEqual(ranked.map(r => r.sizeGB), [74.9, 90]);
});
test('中字要求没有匹配时不自动放宽', () => {
  assert.deepEqual(rankResources([row('2160p REMUX DV', 74.9)], { chinese: true }), []);
});
test('hash 大小写和 base32 标准化，拒绝无效 magnet', () => {
  assert.equal(infoHash('magnet:?xt=urn:btih:56A917DBACB5B640C1D1CC54FCDB60F6FDDF729E'), '56a917dbacb5b640c1d1cc54fcdb60f6fddf729e');
  assert.equal(infoHash('magnet:?xt=urn:btih:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'), '0'.repeat(40));
  assert.throws(() => infoHash('https://example.com'));
});
test('综合选择更活跃的小型 DV，而非无种的大型 REMUX', () => {
  const large = { ...row('2160p REMUX DV 中文字幕', 75), seeds: 0 };
  const small = { ...row('2160p WEB-DL DV 中文字幕', 16), seeds: 30 };
  assert.equal(rankResources([large, small], { dv: true, chinese: true })[0], small);
  assert.deepEqual(rankResources([large, small], { maxSizeGB: 25 }), [small]);
  assert.deepEqual(rankResources([large, small], { maxSizeGB: 10 }), []);
  assert.throws(() => rankResources([small], { maxSizeGB: NaN }));
});
test('未知做种数不伪装成零，无种资源降低排名', () => {
  const unknown = { ...row('2160p WEB-DL DV', 16), seeds: null };
  const zero = { ...unknown, seeds: 0 };
  const active = { ...unknown, seeds: 8 };
  assert.deepEqual(rankResources([zero, unknown, active]), [active, unknown, zero]);
});
test('综合排序保留硬画质与字幕条件', () => {
  const valid = { ...row('2160p WEB-DL DV 中文字幕', 16), seeds: 1 };
  const invalid = { ...row('1080p WEB-DL DV 中文字幕', 5), seeds: 1000 };
  assert.deepEqual(rankResources([invalid, valid], { dv: true, chinese: true }), [valid]);
});
