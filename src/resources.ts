// input: movie resource rows; output: ranked candidates; pos: resource selection rules.
export interface Resource {
  title: string;
  magnet: string;
  detail: string;
  sizeGB: number;
  seeds: number | null;
  peers?: number | null;
}

export function infoHash(magnet: string): string {
  const match = magnet.match(/[?&]xt=urn:btih:([a-f\d]{40}|[a-z2-7]{32})(?:&|$)/i);
  if (!match) throw new Error('需要包含有效 BTIH 的 magnet 链接');
  if (match[1].length === 40) return match[1].toLowerCase();
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...match[1].toUpperCase()].map(c => alphabet.indexOf(c).toString(2).padStart(5, '0')).join('');
  return bits.match(/.{8}/g)!.map(b => parseInt(b, 2).toString(16).padStart(2, '0')).join('');
}

export function features(title: string) {
  return {
    dv: /(?:^|[\s.\[\]_-])(?:DV|DoVi)(?:$|[\s.\[\]_-])|Dolby[ ._-]*Vision|杜比视界/i.test(title),
    uhd: /2160p|\b4K\b/i.test(title),
    remux: /remux/i.test(title),
    chinese: /中文|中字|简繁|简英|中英|CHS|CHT/i.test(title),
    altered: /AI[ ._-]*Enhanced|60fps|120fps|RIFE|补帧/i.test(title),
  };
}

export interface SelectionOptions { dv?: boolean; chinese?: boolean; maxSizeGB?: number }

export function assessment(resource: Resource) {
  const f = features(resource.title);
  const seeds = resource.seeds;
  // Log scaling keeps a huge reported swarm from dominating picture quality.
  const availability = seeds === null ? 0 : seeds === 0 ? -15
    : 40 * Math.min(1, Math.log2(seeds + 1) / Math.log2(101));
  const quality = f.remux ? 35 : /BluRay|BDRip/i.test(resource.title) ? 29
    : /WEB[ ._-]*(?:DL|Rip)/i.test(resource.title) ? 23 : 18;
  const compactness = 25 * 20 / (20 + resource.sizeGB);
  return {
    score: Math.round((availability + quality + compactness) * 10) / 10,
    reasons: [seeds === null ? '做种数未知' : `来源报告 ${seeds} 个做种`,
      resource.peers == null ? 'Peers 数未知' : `来源报告 Peers ${resource.peers}`,
      f.remux ? 'REMUX 原盘封装' : /BluRay|BDRip/i.test(resource.title) ? '蓝光压制' : '网络版或来源未标明',
      `${resource.sizeGB.toFixed(2)} GiB`, f.chinese ? '标题标注中文字幕' : '标题未标注中文字幕'],
  };
}

export function rankResources(resources: Resource[], options: SelectionOptions = {}) {
  if (options.maxSizeGB !== undefined && (!Number.isFinite(options.maxSizeGB) || options.maxSizeGB <= 0)) {
    throw new Error('体积上限必须是大于 0 的 GiB 数值');
  }
  return resources.filter(r => {
    const f = features(r.title);
    return f.uhd && !f.altered && (!options.dv || f.dv) && (!options.chinese || f.chinese)
      && (options.maxSizeGB === undefined || r.sizeGB <= options.maxSizeGB);
  }).sort((a, b) => assessment(b).score - assessment(a).score
    || (b.seeds ?? -1) - (a.seeds ?? -1) || a.sizeGB - b.sizeGB);
}
