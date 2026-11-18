// input: NAS UI page and connection config; output: current UIAuth; pos: Thunder authorization source.
import type { Config } from './config.ts';
import { ssh } from './transport.ts';

export function authExpiry(token: string): number | null {
  try {
    if (token.split('.').length !== 3) return null;
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    return Number.isFinite(payload.exp) ? payload.exp * 1000 : null;
  } catch { return null; }
}

export function pageAuth(html: string, now = Date.now()): string {
  // Read the literal injected by Thunder; never execute scripts from the page.
  const token = html.match(/function\s+uiauth\s*\([^)]*\)\s*\{\s*return\s*["']([\w-]+\.[\w-]+\.[\w-]+)["']/)?.[1];
  if (!token) throw new Error('迅雷本机页面没有提供 UIAuth，请检查迅雷服务');
  const expiry = authExpiry(token);
  if (!expiry || expiry <= now) throw new Error('迅雷本机页面的 UIAuth 已过期，请检查迅雷服务');
  return token;
}

const loaded = new WeakSet<Config>();
const pending = new WeakMap<Config, Promise<void>>();
export async function ensureThunderAuth(config: Config): Promise<void> {
  const expiry = authExpiry(config.thunder.headers['pan-auth'] || '');
  if (loaded.has(config) && expiry && expiry > Date.now() + 60_000) return;
  const active = pending.get(config);
  if (active) return active;
  const request = (async () => {
    const url = new URL('/', config.thunder.baseUrl);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
      throw new Error('迅雷自动授权需要 NAS 本机 HTTP 接口');
    }
    const html = await ssh(config, 'curl --silent --show-error --fail --max-time 15 --config -',
      `url = ${JSON.stringify(url.href)}\n`);
    config.thunder.headers['pan-auth'] = pageAuth(html);
    loaded.add(config);
  })();
  pending.set(config, request);
  try { await request; } finally { pending.delete(config); }
}
