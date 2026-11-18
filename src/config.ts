// input: local private configuration; output: validated connection config; pos: CLI configuration.
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import { paths } from './core/paths.ts';

export interface SshConfig { host: string; port: number; user: string; password?: string; hostKeyAlias?: string; identityFile?: string }
export interface ThunderConfig { baseUrl: string; headers: Record<string, string>; space: string; downloadDir: string }
/** aria2 JSON-RPC。rpc 默认本机 6800；本机地址连不上时 CLI 会自己拉起 aria2c 守护进程。 */
export interface Aria2Config { rpc?: string; secret?: string }

export interface Config {
  /** 下载后端：NAS 迅雷（默认，兼容旧配置）或任意电脑上的 aria2。 */
  downloader?: 'thunder' | 'aria2';
  ssh?: SshConfig;
  thunder?: ThunderConfig;
  aria2?: Aria2Config;
  gying?: { baseUrl: string; cookie?: string; userAgent?: string };
}
export const configPath = paths.config;

/** 没有 config.json 就当作「这台电脑 + aria2」：装完即可用，不必先配 NAS。 */
export async function readConfig(): Promise<Config> {
  const raw = await readFile(configPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  const c = raw === null ? { downloader: 'aria2' as const } : JSON.parse(raw) as Config;
  if (c.ssh && (!/^[\w.-]+$/.test(c.ssh.host) || !/^[\w.-]+$/.test(c.ssh.user))) throw new Error('无效 SSH host/user');
  if (c.ssh?.hostKeyAlias && !/^[\w.-]+$/.test(c.ssh.hostKeyAlias)) throw new Error('无效 SSH hostKeyAlias');
  if (downloaderKind(c) === 'thunder' && (!c.ssh?.host || !c.ssh?.user || !c.thunder?.baseUrl)) {
    throw new Error('配置不完整：迅雷后端需要 ssh 和 thunder；只在本机下载请设 "downloader": "aria2"');
  }
  return c;
}

export function downloaderKind(config: Config): 'thunder' | 'aria2' {
  return config.downloader ?? (config.thunder ? 'thunder' : 'aria2');
}

/** 迅雷专属命令（paths、preview、auth）用：没有迅雷配置就明确报错。 */
export function thunderConfig(config: Config): ThunderConfig {
  if (!config.thunder) throw new Error('这个命令只支持 NAS 迅雷后端，当前配置没有 thunder');
  return config.thunder;
}

export async function saveConfig(c: Config) {
  await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
  const stored = c.thunder ? { ...c, thunder: { ...c.thunder, headers: { ...c.thunder.headers } } } : { ...c };
  if (stored.thunder) delete stored.thunder.headers['pan-auth'];
  await writeFile(configPath, JSON.stringify(stored, null, 2) + '\n', { mode: 0o600 });
  await chmod(configPath, 0o600);
}
