// input: small HTML fixtures; output: parser checks; pos: site adapter regression tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMovies, parseResources, chooseMovie } from './gying.ts';
test('嵌套搜索高亮仍能识别片名和年份，重复封面链接不重复', () => {
  const rows = parseMovies('<a href="/mv/ym24"><img></a><a href="/mv/ym24"><b>信</b>条 Tenet (2020)</a><a href="/mv/xx">信条 (2000)</a>', 'https://example.com');
  assert.equal(rows.length, 2);
  assert.equal(chooseMovie(rows, '信条', 2020).id, 'ym24');
  assert.throws(() => chooseMovie(rows, '信条'));
});
test('按表格列读取大小和做种数，未知做种数不等于零', () => {
  const rows = parseResources('<table><tr><td><a href="magnet:?xt=urn:btih:abc">2160p REMUX DV</a><a href="/bt/123">详情</a></td><td>磁力 · 种子</td><td>74.9GB</td><td>--</td><td>1年前</td></tr></table>', 'https://example.com');
  assert.equal(rows[0].sizeGB, 74.9);
  assert.equal(rows[0].seeds, null);
});
