// input: 收藏夹里的名字、名册固化的 id 与 JavDB 搜索结果；output: 唯一演员身份；pos: 演员匹配规则。
import type { Actor, Catalog, Movie } from './types.ts';

// 书签写法与 type-0 片单记录不一致；同名的 type-1 行没有可用作品。这些是内置的固定身份。
export const KNOWN: Record<string, { id: string; name: string }> = {
  '七沢みあ': { id: 'NPD3', name: '七澤美亞' },
  '白桃はな': { id: 'Xa1G', name: '白桃花' },
  'さくらわかな': { id: 'VwgMA', name: '櫻若菜' },
  '宮島めい': { id: 'prXZ', name: '宮島芽衣' },
  '胡桃さくら': { id: '9D4m8', name: '胡桃櫻花' },
  '皆月ひかる': { id: '7WNR', name: '皆月光' },
  '松本いちか': { id: 'AOqm', name: '松本一香' },
  '皆瀬あかり': { id: 'YnZBx', name: '皆瀬明里' },
};
// 没有演员记录，出道番号就是身份；同系列后面的番号不是她的。
export const FIXED_CODES: Record<string, string> = { Tiny: 'WSA-001' };

// tp.spfcas.com 用会话路径和混淆字节提供封面；静态主机上同一张图就是普通 JPEG。
export function jdbCover(id: string): string | null {
  return /^[A-Za-z0-9]{4,}$/.test(id) ? `https://c0.jdbstatic.com/covers/${id.slice(0, 2).toLowerCase()}/${id}.jpg` : null;
}

export function actorAliases(actor: Actor): string[] {
  return [actor.name, actor.name_zht, ...(actor.other_name ?? '').split(',')]
    .map(value => (value ?? '').trim()).filter(Boolean);
}

// 同名多个 type-0 记录时，作品数明显多的那个才是片单主体。
function preferFilmography(actors: readonly Actor[]): Actor | null {
  if (actors.length === 1) return actors[0] ?? null;
  const ranked = [...actors].sort((a, b) => (Number(b.videos_count) || 0) - (Number(a.videos_count) || 0));
  const first = ranked[0], second = ranked[1];
  if (!first || !second) return first ?? null;
  return (Number(first.videos_count) || 0) === (Number(second.videos_count) || 0) ? null : first;
}

export function chooseActor(bookmark: string, actors: readonly Actor[]): Actor | null {
  const females = actors.filter(actor => Number(actor.type) === 0);
  const exact = females.filter(actor => actorAliases(actor).includes(bookmark));
  if (exact.length) return preferFilmography(exact);
  // 唯一的 type-0 命中就是同一个名字的汉字/繁体写法。
  return females.length === 1 ? females[0] ?? null : null;
}

export function movieByNumber(movies: readonly Movie[], number: string): Movie | null {
  return movies.find(movie => (movie.number || '').toUpperCase() === number.toUpperCase()) ?? null;
}

export interface Pin { id: string; name: string }
export type Pins = Record<string, Pin>;

// 名册里固化的身份（书签名 → JavDB 演员 id）。读名册时装入；名字找人的接口要登录或会 403，
// 每日任务只认这里和 KNOWN，查不到就算失败，不再静默当成「没有新作」。
const pinned = new Map<string, Pin>();

export function pinActors(pins: Pins): void {
  for (const [bookmark, pin] of Object.entries(pins)) pinned.set(bookmark, pin);
}

export function pinFor(bookmark: string): Pin | null {
  return pinned.get(bookmark) ?? KNOWN[bookmark] ?? null;
}

/** 有固定身份直接用；没有才按书签名搜（只有补新老师时会走到）。 */
export async function resolveActor(bookmark: string, catalog: Pick<Catalog, 'searchActors'>): Promise<Actor | null> {
  const pin = pinFor(bookmark);
  if (pin) return { id: pin.id, type: 0, name: pin.name };
  return chooseActor(bookmark, await catalog.searchActors(bookmark));
}
