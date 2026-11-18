// input: 下载文件名 / 发行标题；output: 番号、演员与规范文件名；pos: 片库命名与元数据判定。
import { paths } from '../core/paths.ts';

export const videoExtensions = new Set(['.mp4', '.mkv', '.wmv', '.avi', '.ts', '.m2ts', '.mov', '.rmvb', '.flv', '.m4v']);
export const defaultArchiveRoot = paths.archive;
export const unknownActress = '未知演员';

export interface MovieMeta {
  number: string; id?: string; date?: string | null; title?: string | null;
  /** 只有女演员（JavDB 影片页的 actor-female）；没有这个字段的是旧缓存。 */
  actresses?: { id?: string; name: string }[];
  miss?: boolean; error?: string; at: string;
}

// 番号前缀白名单：只用于给候选排序和「查不到时兜底」，不是硬约束，运行中会自己学。
export const PREFIX_SEED = ['FSDSS', 'FCDSS', 'REBDB', 'REBD', 'FNS', 'FTAV', 'APGH', 'APAK', 'APNS', 'APKH', 'APRG',
  'MIDA', 'MIDE', 'MIDV', 'MIMK', 'MIRD', 'MIZD', 'MIAA', 'MNGS', 'MDBK', 'HMN', 'HUNTC', 'START', 'SDHS',
  'SONE', 'SNOS', 'STARS', 'CAWD', 'DOA', 'EKDV', 'XVSR', 'WAAA', 'CJOD', 'FWAY', 'OFJE', 'OFTR', 'IPZZ', 'IPX',
  'EDEA', 'DASD', 'SSIS', 'SSNI', 'PRED', 'ADN', 'ATID', 'DANDY', 'GVH', 'KTB', 'NGOD', 'OAE', 'PRST', 'ROYD',
  'RCTD', 'SHKD', 'VEC', 'VRTM', 'YMDD', 'ZEX', 'JUL', 'SCOP', 'DSOD', 'MUKC', 'NSFS', 'SAME', 'SIRO', 'TOEN'];

// 文件名里的番号写法极乱：hhd800.com@MIDA184、mida-220ch、SDHS-057.[4K]@R90s、Ed MosaicEDEA-559。
// 先把非字母数字压成空格，再抓「字母串 + 数字」；字母串超过 7 个字符时再取它的尾部（MOSAICEDEA → EDEA）。
export function numberMatches(name: string): { run: string; digits: string; at: number }[] {
  const normalized = name.replace(/[^A-Za-z0-9]+/g, ' ').toUpperCase();
  const pattern = /([A-Z]+) ?(\d{2,5})/g;
  const out: { run: string; digits: string; at: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(normalized)) !== null) out.push({ run: match[1] ?? '', digits: match[2] ?? '', at: match.index });
  return out;
}

export interface NumberCandidate { number: string; prefix: string; digits: number; at: number }

export function numberCandidates(name: string): NumberCandidate[] {
  const out: NumberCandidate[] = [];
  const seen = new Set<string>();
  for (const { run, digits, at } of numberMatches(name)) {
    const sizes = [run.length, ...(run.length > 7 ? [7, 6, 5, 4, 3, 2] : [])];
    for (const size of sizes) {
      if (size < 2) continue;
      const prefix = run.slice(run.length - size);
      const number = `${prefix}-${digits}`;
      if (seen.has(number)) continue;
      seen.add(number);
      out.push({ number, prefix, digits: digits.length, at });
    }
  }
  return out;
}

// 靠后的匹配更像真番号（站点前缀总在前面）；同一处匹配里更长的前缀更像厂牌（SONE 优于 HD）。
export function rankCandidates(candidates: readonly NumberCandidate[], known: ReadonlySet<string>): NumberCandidate[] {
  return [...candidates].sort((a, b) =>
    Number(known.has(b.prefix)) - Number(known.has(a.prefix)) ||
    b.at - a.at ||
    b.prefix.length - a.prefix.length ||
    b.digits - a.digits);
}

// 只有「整段字母就是厂牌、且文件名里只有一个候选」才拿来扩充白名单，否则 hhd800 会被误学成厂牌。
export function learnPrefixes(names: readonly string[], known: Set<string>): number {
  let added = 0;
  for (const name of names) {
    const matches = numberMatches(name);
    const only = matches[0];
    if (matches.length !== 1 || !only || only.run.length > 7) continue;
    if (!known.has(only.run)) { known.add(only.run); added++; }
  }
  return added;
}

