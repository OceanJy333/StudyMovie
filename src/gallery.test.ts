// input: feed fixtures; output: cover gallery assertions; pos: feed rendering tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderGallery } from './gallery.ts';
import type { FeedItem } from './teachers/types.ts';

const row: FeedItem = {
  date: '2026-10-02', bookmark: '松本いちか', official: '松本一香', number: 'MIDA-801',
  title: '<b>新</b> & 生写真', cover: 'https://cdn/a.jpg',
  magnets: 3, duration: 150, id: 'a', jable: 'https://jable.tv/videos/mida-801/',
};

test('封面画廊转义标题，输出封面、番号链接和磁力数', () => {
  const html = renderGallery([row], { generatedAt: '2026-10-11T00:00:00.000Z' });
  assert.ok(html.includes('src="https://cdn/a.jpg"'));
  assert.ok(html.includes('&lt;b&gt;新&lt;/b&gt; &amp; 生写真'));
  assert.equal(html.includes('<b>新</b>'), false);
  assert.ok(html.includes('https://jable.tv/videos/mida-801/'));
  assert.ok(html.includes('3 个磁力'));
  assert.ok(html.includes('150 分钟'));
  assert.ok(html.includes('10-02'));
  const none = renderGallery([{ ...row, magnets: 0, cover: null, duration: null }], { generatedAt: '2026-10-11T00:00:00.000Z' });
  assert.ok(none.includes('无磁力'));
  assert.ok(none.includes('无封面'));
  assert.equal(none.includes('过滤'), false);
  const same = renderGallery([{ ...row, official: '松本いちか' }], { generatedAt: '2026-10-11T00:00:00.000Z' });
  assert.equal(same.split('松本いちか').length - 1, 1);
  assert.ok(renderGallery([], { generatedAt: '2026-10-11T00:00:00.000Z' }).includes('0 部'));
});
