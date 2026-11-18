// input: magnets and aria2 JSON-RPC settings; output: BT tasks on this computer; pos: aria2 download backend (no NAS needed).
// 本机地址的 RPC 连不上时自己拉起 `aria2c -D`，下载在 CLI 退出后继续；会话文件让重启后能续传。
import { spawn } from 'node:child_process';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Config } from './config.ts';
import type { Downloader, DownloadResult, TaskSummary } from './downloader.ts';
import { assertDownloadPath, configDir, paths } from './core/paths.ts';
import { infoHash } from './resources.ts';
import { sleep } from './core/async.ts';

// 磁力只带哈希时全靠 DHT；附几个公共 tracker，元数据通常快很多。
export const TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce', 'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce', 'udp://exodus.desync.com:6969/announce',
  'http://tracker.opentrackr.org:1337/announce',
];
const KEYS = ['gid', 'status', 'totalLength', 'completedLength', 'downloadSpeed', 'infoHash', 'dir', 'files', 'bittorrent', 'followedBy', 'errorMessage'];

interface Aria2Task {
  gid: string; status: string; totalLength: string; completedLength: string; downloadSpeed: string; infoHash?: string; dir: string;
  files?: { path: string }[]; bittorrent?: { info?: { name?: string } }; followedBy?: string[]; errorMessage?: string;
}

/** 磁力先生成一个取元数据的任务，拿到元数据后由 followedBy 指向真正的下载任务；只列后者，避免同一部出现两次。 */
export function aria2Summary(task: Aria2Task): TaskSummary {
  const name = task.bittorrent?.info?.name || (task.files?.[0]?.path ? basename(task.files[0].path) : `[METADATA] ${task.infoHash ?? task.gid}`);
  const size = Number(task.totalLength), done = Number(task.completedLength);
  return {
    id: task.gid, name, phase: task.status, done: task.status === 'complete', hash: task.infoHash?.toLowerCase(),
    sizeBytes: size, downloadedBytes: done, percent: size > 0 ? Number((done / size * 100).toFixed(2)) : 0,
    bytesPerSecond: Number(task.downloadSpeed), dir: task.dir,
    path: task.bittorrent?.info?.name ? join(task.dir, task.bittorrent.info.name) : task.files?.[0]?.path || undefined,
  };
}

export class Aria2 implements Downloader {
  readonly kind = 'aria2' as const;
  private readonly rpc: URL;
  private readonly secret?: string;

  constructor(config: Config) {
    this.rpc = new URL(config.aria2?.rpc || 'http://127.0.0.1:6800/jsonrpc');
    this.secret = config.aria2?.secret || undefined;
  }

  private async call<T>(method: string, ...params: unknown[]): Promise<T> {
    const response = await fetch(this.rpc, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ jsonrpc: '2.0', id: 'studymovie', method: `aria2.${method}`, params: this.secret ? [`token:${this.secret}`, ...params] : params }),
    });
    const data = await response.json() as { result?: T; error?: { message: string } };
    if (data.error) throw new Error(`aria2 错误：${data.error.message}`);
    return data.result as T;
  }

  private get local() { return ['127.0.0.1', 'localhost', '[::1]'].includes(this.rpc.hostname); }

  async ready() {
    try { await this.call('getVersion'); return; }
    catch (error) { if (!this.local) throw new Error(`连不上 aria2 RPC ${this.rpc.origin}：${error instanceof Error ? error.message : error}`); }
    await this.start();
    for (let attempt = 0; attempt < 20; attempt++) {
      await sleep(250);
      try { await this.call('getVersion'); return; } catch { /* 还在启动 */ }
    }
    throw new Error('aria2c 已启动但 RPC 没有响应');
  }

  private async start() {
    const session = join(configDir, 'aria2.session');
    await mkdir(configDir, { recursive: true, mode: 0o700 });
    await access(session).catch(() => writeFile(session, '', { mode: 0o600 }));
    const args = [
      '--enable-rpc', `--rpc-listen-port=${this.rpc.port || 6800}`, '--rpc-listen-all=false', '--daemon=true',
      `--dir=${paths.archive}`, '--continue=true', '--seed-time=0', '--bt-save-metadata=false',
      '--dht-entry-point=dht.transmissionbt.com:6881', `--bt-tracker=${TRACKERS.join(',')}`,
      `--input-file=${session}`, `--save-session=${session}`, '--save-session-interval=60',
      ...(this.secret ? [`--rpc-secret=${this.secret}`] : []),
    ];
    await new Promise<void>((resolve, reject) => {
      const child = spawn('aria2c', args, { stdio: 'ignore' });
      child.on('error', error => reject((error as NodeJS.ErrnoException).code === 'ENOENT'
        ? new Error('没有找到 aria2c：macOS 用 brew install aria2，Linux 用包管理器安装，Windows 用 winget install aria2.aria2') : error));
      child.on('exit', code => code === 0 ? resolve() : reject(new Error(`aria2c 启动失败，退出码 ${code}`)));
    });
  }

  async tasks(): Promise<TaskSummary[]> {
    await this.ready();
    const [active, waiting, stopped] = await Promise.all([
      this.call<Aria2Task[]>('tellActive', KEYS), this.call<Aria2Task[]>('tellWaiting', 0, 1000, KEYS),
      this.call<Aria2Task[]>('tellStopped', 0, 1000, KEYS),
    ]);
    return [...active, ...waiting, ...stopped].filter(task => !task.followedBy?.length).map(aria2Summary);
  }

  async download(magnet: string, dir = paths.archive, dryRun = false): Promise<DownloadResult> {
    const hash = infoHash(magnet);
    assertDownloadPath(dir);
    const existing = (await this.tasks()).find(task => task.hash === hash && task.phase !== 'error' && task.phase !== 'removed');
    if (existing) return { action: 'existing', task: existing };
    if (dryRun) return { action: 'preview', dir, magnet };
    // 整包下载；广告和说明文件由 organize 清到回收目录。seed-time=0：下完即算完成，不挂着做种。
    const gid = await this.call<string>('addUri', [magnet], { dir, 'seed-time': '0', 'bt-tracker': TRACKERS.join(',') });
    return { action: 'created', task: {
      id: gid, name: hash, phase: 'waiting', done: false, hash, sizeBytes: 0, downloadedBytes: 0, percent: 0, bytesPerSecond: 0, dir,
    } };
  }
}
