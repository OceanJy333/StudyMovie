// input: local private configuration; output: validated connection config; pos: CLI configuration.
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import { paths } from "./core/paths.js";
export const configPath = paths.config;
/** 没有 config.json 就当作「这台电脑 + aria2」：装完即可用，不必先配 NAS。 */
export async function readConfig() {
    const raw = await readFile(configPath, 'utf8').catch((error) => {
        if (error.code === 'ENOENT')
            return null;
        throw error;
    });
    const c = raw === null ? { downloader: 'aria2' } : JSON.parse(raw);
    if (c.ssh && (!/^[\w.-]+$/.test(c.ssh.host) || !/^[\w.-]+$/.test(c.ssh.user)))
        throw new Error('无效 SSH host/user');
    if (c.ssh?.hostKeyAlias && !/^[\w.-]+$/.test(c.ssh.hostKeyAlias))
        throw new Error('无效 SSH hostKeyAlias');
    if (downloaderKind(c) === 'thunder' && (!c.ssh?.host || !c.ssh?.user || !c.thunder?.baseUrl)) {
        throw new Error('配置不完整：迅雷后端需要 ssh 和 thunder；只在本机下载请设 "downloader": "aria2"');
    }
    return c;
}
export function downloaderKind(config) {
    return config.downloader ?? (config.thunder ? 'thunder' : 'aria2');
}
/** 迅雷专属命令（paths、preview、auth）用：没有迅雷配置就明确报错。 */
export function thunderConfig(config) {
    if (!config.thunder)
        throw new Error('这个命令只支持 NAS 迅雷后端，当前配置没有 thunder');
    return config.thunder;
}
export async function saveConfig(c) {
    await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
    const stored = c.thunder ? { ...c, thunder: { ...c.thunder, headers: { ...c.thunder.headers } } } : { ...c };
    if (stored.thunder)
        delete stored.thunder.headers['pan-auth'];
    await writeFile(configPath, JSON.stringify(stored, null, 2) + '\n', { mode: 0o600 });
    await chmod(configPath, 0o600);
}
