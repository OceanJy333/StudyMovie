// input: 本机 shows 配置；output: 在 NAS 上执行 shows 子命令；pos: 远程剧集操作。
import type { Config } from '../config.ts';
import { ssh } from '../transport.ts';
import type { ShowsConfig } from './types.ts';

/** 与 deploy-nas.sh 的安装位置保持一致（NAS 用户主目录下），由远端 shell 展开 $HOME。 */
const APP_DIR = '"$HOME/.local/share/nas-movie"';
const CONF_DIR = '"$HOME/.config/nas-movie"';

/** 本机维护的订阅在检查前先推给 NAS，避免「Mac 上加了但 NAS 不知道」。 */
export async function pushShowsConfig(config: Config, shows: ShowsConfig): Promise<void> {
  await ssh(config,
    `mkdir -p ${CONF_DIR} && cat > ${CONF_DIR}/shows.json && chmod 600 ${CONF_DIR}/shows.json`,
    `${JSON.stringify(shows, null, 2)}\n`, 60_000);
}

/** 子命令和参数都由本文件拼装（只有数字/布尔），不接受用户字符串拼接。 */
export async function runRemoteShows<T>(config: Config, sub: 'list' | 'check' | 'organize', flags: readonly string[] = []): Promise<T> {
  const command = `cd ${APP_DIR} && /usr/bin/node dist/cli.js shows ${sub}${flags.length ? ` ${flags.join(' ')}` : ''}`;
  const output = await ssh(config, command, '', 900_000);
  return JSON.parse(output) as T;
}
