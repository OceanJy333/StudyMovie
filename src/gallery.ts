// input: teachers feed rows; output: standalone cover gallery HTML; pos: feed rendering.
import type { FeedItem } from './teachers/types.ts';

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(value: string): string {
  return value.replace(/[&<>"']/g, char => ESCAPES[char]);
}
function shortDate(value: string | null): string {
  return value ? value.slice(5) : '--';
}

export function renderGallery(items: FeedItem[], meta: { generatedAt: string; label?: string }): string {
  const rows = items.map(item => {
    const cover = item.cover;
    const image = cover
      ? `<img src="${esc(cover)}" alt="${esc(item.number)}" loading="lazy" referrerpolicy="no-referrer">`
      : '<span class="nophoto">无封面</span>';
    const title = item.title ? esc(item.title) : '（无标题）';
    const magnets = item.magnets === null ? '磁力未知' : item.magnets > 0 ? `${item.magnets} 个磁力` : '无磁力';
    const owner = item.official && item.official !== item.bookmark ? `<span class="dim">${esc(item.official)}</span>` : '';
    return `    <li class="row">
      <a class="shot" href="${esc(item.jable || '#')}" target="_blank" rel="noreferrer">${image}</a>
      <div class="meta">
        <div class="line"><span class="date">${esc(shortDate(item.date))}</span><span class="who">${esc(item.bookmark)}</span><span class="num">${esc(item.number)}</span></div>
        <a class="title" href="${esc(item.jable || '#')}" target="_blank" rel="noreferrer">${title}</a>
        <div class="sub"><span class="${item.magnets ? 'ok' : 'dim'}">${esc(magnets)}</span>${item.duration ? `<span class="dim">${item.duration} 分钟</span>` : ''}${owner}</div>
      </div>
    </li>`;
  }).join('\n');
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>老师新片订阅${meta.label ? ` · ${esc(meta.label)}` : ''}</title>
<style>
  :root { color-scheme: dark; --bg: #101014; --card: #17171d; --line: #26262f; --text: #e8e8ee; --dim: #8b8b9a; --accent: #ff6b9a; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 -apple-system, "Helvetica Neue", "PingFang SC", sans-serif; }
  header { position: sticky; top: 0; backdrop-filter: blur(10px); background: rgba(16,16,20,.86); border-bottom: 1px solid var(--line); padding: 14px 20px; display: flex; align-items: baseline; gap: 12px; }
  h1 { font-size: 17px; margin: 0; }
  header .stamp { color: var(--dim); font-size: 12px; }
  ul { list-style: none; margin: 0; padding: 8px 0 40px; }
  .row { display: grid; grid-template-columns: 132px 1fr; gap: 14px; padding: 12px 20px; border-bottom: 1px solid var(--line); align-items: start; }
  .row:hover { background: var(--card); }
  .shot { display: block; width: 132px; aspect-ratio: 3 / 2; background: #000; border-radius: 8px; overflow: hidden; }
  .shot img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .nophoto { display: flex; width: 100%; height: 100%; align-items: center; justify-content: center; color: var(--dim); font-size: 12px; }
  .meta { min-width: 0; }
  .line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .date { font-variant-numeric: tabular-nums; color: var(--accent); font-weight: 600; }
  .who { font-weight: 600; }
  .num { color: var(--dim); font-family: ui-monospace, SFMono-Regular, monospace; font-size: 12px; }
  .title { display: block; color: var(--text); text-decoration: none; margin: 4px 0 6px; }
  .title:hover { text-decoration: underline; }
  .sub { display: flex; gap: 10px; flex-wrap: wrap; font-size: 12px; }
  .ok { color: #7fd88f; }
  .dim { color: var(--dim); }
</style>
</head>
<body>
<header>
  <h1>老师新片订阅</h1>
  <span class="stamp">${items.length} 部 · 生成于 ${esc(meta.generatedAt)}</span>
</header>
<ul>
${rows}
</ul>
</body>
</html>
`;
}
