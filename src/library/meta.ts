// input: 番号与 JavDB（App 片单找 id，影片网页取女演员）；output: 带缓存的影片元数据；pos: 整理流程的元数据缓存。
import { readJsonFile, writeJsonAtomic } from '../core/json.ts';
import type { MovieMeta } from './naming.ts';

interface MetaClient {
  searchMovie(number: string): Promise<{ id: string; release_date?: string | null; title?: string | null } | null>;
  moviePage(id: string): Promise<{ title: string; date: string | null; actresses: { id: string; name: string }[] }>;
}

const MISS_TTL_MS = 3 * 86_400_000;

export type MetaCache = Record<string, MovieMeta>;

/**
 * 元数据缓存：命中就不再打 JavDB；未收录也记下来（miss），3 天内不重复查同一批
 * 无码厂牌番号。
 */
export class MetaStore {
  private dirty = false;

  private readonly path: string;
  private readonly client: MetaClient;
  private readonly cache: MetaCache;

  private constructor(path: string, client: MetaClient, cache: MetaCache) {
    this.path = path;
    this.client = client;
    this.cache = cache;
  }

  static async open(path: string, client: MetaClient, cache?: MetaCache): Promise<MetaStore> {
    return new MetaStore(path, client, cache ?? await readJsonFile<MetaCache>(path, {}));
  }

  snapshot(): MetaCache {
    return this.cache;
  }

  /** id 已知（作品目录里记过）时跳过 App 片单找 id，直接取影片页。 */
  async resolve(number: string, knownId?: string | null): Promise<MovieMeta> {
    const key = number.toUpperCase();
    const cached = this.cache[key];
    // 没有 actresses 字段的是 11-10 之后只记了片单信息、或旧版只翻前后几页就记成 miss 的条目，要重查。
    // 「没收录」只管 3 天：新片发行前后 JavDB 才陆续收录，永久记 miss 会让它一直叫未知演员。
    const fresh = cached && Array.isArray(cached.actresses) && (!cached.miss || Date.now() - Date.parse(cached.at) < MISS_TTL_MS);
    if (cached && fresh) return cached;
    let meta: MovieMeta = { number: key, miss: true, actresses: [], at: new Date().toISOString() };
    try {
      const movie = knownId ? { id: knownId } as { id: string; release_date?: string | null; title?: string | null } : await this.client.searchMovie(key);
      if (movie?.id) {
        const page = await this.client.moviePage(movie.id);
        meta = {
          number: key, id: movie.id, date: movie.release_date ?? page.date, title: page.title || movie.title || null,
          actresses: page.actresses, at: new Date().toISOString(),
        };
      }
    } catch (error) {
      // 网络错误不写缓存：下一轮应该重试，而不是把一次超时记成「JavDB 没有」。
      return { number: key, error: error instanceof Error ? error.message : 'JavDB 查询失败', at: new Date().toISOString() };
    }
    this.cache[key] = meta;
    this.dirty = true;
    return meta;
  }

  async flush(): Promise<void> {
    if (!this.dirty) return;
    await writeJsonAtomic(this.path, this.cache);
    this.dirty = false;
  }
}
