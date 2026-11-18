// input: 环境变量、~/.config/nas-movie/env 与用户主目录；output: 配置/状态/缓存/片库路径；pos: 全项目路径与个人设置写源。
import { readFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

// 所有路径都能用环境变量覆盖，测试和一次性运行不用碰真实账本。
export const configDir = process.env.NAS_MOVIE_CONFIG_HOME || join(homedir(), '.config/nas-movie');

/** 个人设置文件：每行 `KEY=VALUE`（值可加引号）。已存在的环境变量优先，部署脚本也读同一个文件。 */
export const envFile = join(configDir, 'env');

export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match) out[match[1]!] = match[2]!.replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

try {
  for (const [key, value] of Object.entries(parseEnvFile(readFileSync(envFile, 'utf8')))) process.env[key] ??= value;
} catch { /* 没有设置文件就全用默认值 */ }

const EDGE_BOOKMARKS = platform() === 'win32'
  ? join(process.env.LOCALAPPDATA ?? '', 'Microsoft/Edge/User Data/Default/Bookmarks')
  : platform() === 'darwin' ? join(homedir(), 'Library/Application Support/Microsoft Edge/Default/Bookmarks')
    : join(homedir(), '.config/microsoft-edge/Default/Bookmarks');
export const stateDir = process.env.NAS_MOVIE_STATE_HOME || join(configDir, 'state');
export const cacheDir = process.env.NAS_MOVIE_CACHE_HOME || join(homedir(), '.cache/nas-movie');

export function statePath(name: string): string {
  return join(stateDir, name);
}

export const paths = {
  config: process.env.NAS_MOVIE_CONFIG || join(configDir, 'config.json'),
  roster: process.env.NAS_MOVIE_ROSTER || join(configDir, 'performers.json'),
  shows: process.env.NAS_MOVIE_SHOWS || join(configDir, 'shows.json'),
  auto: process.env.NAS_MOVIE_STATE || statePath('auto.json'),
  catalog: process.env.NAS_MOVIE_CATALOG || statePath('catalog.json'),
  organized: process.env.NAS_MOVIE_ORGANIZED || statePath('organized.json'),
  submitted: process.env.NAS_MOVIE_SUBMITTED || statePath('submitted.json'),
  showsState: process.env.NAS_MOVIE_SHOWS_STATE || statePath('shows.json'),
  javdb: process.env.NAS_MOVIE_CACHE || statePath('javdb-cache.json'),
  covers: process.env.NAS_MOVIE_COVERS || join(cacheDir, 'covers'),
  downloadLock: join(configDir, 'download.lock'),
  trash: process.env.NAS_MOVIE_TRASH || join(homedir(), '.nas-movie-trash'),
  /** 片库根目录（平铺的 `发行日期 番号 演员.ext`），也是迅雷提交的默认目标目录。 */
  archive: process.env.NAS_MOVIE_ARCHIVE || join(homedir(), 'Media/JAV'),
  /** 剧集根目录；shows.json 里的 root 优先。 */
  showsRoot: process.env.NAS_MOVIE_SHOWS_ROOT || join(homedir(), 'Media/Shows'),
} as const;

export const settings = {
  blockedDirs: (process.env.NAS_MOVIE_BLOCKED_DIRS || '').split(',').map(name => name.trim()).filter(Boolean),
} as const;

/** 老师名册来自浏览器书签里的一个文件夹。书签在另一台机器上时填 SSH 主机，用 scp 取。 */
export const bookmarks = {
  host: process.env.NAS_MOVIE_BOOKMARKS_HOST || '',
  file: process.env.NAS_MOVIE_BOOKMARKS_FILE || EDGE_BOOKMARKS,
  folder: process.env.NAS_MOVIE_BOOKMARKS_FOLDER || 'Teachers',
} as const;
