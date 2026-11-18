// input: 剧集库 + 订阅；output: 剧集墙 / 剧集详情 HTML；pos: 剧集视图。
import { esc, formatBytes } from "../core/text.js";
import { sharedStyle } from "./style.js";
function posterClass(name) {
    let sum = 0;
    for (const char of name)
        sum += char.codePointAt(0) ?? 0;
    return `p${sum % 6}`;
}
function seasonCount(item) {
    return new Set(item.episodes.map(episode => episode.season)).size;
}
function card(item) {
    const seasons = seasonCount(item);
    return `<a class="card show" href="/shows?name=${encodeURIComponent(item.name)}">
    <div class="poster ${posterClass(item.name)}"><span>${esc(item.name)}</span>
      <em>${item.episodes.length ? `${item.episodes.length} 集` : '待更新'}</em></div>
    <div class="cap"><span class="who">${esc(item.name)}</span></div>
    <div class="sub"><span>${seasons ? `${seasons} 季` : '暂无文件'}</span><span>${item.totalBytes ? formatBytes(item.totalBytes) : '—'}</span></div>
  </a>`;
}
export function renderShows(items, subscriptions, meta) {
    const totalBytes = items.reduce((sum, item) => sum + item.totalBytes, 0);
    const totalEpisodes = items.reduce((sum, item) => sum + item.episodes.length, 0);
    const pending = subscriptions.filter(subscription => subscription.enabled && !items.some(item => item.name === subscription.name));
    return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>剧集 · ${items.length + pending.length} 部</title>
<style>${sharedStyle}
  #grid { grid-template-columns:repeat(auto-fill,minmax(168px,1fr)); }
  .card.show { text-decoration:none; color:inherit; }
  .card.show:hover { transform:translateY(-2px); }
  .poster { position:relative; aspect-ratio:2/3; display:flex; align-items:flex-end; padding:12px;
            font-size:18px; font-weight:700; line-height:1.25; text-shadow:0 1px 8px rgba(0,0,0,.7); }
  .poster span { position:relative; z-index:1; overflow:hidden; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; }
  .poster em { position:absolute; top:8px; right:8px; font-style:normal; font-size:11px; font-weight:600;
               background:rgba(10,10,14,.72); padding:2px 7px; border-radius:999px; }
  .p0 { background:linear-gradient(160deg,#3b1f2b,#7a3050); }
  .p1 { background:linear-gradient(160deg,#1f2b3b,#305f7a); }
  .p2 { background:linear-gradient(160deg,#2b3b1f,#5f7a30); }
  .p3 { background:linear-gradient(160deg,#3b331f,#7a6530); }
  .p4 { background:linear-gradient(160deg,#2b1f3b,#5a307a); }
  .p5 { background:linear-gradient(160deg,#1f3b36,#307a6a); }
  .cap { justify-content:space-between; }
  .sub { gap:10px; }
  .tag { color:var(--dim); font-size:12px; }
  .hint { color:var(--dim); font-size:13px; padding:36px 18px; line-height:1.9; }
  .hint code { background:#1c1c24; border:1px solid var(--line); border-radius:6px; padding:2px 6px; font-size:12px; }
  .subs { padding:0 18px 8px; display:flex; gap:8px; flex-wrap:wrap; }
  .subs span { border:1px solid var(--line); border-radius:999px; padding:3px 10px; font-size:12px; color:var(--dim); }
  #detail { padding:16px 18px 60px; max-width:900px; }
  .ep { display:flex; gap:12px; align-items:center; padding:9px 0; border-bottom:1px solid var(--line); font-size:13px; }
  .ep .tag { font-family:ui-monospace,monospace; color:var(--accent); min-width:76px; }
  .ep .size { color:var(--dim); font-variant-numeric:tabular-nums; }
  .ep button { margin-left:auto; }
  #player { position:fixed; inset:0; z-index:50; display:none; background:rgba(6,6,9,.96); flex-direction:column; }
  #player.on { display:flex; }
  #player #bar { display:flex; gap:12px; align-items:center; padding:10px 16px; border-bottom:1px solid var(--line); }
  #player #bar .title { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px; }
  #stage { flex:1; display:flex; align-items:center; justify-content:center; min-height:0; padding:12px; }
  video { max-width:100%; max-height:100%; background:#000; border-radius:6px; }
</style>
</head>
<body>
<header>
  <h1>剧集<small>${items.length + pending.length} 部 · ${totalEpisodes} 集 · ${formatBytes(totalBytes)}${meta.lastCheck ? ` · 上次检查 ${meta.lastCheck.slice(0, 16).replace('T', ' ')}` : ''}</small></h1>
  <span class="spacer"></span>
  <a class="nav" href="/">影片库</a>
  <a class="nav" href="/actresses">演员墙</a>
</header>
<div class="subs">${subscriptions.map(subscription => `<span>${esc(subscription.name)}${subscription.season ? ` S${subscription.season}` : ''} · ${subscription.kind === 'anime' ? '番剧' : '剧集'}</span>`).join('')}</div>
<div id="grid">
${items.length + pending.length === 0 ? `<p class="hint">还没有剧集订阅。在 Mac 上运行
  <code>nas-movie shows add 幕府将军 --query Shogun --season 1</code>，再 <code>./deploy-nas.sh</code> 同步到 NAS。
  每天 04:00 会自动检查新集，也可以手动 <code>shows check --apply</code>。</p>` : ''}
${items.map(card).join('\n')}
${pending.map(item => `<a class="card show" href="/shows?name=${encodeURIComponent(item.name)}">
  <div class="poster ${posterClass(item.name)}"><span>${esc(item.name)}</span><em>待更新</em></div>
  <div class="cap"><span class="who">${esc(item.name)}</span></div>
  <div class="sub"><span>订阅中</span><span>—</span></div>
</a>`).join('\n')}
</div>
<script>
(function () {
  var q = document.querySelector('header');
  if (q) q.dataset.ready = '1';
})();
</script>
</body>
</html>`;
}
export function renderShowDetail(item, subscription) {
    const episodes = item.episodes.map(episode => `<div class="ep">
    <span class="tag">S${String(episode.season).padStart(2, '0')}E${String(episode.episode).padStart(2, '0')}</span>
    <span class="size">${formatBytes(episode.sizeBytes)}</span>
    <span class="tag">${episode.addedAt.slice(0, 10)}</span>
    <button data-src="/shows-media/${episode.file.split('/').map(encodeURIComponent).join('/')}" data-label="S${String(episode.season).padStart(2, '0')}E${String(episode.episode).padStart(2, '0')}">播放</button>
  </div>`).join('\n');
    return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(item.name)} · 剧集</title>
<style>${sharedStyle}
  #detail { padding:16px 18px 60px; max-width:900px; }
  .ep { display:flex; gap:12px; align-items:center; padding:9px 0; border-bottom:1px solid var(--line); font-size:13px; }
  .ep .tag { font-family:ui-monospace,monospace; color:var(--accent); min-width:76px; }
  .ep .size { color:var(--dim); font-variant-numeric:tabular-nums; }
  .ep button { margin-left:auto; }
  #player { position:fixed; inset:0; z-index:50; display:none; background:rgba(6,6,9,.96); flex-direction:column; }
  #player.on { display:flex; }
  #player #bar { display:flex; gap:12px; align-items:center; padding:10px 16px; border-bottom:1px solid var(--line); }
  #player #bar .title { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px; }
  #stage { flex:1; display:flex; align-items:center; justify-content:center; min-height:0; padding:12px; }
  video { max-width:100%; max-height:100%; background:#000; border-radius:6px; }
</style>
</head>
<body>
<header>
  <h1>${esc(item.name)}<small>${item.episodes.length} 集 · ${formatBytes(item.totalBytes)}${subscription ? ` · ${subscription.kind === 'anime' ? '番剧' : '剧集'}订阅` : ''}</small></h1>
  <span class="spacer"></span>
  <a class="nav" href="/shows">全部剧集</a>
  <a class="nav" href="/">影片库</a>
</header>
<div id="detail">${episodes || '<p style="color:#8a8a99">还没有文件</p>'}</div>
<div id="player">
  <div id="bar"><span class="title" id="ptitle"></span><button id="pclose">关闭</button></div>
  <div id="stage"><video id="video" controls playsinline preload="metadata"></video></div>
</div>
<script>
(function () {
  var player = document.getElementById('player'), video = document.getElementById('video');
  document.querySelectorAll('.ep button').forEach(function (button) {
    button.addEventListener('click', function () {
      document.getElementById('ptitle').textContent = '${esc(item.name)} ' + button.dataset.label;
      video.src = button.dataset.src;
      player.classList.add('on');
      video.play().catch(function () {});
    });
  });
  document.getElementById('pclose').addEventListener('click', close);
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && player.classList.contains('on')) close();
  });
  function close() {
    video.pause(); video.removeAttribute('src'); video.load();
    player.classList.remove('on');
  }
})();
</script>
</body>
</html>`;
}
