// input: 补片流程的中间结果；output: 统一的候选/条目类型；pos: 老师订阅类型定义。
export interface Latest {
  bookmark: string; official: string | null; date: string | null; number: string | null; title: string | null;
  magnets: number | null; hd: boolean | null; cnsub: boolean | null;
  status: 'ok' | 'none' | 'unmatched' | 'error'; error?: string; hash?: string;
}
// Feed 行只用于展示：每位老师最新作品，带可直接显示的封面地址。
export interface FeedItem {
  date: string | null; bookmark: string; official: string | null; number: string; title: string | null;
  cover: string | null; magnets: number | null; duration: number | null;
  id: string; jable: string | null;
}
/** 已校验磁力的可下载候选。 */
export interface Candidate {
  number: string; hash: string; date: string | null; source: string; title: string | null;
}
/** 补片池条目：只带来源和发行日期，磁力等选中后再查。 */
export interface PoolEntry {
  id: string; number: string; date: string | null; title: string | null; source: string;
}
