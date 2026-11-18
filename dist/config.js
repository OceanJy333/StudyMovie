// input: local private configuration; output: validated connection config; pos: CLI configuration.
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
export const configPath = process.env.NAS_MOVIE_CONFIG || join(homedir(), '.config/nas-movie/config.json');
export async function readConfig() {
    const c = JSON.parse(await readFile(configPath, 'utf8'));
    if (!c.ssh?.host || !c.ssh?.user || !c.thunder?.baseUrl || !c.gying?.baseUrl)
        throw new Error('配置不完整');
    if (!/^[\w.-]+$/.test(c.ssh.host) || !/^[\w.-]+$/.test(c.ssh.user))
        throw new Error('无效 SSH host/user');
    if (c.ssh.hostKeyAlias && !/^[\w.-]+$/.test(c.ssh.hostKeyAlias))
        throw new Error('无效 SSH hostKeyAlias');
    return c;
}
export async function saveConfig(c) {
    await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
    const stored = { ...c, thunder: { ...c.thunder, headers: { ...c.thunder.headers } } };
    delete stored.thunder.headers['pan-auth'];
    await writeFile(configPath, JSON.stringify(stored, null, 2) + '\n', { mode: 0o600 });
    await chmod(configPath, 0o600);
}
