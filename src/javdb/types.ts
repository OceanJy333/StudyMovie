// input: JavDB 接口返回；output: 领域模型类型；pos: 元数据模型定义。
export interface Actor {
  id: string; type?: number | null; name?: string | null; name_zht?: string | null;
  other_name?: string | null; videos_count?: number | null;
}
export interface Movie {
  id: string; number?: string | null; title?: string | null; origin_title?: string | null;
  summary?: string | null; release_date?: string | null; magnets_count?: number | null;
  thumb_url?: string | null; cover_url?: string | null; duration?: number | null;
}
export interface Magnet {
  name?: string | null; hash?: string | null; size?: number | null; hd?: boolean | number | null; cnsub?: boolean | number | null;
}
/** 演员片单只需要这三个接口；补片流程再按番号查磁力。 */
export interface Catalog {
  searchActors(name: string): Promise<Actor[]>;
  actorMovies(type: number, id: string, page: number): Promise<Movie[]>;
  magnets(number: string, id?: string | null): Promise<Magnet[]>;
  searchMovie(number: string): Promise<Movie | null>;
}
/** 订阅源按 JavDB 过滤串读片单：厂牌 `0:m:<id>`、番号前缀 `0:c:<前缀>`。 */
export interface SubscriptionCatalog extends Catalog {
  byFilter(filter: string, page: number): Promise<Movie[]>;
}
