// input: SSH config and remote command; output: stdout; pos: NAS host transport.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config } from './config.ts';

export function isLocal(config: Config): boolean {
  return config.ssh.host === 'localhost' || config.ssh.host === '127.0.0.1';
}

export async function ssh(config: Config, command: string, input: string | Uint8Array = '', timeoutMs = 65000): Promise<string> {
  // 同一份代码既能在 Mac 上通过 SSH 驱动 NAS，也能直接跑在 NAS 上（host=localhost，命令本机执行）。
  const local = isLocal(config);
  const dir = local ? null : await mkdtemp(join(tmpdir(), 'nas-movie-'));
  const askpass = dir ? join(dir, 'askpass') : null;
  try {
    if (askpass) await writeFile(askpass, '#!/bin/sh\nprintf "%s\\n" "$NAS_MOVIE_SSH_PASSWORD"\n', { mode: 0o700 });
    const args = local ? ['-c', command] : ['-T', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=yes',
      '-o', 'NumberOfPasswordPrompts=1', '-o', 'ServerAliveInterval=15',
      ...(config.ssh.hostKeyAlias ? ['-o', `HostKeyAlias=${config.ssh.hostKeyAlias}`] : []),
      ...(config.ssh.identityFile ? ['-i', config.ssh.identityFile, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes'] : []),
      '-p', String(config.ssh.port), `${config.ssh.user}@${config.ssh.host}`, command];
    return await new Promise<string>((resolve, reject) => {
      const child = spawn(local ? 'sh' : 'ssh', args, { env: { ...process.env, ...(askpass ? { SSH_ASKPASS: askpass,
        SSH_ASKPASS_REQUIRE: 'force', DISPLAY: ':0' } : {}),
        NAS_MOVIE_SSH_PASSWORD: process.env.NAS_MOVIE_SSH_PASSWORD || config.ssh.password || '' },
        stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(local ? '本机命令超时' : 'SSH 超时；写入操作请先查 status，勿直接重试')); }, timeoutMs);
      child.stdout.on('data', b => { stdout += b; });
      child.stderr.on('data', b => { stderr += b; });
      child.on('error', e => { clearTimeout(timer); reject(e); });
      child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(stdout) : reject(new Error(`${local ? '本机命令' : 'SSH/curl'} 退出 ${code}: ${stderr.slice(0, 400)}`)); });
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    });
  } finally { if (dir) await rm(dir, { recursive: true, force: true }); }
}

