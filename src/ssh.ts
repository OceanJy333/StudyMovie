// input: NAS config and API request; output: authenticated JSON; pos: Thunder request boundary.
import { thunderConfig, type Config } from './config.ts';
import { ssh } from './transport.ts';
import { ensureThunderAuth } from './thunder-auth.ts';
export { ssh, isLocal } from './transport.ts';

export async function nasRequest(config: Config, path: string, body?: unknown): Promise<any> {
  await ensureThunderAuth(config);
  const thunder = thunderConfig(config);
  const url = new URL(path, thunder.baseUrl);
  const quote = (s: string) => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r') + '"';
  const lines = ['silent', 'show-error', 'max-time = 50', 'url = ' + quote(url.href)];
  for (const [k, v] of Object.entries(thunder.headers)) lines.push('header = ' + quote(`${k}: ${v}`));
  if (body !== undefined) lines.push('request = "POST"', 'data = ' + quote(JSON.stringify(body)));
  const raw = await ssh(config, 'curl --config -', lines.join('\n'));
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error('迅雷没有返回 JSON，请检查 NAS 服务'); }
  if (data.error || data.error_code) throw new Error(`迅雷错误 ${data.error_code || ''}: ${String(data.error).replace(/token:.*/i, 'token: [redacted]')}`);
  return data;
}
