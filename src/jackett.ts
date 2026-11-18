// input: movie/TV query and NAS Jackett API; output: normalized resources; pos: search adapter.
import type { Config } from './config.ts';
import type { Resource } from './resources.ts';
import { infoHash } from './resources.ts';
import { ssh } from './ssh.ts';

export interface JackettResult {
  title: string; magnet: string; hash: string; sizeBytes: number;
  seeds: number | null; peers: number | null; categories: number[];
  publishDate: string | null; details: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeResults(data: unknown): JackettResult[] {
  if (!isRecord(data) || !Array.isArray(data.Results) || !Array.isArray(data.Indexers)) {
    throw new Error('Jackett 返回格式异常');
  }
  if (!data.Indexers.length || data.Indexers.some(indexer => !isRecord(indexer) || indexer.Error || indexer.Status !== 2)) {
    throw new Error('Jackett 资源源查询失败，请运行 doctor 检查');
  }
  const found = new Map<string, JackettResult>();
  for (const row of data.Results) {
    if (!isRecord(row) || typeof row.Title !== 'string') continue;
    const magnet = typeof row.MagnetUri === 'string' && row.MagnetUri
      ? row.MagnetUri
      : (/^[a-f\d]{40}$/i.test(String(row.InfoHash ?? '')) ? `magnet:?xt=urn:btih:${String(row.InfoHash)}` : '');
    let hash: string;
    try { hash = infoHash(magnet); } catch { continue; }
    const size = Number(row.Size);
    if (!Number.isFinite(size) || size <= 0) continue;
    const seeds = typeof row.Seeders === 'number' ? row.Seeders : Number.NaN;
    const peers = typeof row.Peers === 'number' ? row.Peers : Number.NaN;
    const categories = Array.isArray(row.Category) ? row.Category.map(Number)
      : Number.isFinite(Number(row.Category)) ? [Number(row.Category)] : [];
    const result: JackettResult = {
      title: row.Title, magnet, hash, sizeBytes: size,
      seeds: Number.isFinite(seeds) && seeds >= 0 ? seeds : null,
      peers: Number.isFinite(peers) && peers >= 0 ? peers : null,
      categories, publishDate: typeof row.PublishDate === 'string' ? row.PublishDate : null,
      details: typeof row.Details === 'string' ? row.Details : '',
    };
    // 同一个种子可能被多个索引器返回，保留做种最多的那条。
    const previous = found.get(hash);
    if (!previous || (result.seeds ?? -1) > (previous.seeds ?? -1)) found.set(hash, result);
  }
  return [...found.values()];
}

export function matchesMovie(title: string, query: string, year?: number) {
  const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const text = ` ${normalize(title)} `, wanted = normalize(query);
  return text.includes(` ${wanted} `) && (!year || new RegExp(`\\b${year}\\b`).test(title));
}

export function parseResults(data: unknown, query: string, year?: number): Resource[] {
  return normalizeResults(data)
    .filter(row => matchesMovie(row.title, query, year))
    .map(row => ({
      title: row.title, magnet: row.magnet, detail: row.details, sizeGB: row.sizeBytes / 1024 ** 3,
      seeds: row.seeds, peers: row.peers,
    }));
}

export class Jackett {
  readonly config: Config;
  constructor(config: Config) { this.config = config; }

  /** 原始结果：片名过滤和排序交给调用方，电视剧要按集数解析而不是片名匹配。 */
  async searchRaw(query: string): Promise<JackettResult[]> {
    return normalizeResults(await this.request(query));
  }

  async search(query: string, year?: number): Promise<Resource[]> {
    return parseResults(await this.request(`${query}${year ? ` ${year}` : ''}`), query, year);
  }

  private async request(query: string): Promise<unknown> {
    // Keep the API key on the NAS. Pass the search as stdin, never shell text.
    const code = `import json,sys,urllib.request,urllib.parse,pathlib
try:
 q=json.load(sys.stdin)
 c=json.loads((pathlib.Path.home()/".config/jackett/ServerConfig.json").read_text())
 params=urllib.parse.urlencode({"apikey":c["APIKey"],"Query":q["query"]})
 url="http://127.0.0.1:9117/api/v2.0/indexers/all/results?"+params
 with urllib.request.urlopen(url,timeout=50) as r: print(r.read().decode())
except Exception:
 print(json.dumps({"error":"Jackett unavailable"}))`;
    const encoded = Buffer.from(code).toString('base64');
    const raw = await ssh(this.config, `python3 -c 'import base64; exec(base64.b64decode("${encoded}"))'`,
      JSON.stringify({ query }));
    const data: unknown = JSON.parse(raw);
    if (isRecord(data) && data.error) throw new Error('NAS Jackett 未就绪或资源源超时');
    return data;
  }
}
