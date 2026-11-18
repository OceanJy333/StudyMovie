// input: a fake aria2 JSON-RPC server; output: verified task view and submit contract; pos: aria2 backend and backend selection tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Aria2, aria2Summary } from './aria2.ts';
import { downloaderKind, type Config } from './config.ts';

const HASH = 'a'.repeat(40);

async function fakeRpc(tasks: Record<string, unknown[]>) {
  const calls: { method: string; params: unknown[] }[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const { method, params } = JSON.parse(body);
      calls.push({ method, params });
      const name = method.replace('aria2.', '');
      const result = name === 'addUri' ? 'gid-new' : name === 'getVersion' ? { version: '1.37.0' } : tasks[name] ?? [];
      res.end(JSON.stringify({ jsonrpc: '2.0', id: 'studymovie', result }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const rpc = `http://127.0.0.1:${(server.address() as AddressInfo).port}/jsonrpc`;
  return { rpc, calls, close: () => new Promise(resolve => server.close(resolve)) };
}

test('没写 downloader 时：有 thunder 配置用迅雷，否则用 aria2', () => {
  assert.equal(downloaderKind({ thunder: {} } as Config), 'thunder');
  assert.equal(downloaderKind({}), 'aria2');
  assert.equal(downloaderKind({ downloader: 'aria2', thunder: {} } as Config), 'aria2');
});

test('磁力的元数据任务不单独列出，下载任务带路径和完成状态', async () => {
  const rpc = await fakeRpc({
    tellActive: [{ gid: 'g2', status: 'active', totalLength: '200', completedLength: '50', downloadSpeed: '10', infoHash: HASH.toUpperCase(),
      dir: '/lib', bittorrent: { info: { name: 'ABC-123' } }, files: [{ path: '/lib/ABC-123/abc.mp4' }] }],
    tellStopped: [{ gid: 'g1', status: 'complete', totalLength: '0', completedLength: '0', downloadSpeed: '0', infoHash: HASH, dir: '/lib', followedBy: ['g2'] }],
  });
  try {
    const tasks = await new Aria2({ aria2: { rpc: rpc.rpc } }).tasks();
    assert.deepEqual(tasks.map(task => [task.id, task.hash, task.path, task.dir, task.done, task.percent]), [['g2', HASH, '/lib/ABC-123', '/lib', false, 25]]);
  } finally { await rpc.close(); }
});

test('已有同哈希任务不重复提交；新任务带目录、tracker 和 seed-time=0', async () => {
  const rpc = await fakeRpc({ tellActive: [{ gid: 'g2', status: 'active', totalLength: '1', completedLength: '0', downloadSpeed: '0', infoHash: HASH, dir: '/lib' }] });
  try {
    const aria2 = new Aria2({ aria2: { rpc: rpc.rpc, secret: 's3' } });
    assert.equal((await aria2.download(`magnet:?xt=urn:btih:${HASH}`, '/lib')).action, 'existing');
    const fresh = await aria2.download(`magnet:?xt=urn:btih:${'b'.repeat(40)}`, '/lib/new');
    assert.equal(fresh.action, 'created');
    const add = rpc.calls.find(call => call.method === 'aria2.addUri')!;
    assert.equal(add.params[0], 'token:s3');
    const options = add.params[2] as Record<string, string>;
    assert.equal(options.dir, '/lib/new');
    assert.equal(options['seed-time'], '0');
    assert.match(options['bt-tracker']!, /opentrackr/);
  } finally { await rpc.close(); }
});

test('元数据还没到时用哈希当名字', () => {
  const task = aria2Summary({ gid: 'g', status: 'active', totalLength: '0', completedLength: '0', downloadSpeed: '0', infoHash: HASH, dir: '/lib' });
  assert.equal(task.name, `[METADATA] ${HASH}`);
  assert.equal(task.path, undefined);
});
