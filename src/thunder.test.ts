// input: torrent metadata; output: verified create contract; pos: Thunder payload regression tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planFolder, selectedFiles, taskBody, wholeTorrentBody } from './thunder.ts';
import type { Config } from './config.ts';
const config = { thunder: { space: 'device_id#test' } } as Config;
test('单文件使用 -1 索引，目录种子只选正片和字幕', () => {
  const single = { id: 'r.0', name: 'movie.mkv', file_size: 80427337499, file_count: 1 };
  assert.equal(taskBody(single, 'magnet', config, 'folder', '/Movie/').params.sub_file_index, '--1,');
  const root = { ...single, name: 'Movie', is_dir: true, file_count: 3, dir: { resources: [
    { ...single, id: 'r.0.0', name: 'ad.mp4', file_size: 2048 },
    { ...single, id: 'r.0.1' }, { ...single, id: 'r.0.2', name: 'zh.srt', file_size: 20480 },
  ] } };
  const body = taskBody(root, 'magnet', config, 'folder', '/Movie/');
  assert.equal(body.params.sub_file_index, '1,2');
  assert.equal(body.file_size, String(single.file_size + 20480));
  assert.equal(body.params.total_file_count, '3');
});
test('未完整解析的目录不猜测文件索引', () => {
  assert.throws(() => selectedFiles({ id: 'r', name: 'Movie', file_size: 100, file_count: 2, is_dir: true, dir: { resources: [] } }));
});
test('完整嵌套目录使用文件索引并排除 Sample；缺少嵌套索引时拒绝', () => {
  const leaf = { id: 'r.0.5.7', file_index: 7, name: 'film.mkv', file_size: 80_000_000, file_count: 1 };
  const dir = { id: 'r.0.5', name: 'Film', file_size: leaf.file_size, file_count: 1, is_dir: true, dir: { resources: [leaf] } };
  const root = { id: 'r.0', name: 'Movie', file_size: 160_000_000, file_count: 2, is_dir: true,
    dir: { resources: [dir, { ...dir, name: 'Sample', id: 'r.0.8', dir: { resources: [{ ...leaf, id: 'r.0.8.8', file_index: 8 }] } }] } };
  assert.deepEqual(selectedFiles(root), [{ index: '7', name: 'Film/film.mkv', size: 80_000_000 }]);
  assert.throws(() => selectedFiles({ ...root, file_count: 1, dir: { resources: [{ ...dir, dir: { resources: [{ ...leaf, file_index: undefined }] } }] } }));
});
test('子目录挂在已注册父目录下，屏蔽的目录不可用', () => {
  const paths = [{ Id: 'movie', RealPath: '/home/me/Movie/' }, { Id: 'home', RealPath: '/home/me/' }];
  assert.deepEqual(planFolder(paths, '/home/me/Media/JAV'), { kind: 'child', parentId: 'home', path: '/home/me/Media/JAV/', segments: ['Media', 'JAV'] });
  assert.equal(planFolder(paths, '/home/me/Movie').id, 'movie');
  assert.throws(() => planFolder(paths, '/home/me/Private', ['Private']), /不可用/);
  assert.throws(() => planFolder(paths, '/tmp/elsewhere'), /已有目录/);
});

test('多文件种子列不全时整包提交，不少下', () => {
  const config = { thunder: { space: 'space', headers: {}, downloadDir: '/x' } } as any;
  const root = { id: 'root', name: 'REBDB-636', file_size: 1246258197, file_count: 5, is_dir: true,
    dir: { resources: [
      { id: 'root.0', name: 'REBDB-636_youiv4K.mp4', file_size: 1246249058, file_count: 1, file_index: 0 },
      { id: 'root.2', name: 'youiv导航.html', file_size: 8988, file_count: 1, file_index: 2 },
      { id: 'root.3', name: 'readme.txt', file_size: 100, file_count: 1, file_index: 3 },
    ] } };
  // 只列出 3/5 个文件，选文件会漏，必须拒绝。
  assert.throws(() => selectedFiles(root as any), /文件数量不完整/);
  const body = wholeTorrentBody(root as any, 'magnet:?xt=urn:btih:abc', config, 'folder', '/dest/');
  assert.equal(body.params.sub_file_index, '--1,');
  assert.equal(body.params.total_file_count, '5');
  assert.equal(body.file_size, '1246258197');
  assert.equal(body.params.url, 'magnet:?xt=urn:btih:abc');
});
