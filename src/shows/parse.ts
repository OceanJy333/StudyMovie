// input: 种子标题；output: 季/集/合集范围；pos: 剧集命名解析。

export interface EpisodeInfo {
  season: number | null;
  episode: number | null;
  /** 合集覆盖的集数区间（含两端）。 */
  range: [number, number] | null;
  pack: boolean;
}

const PACK_WORD = /全集|合集|Complete|Batch|全\s*\d+\s*[集话話]/i;

/**
 * 支持 S01E03 / 1x03 / 第3集 / 第3話 / EP03 / [03] / 【03】 / - 03 ，
 * 以及 S01E01-E12、[01-12] 这类合集。解析不到就返回空，不做猜测。
 */
export function parseEpisode(raw: string): EpisodeInfo {
  const text = raw.replace(/\.[a-z0-9]{2,4}$/i, ' ');
  const pack = PACK_WORD.test(text);

  // 合集区间：S01E01-E12 / S01E01-12 / [01-12] / 01~12
  const sxeRange = /s(\d{1,2})[ ._-]*e(\d{1,3})[ ._-]*(?:-|~|至)[ ._-]*e?(\d{1,3})/i.exec(text);
  if (sxeRange) return { season: number(sxeRange[1]), episode: null, range: orderRange(number(sxeRange[2]), number(sxeRange[3])), pack: true };
  const bracketRange = /[[【(](\d{1,3})\s*[-~]\s*(\d{1,3})[\]】)]/.exec(text);
  if (bracketRange) return { season: null, episode: null, range: orderRange(number(bracketRange[1]), number(bracketRange[2])), pack: true };

  const sxe = /\bs(\d{1,2})[ ._-]*e(\d{1,3})\b/i.exec(text);
  if (sxe) return { season: number(sxe[1]), episode: number(sxe[2]), range: null, pack };

  const cross = /(?:^|[^\d])(\d{1,2})x(\d{1,3})(?!\d)/i.exec(text);
  if (cross) return { season: number(cross[1]), episode: number(cross[2]), range: null, pack };

  const seasonWord = /第\s*(\d{1,2})\s*季/.exec(text) ?? /Season\s*(\d{1,2})/i.exec(text);
  const season = seasonWord ? number(seasonWord[1]) : null;

  const cnEpisode = /第\s*(\d{1,3})\s*[集话話期]/.exec(text);
  if (cnEpisode) return { season, episode: number(cnEpisode[1]), range: null, pack };

  const epWord = /(?:^|[^A-Za-z])EP?\.?\s*(\d{1,3})(?!\d)/i.exec(text) ?? /\bEpisode\s*(\d{1,3})\b/i.exec(text);
  if (epWord) return { season, episode: number(epWord[1]), range: null, pack };

  const bracket = /[[【](\d{1,3})[\]】]/.exec(text);
  if (bracket) return { season, episode: number(bracket[1]), range: null, pack };

  // 动画常见 `Show - 03 [1080p]`；只认结尾或方括号前的独立数字，避免把 1080/264 当集数。
  const tail = /(?:^|[\s._-])-\s*(\d{1,3})(?=\s*(?:[[【]|$))/i.exec(text);
  if (tail) return { season, episode: number(tail[1]), range: null, pack };

  return { season, episode: null, range: null, pack };
}

/** 只有季没有集（`S01`、`Season 1`）时返回季号，供订阅过滤。 */
export function parseSeason(text: string): number | null {
  const match = /\bs(\d{1,2})(?![ ._-]*e\d)/i.exec(text) ?? /Season\s*(\d{1,2})/i.exec(text) ?? /第\s*(\d{1,2})\s*季/.exec(text);
  return match ? number(match[1]) : null;
}

function number(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function orderRange(first: number | null, second: number | null): [number, number] | null {
  if (first === null || second === null) return null;
  return first <= second ? [first, second] : [second, first];
}

export function episodeKey(show: string, season: number, episode: number): string {
  return `${show}|S${season}E${episode}`;
}

export function episodeTag(season: number, episode: number): string {
  return `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
}

const QUALITY_TAG = /[[【(][^\]】)]*(?:1080|720|2160|4K|WEB|BluRay|HEVC|AVC|x26[45]|AAC|DDP?|FLAC)[^\]】)]*[\]】)]/gi;
const NOISE = /\b(?:2160p|1080p|720p|480p|4k|uhd|web[-_.]?dl|webrip|web|bluray|bdrip|hdtv|remux|x264|x265|h\.?264|h\.?265|hevc|avc|aac|ac3|ddp?5\.1|10bit|8bit|hdr|dovi|dv)\b/gi;

/** 从目录名里剥掉画质/编码/年份/集数标签，尽量留下剧名。 */
export function cleanShowName(raw: string): string {
  let text = raw.replace(/\.[a-z0-9]{2,4}$/i, ' ').replace(QUALITY_TAG, ' ').replace(NOISE, ' ');
  text = text.replace(/[[【(][^\]】)]*[\]】)]/g, ' ');
  text = text.replace(/\b(?:19|20)\d{2}\b/g, ' ');
  text = text.replace(/\b(?:S\d{1,2}(?:E\d{1,3})?|\d{1,2}x\d{1,3}|EP?\d{1,3})\b/gi, ' ');
  text = text.replace(/(?:^|[\s._-])-\s*\d{1,4}\s*$/g, ' ');
  // 去掉场景发布组后缀（x264-GROUP），只认紧跟在空格后的短横线标记。
  text = text.replace(/\s+-\s*[A-Za-z0-9@]{2,16}$/g, ' ');
  text = text.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
  return text.replace(/^[-–—\s]+|[-–—\s]+$/g, '').slice(0, 80) || '未分类';
}

/** 规范化后逐词匹配；CJK 没有空格，用包含判断。 */
export function matchesShow(text: string, aliases: readonly string[]): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const haystack = ` ${normalize(text)} `;
  return aliases.some(alias => {
    const needle = normalize(alias);
    if (!needle) return false;
    if (/[\u3400-\u9fff]/.test(needle)) return haystack.includes(needle);
    return needle.split(' ').every(word => haystack.includes(` ${word} `));
  });
}