export interface ActressPick { name: string; names: string[]; how: string; learn: boolean }

export const ACTRESS_JOINER = '、';
const MAX_NAMES = 4;

/** 文件名里的演员段 → 每位演员（多人共演写成 `甲、乙`，超过 4 人末尾带「等」）。 */
export function splitActresses(actress: string): string[] {
  return actress.replace(/等$/, '').split(ACTRESS_JOINER).map(name => name.trim()).filter(Boolean);
}

function joined(names: readonly string[]): string {
  return names.slice(0, MAX_NAMES).join(ACTRESS_JOINER) + (names.length > MAX_NAMES ? '等' : '');
}

/**
 * 演员表只含女演员（男优天然排除），多人共演全部写上：主演（目录名或已知老师）在前，其余按 JavDB 顺序。
 * primary 来自下载目录名或旧文件名；它不在 JavDB 演员表里时多半是别名写法，这时不敢配共演，只留她一个。
 */
export function pickActress(
  title: string | null | undefined, actresses: MovieMeta['actresses'], known: ReadonlySet<string>, primary?: string | null,
): ActressPick {
  const named = [...new Set((actresses ?? []).map(actress => actress.name).filter(Boolean))];
  const pick = (names: string[], how: string, learn = false): ActressPick => ({ name: joined(names), names, how, learn });
  if (primary) {
    return named.includes(primary) ? pick([primary, ...named.filter(name => name !== primary)], 'primary') : pick([primary], 'primary');
  }
  const knownHits = named.filter(name => known.has(name));
  if (knownHits.length) return pick([...knownHits, ...named.filter(name => !known.has(name))], 'known');
  if (named.length === 1) return pick(named, 'solo', true);
  if (named.length > 1) return pick(named, 'multi');
  // JavDB 没挂演员时，标题里出现的已知演员名取最长的那个。
  const hit = [...known].filter(name => name.length >= 2 && (title ?? '').includes(name)).sort((a, b) => b.length - a.length)[0];
  if (hit) return pick([hit], 'known-title');
  return pick([unknownActress], 'unknown');
}

export function safeSegment(value: string, limit = 60): string {
  return value.replace(/[/\\:*?"<>|]/g, '·').replace(/\s+/g, ' ').trim().slice(0, limit);
}

// 已经是规范命名的文件（日期 番号 演员.ext 或 番号 演员.ext）跳过，可重复运行。
export const flatPattern = /^(\d{4}-\d{2}-\d{2} )?[A-Z0-9]+-\d{2,5} .+\.(mp4|mkv|wmv|avi|ts|m2ts|mov|rmvb|flv|m4v)$/i;

export function flatName(date: string | null | undefined, number: string, actress: string, ext: string): string {
  return [date || null, number, safeSegment(actress) || unknownActress].filter(Boolean).join(' ') + ext.toLowerCase();
}

// 片库文件名就是元数据：`发行日期 番号 演员.ext`，同番号第二片带 ` (2)`。
const libraryPattern = /^(?:(\d{4}-\d{2}-\d{2}) )?([A-Z0-9]+-\d{2,5}) (.+?)(?: \(\d+\))?\.([A-Za-z0-9]+)$/i;

export interface LibraryName { date: string | null; number: string; actress: string }

export function parseLibraryName(name: string): LibraryName | null {
  const match = libraryPattern.exec(name);
  if (!match) return null;
  // 早期整理把同番号多片写成 `番号 演员 2.ext`，序号不能算进演员名。
  const actress = (match[3] ?? '').replace(/ \d{1,2}$/, '');
  if (!actress) return null;
  return { date: match[1] ?? null, number: (match[2] ?? '').toUpperCase(), actress };
}

// 早期整理把同番号多片写成 `番号 演员 2.ext`，演员名就被污染成「演员 2」。统一改回 `番号 演员 (2).ext`。
export const legacySuffix = /^((?:\d{4}-\d{2}-\d{2} )?[A-Z0-9]+-\d{2,5} .+) (\d{1,2})(\.[A-Za-z0-9]+)$/;

export function legacyRename(name: string): string | null {
  const match = legacySuffix.exec(name);
  return match ? `${match[1]} (${match[2]})${match[3]}` : null;
}
