// input: config; output: the configured download backend; pos: download boundary shared by CLI, timers, web wall and organize.
import { downloaderKind, type Config } from './config.ts';
import { Thunder } from './thunder.ts';
import { Aria2 } from './aria2.ts';

/** 各后端统一的任务视图。path 是任务落地的文件或目录，dir 是它所在的下载目录；organize 靠这两个避开下载中的文件。 */
export interface TaskSummary {
  id: string; name: string; phase: string; done: boolean; hash?: string;
  sizeBytes: number; downloadedBytes: number; percent: number; bytesPerSecond: number; path?: string; dir?: string;
}

export interface DownloadResult { action: string; task?: TaskSummary; [detail: string]: unknown }

export interface Downloader {
  readonly kind: 'thunder' | 'aria2';
  /** 批量提交前确认后端可用（迅雷刷新授权，aria2 连上或拉起 RPC），失败就整批不提交。 */
  ready(): Promise<void>;
  download(magnet: string, dir?: string, dryRun?: boolean): Promise<DownloadResult>;
  tasks(): Promise<TaskSummary[]>;
}

export function downloader(config: Config): Downloader {
  return downloaderKind(config) === 'aria2' ? new Aria2(config) : new Thunder(config);
}
