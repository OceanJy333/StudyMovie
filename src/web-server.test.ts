// input: 临时片库与目录；output: 影片墙 API/页面/媒体分片；pos: Web 服务回归测试。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import { gunzipSync } from 'node:zlib';
import type { IncomingHttpHeaders } from 'node:http';
import { startWeb } from './web/server.ts';
import type { Config } from './config.ts';

const config: Config = {
  ssh: { host: 'localhost', port: 22, user: 'me' },
  thunder: { baseUrl: 'http://127.0.0.1:5050/', headers: {}, space: '5', downloadDir: '/tmp' },
  gying: { baseUrl: 'http://127.0.0.1/' },
};

function get(port: number, path: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET', headers }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(chunk as Buffer));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('影片墙：短数组 + gzip + ETag，媒体支持 Range，剧集页可读', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nas-web-'));
  const root = join(dir, '片库');
  const showsRoot = join(dir, '剧集');
  await mkdir(root, { recursive: true });
  await mkdir(join(showsRoot, '幕府将军', 'Season 01'), { recursive: true });
  const video = join(root, '2025-01-01 TEST-001 演员.mp4');
  await writeFile(video, '0123456789');
  await writeFile(join(showsRoot, '幕府将军', 'Season 01', '幕府将军 - S01E01.mkv'), 'shogun-episode');
  const catalogPath = join(dir, 'catalog.json');
  await writeFile(catalogPath, JSON.stringify({
    version: 2, updatedAt: '2026-10-01T00:00:00.000Z', teachers: {},
    entries: {
      'TEST-002': {
        number: 'TEST-002', date: '2024-12-31', title: '第二部', actress: '演员', movieId: 'ab12',
        magnets: 3, updatedAt: '2026-10-01T00:00:00.000Z', sources: ['演员'], multi: false, bd: false,
      },
    },
  }));
  const showsPath = join(dir, 'shows.json');
  await writeFile(showsPath, JSON.stringify({
    version: 1, root: showsRoot,
    subscriptions: [{ name: '幕府将军', query: 'Shogun', aliases: ['Shogun'], kind: 'tv', season: 1, year: 2024 }],
  }));
  const showsStatePath = join(dir, 'shows-state.json');
  await writeFile(showsStatePath, JSON.stringify({ version: 1, lastCheck: '2026-10-17T00:00:00.000Z', seen: {} }));

  const server = await startWeb({
    config, root, port: 0, host: '127.0.0.1',
    cachePath: join(dir, 'meta.json'), coverDir: join(dir, 'covers'),
    catalogPath, submittedPath: join(dir, 'submitted.json'), scanTtlMs: 1000,
    showsPath, showsStatePath,
  });
  try {
    const gz = await get(server.port, '/api/items', { 'accept-encoding': 'gzip' });
    assert.equal(gz.status, 200);
    assert.equal(gz.headers['content-encoding'], 'gzip');
    const payload = JSON.parse(gunzipSync(gz.body).toString()) as {
      items: unknown[][]; counts: { total: number; downloaded: number; missing: number };
    };
    assert.equal(payload.counts.total, 2);
    assert.equal(payload.counts.downloaded, 1);
    assert.equal(payload.counts.missing, 1);
    assert.equal(payload.items[0]?.[0], 'TEST-001');
    assert.equal(payload.items[0]?.[4], 1, 'downloaded 用 1/0 传');
    assert.equal(payload.items[1]?.[10], 0, 'bd 标记在固定位置');

    const etag = String(gz.headers.etag);
    assert.ok(etag.startsWith('W/"'));
    const cached = await get(server.port, '/api/items', { 'accept-encoding': 'gzip', 'if-none-match': etag });
    assert.equal(cached.status, 304);

    const plain = await get(server.port, '/api/items');
    assert.equal(plain.headers['content-encoding'], undefined);
    assert.equal(JSON.parse(plain.body.toString()).items.length, 2);

    const name = encodeURIComponent('2025-01-01 TEST-001 演员.mp4');
    const range = await get(server.port, `/media/${name}`, { range: 'bytes=2-5' });
    assert.equal(range.status, 206);
    assert.equal(range.body.toString(), '2345');
    assert.equal(range.headers['content-range'], 'bytes 2-5/10');

    const traversal = await get(server.port, '/media/%2e%2e%2f%2e%2e%2fetc%2fpasswd');
    assert.equal(traversal.status, 400);

    const health = await get(server.port, '/api/health');
    assert.equal(health.status, 200);
    assert.deepEqual(JSON.parse(health.body.toString()), {
      ok: true, root, items: 2, downloaded: 1, missing: 1, excluded: 0, catalog: 1,
      shows: { subscriptions: 1, lastCheck: '2026-10-17T00:00:00.000Z' },
    });

    const shows = await get(server.port, '/shows');
    assert.equal(shows.status, 200);
    assert.match(shows.body.toString(), /幕府将军/);
    const detail = await get(server.port, `/shows?name=${encodeURIComponent('幕府将军')}`);
    assert.match(detail.body.toString(), /S01E01/);
    const apiShows = JSON.parse((await get(server.port, '/api/shows')).body.toString());
    assert.equal(apiShows.shows.length, 1);
    assert.equal(apiShows.shows[0].episodes.length, 1);
    assert.equal(apiShows.lastCheck, '2026-10-17T00:00:00.000Z');

    const episodePath = '/shows-media/' + encodeURIComponent('幕府将军') + '/Season%2001/' + encodeURIComponent('幕府将军 - S01E01.mkv');
    const episode = await get(server.port, episodePath, { range: 'bytes=0-5' });
    assert.equal(episode.status, 206);
    assert.equal(episode.body.toString(), 'shogun');
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
