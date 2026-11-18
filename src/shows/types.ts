// input: 无；output: 剧集订阅/库/状态类型；pos: 剧集模块类型定义。
export type ShowKind = 'tv' | 'anime';

export interface ShowSubscription {
  name: string;
  /** 送进 Jackett 的搜索词，通常是英文名。 */
  query: string;
  /** 标题匹配用的别名；默认用 query + name。 */
  aliases: string[];
  kind: ShowKind;
  season: number | null;
  /** 只在 1..N 集内下载；null 表示不限（一直追）。 */
  totalEpisodes: number | null;
  /** zh = 只收标题带中文字幕标记的版本；any = 不限制。 */
  subtitle: 'zh' | 'any';
  year: number | null;
  enabled: boolean;
  minSizeMB: number;
  maxSizeMB: number;
}

export interface ShowsConfig {
  version: number;
  root: string;
  subscriptions: ShowSubscription[];
}

export interface ShowSeen {
  at: string; hash: string; title: string; action: string; taskId?: string;
  show: string; season: number; episodes: number[]; sizeBytes: number;
}

export interface ShowsState {
  version: number;
  lastCheck: string | null;
  /** key = 剧名|S01E03 或 剧名|S01|pack */
  seen: Record<string, ShowSeen>;
}

export interface EpisodeFile {
  season: number; episode: number; file: string; sizeBytes: number; addedAt: string;
}

export interface ShowLibraryItem {
  name: string;
  episodes: EpisodeFile[];
  totalBytes: number;
  updatedAt: string;
  /** 是否能在订阅配置里找到同名条目。 */
  subscribed: boolean;
}

/** 一个种子覆盖的集数集合；单集就是一项，合集是多集。 */
export interface TorrentGroup {
  show: string; season: number; episodes: number[]; title: string; hash: string; magnet: string;
  sizeBytes: number; seeds: number | null; score: number; pack: boolean;
}

export interface ShowCheckResult {
  show: string; season: number; episodes: number[]; title: string; hash: string;
  sizeBytes: number; seeds: number | null; action: string; taskId?: string; error?: string;
}
