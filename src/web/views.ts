// input: 墙条目与统计；output: 影片墙 / 演员墙 HTML；pos: 影片墙视图。
import { esc } from '../core/text.ts';
import { sharedStyle } from './style.ts';
import { groupByActress, wallCounts, type WallItem } from './wall.ts';

export function renderIndex(counts: ReturnType<typeof wallCounts>, actresses: readonly string[]): string {
  const options = actresses.map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join('');
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>片库 · ${counts.downloaded} / ${counts.total}</title>
<style>${sharedStyle}
  #player { position:fixed; inset:0; z-index:50; display:none; background:rgba(6,6,9,.96); }
  #player.on { display:flex; flex-direction:column; }
  #bar { display:flex; gap:12px; align-items:center; padding:10px 16px; border-bottom:1px solid var(--line); }
  #bar .title { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px; }
  #stage { flex:1; display:flex; align-items:center; justify-content:center; min-height:0; padding:12px; }
  video { max-width:100%; max-height:100%; background:#000; border-radius:6px; }
  button, a.dl { background:#22222c; color:var(--text); border:1px solid var(--line); border-radius:8px;
           padding:6px 12px; font-size:13px; cursor:pointer; text-decoration:none; }
  button:hover { border-color:#3a3a48; }
  a.dl { color:var(--dim); }
  a.dl:hover { color:var(--text); }
  #toast { position:fixed; left:50%; bottom:26px; transform:translateX(-50%) translateY(20px); z-index:80;
           background:#26262f; border:1px solid var(--line); border-radius:10px; padding:10px 16px; font-size:13px;
           opacity:0; transition:opacity .18s ease, transform .18s ease; pointer-events:none; max-width:80vw; }
  #toast.on { opacity:1; transform:translateX(-50%) translateY(0); }
  #sentinel { height:1px; }
</style>
</head>
<body>
<header>
  <h1>片库<small id="stat"></small></h1>
  <input id="q" type="search" placeholder="搜番号 / 演员 / 标题…" autocomplete="off">
  <select id="who"><option value="">全部演员</option>${options}</select>
  <div class="seg" id="mode">
    <button data-m="all" class="on">全部</button>
    <button data-m="have">已下载</button>
    <button data-m="miss">未下载</button>
  </div>
  <select id="sort"><option value="date">按发行日期</option><option value="added">按归档时间</option></select>
  <span class="spacer"></span>
  <a class="nav" href="/actresses">演员墙</a>
  <a class="nav" href="/shows">剧集</a>
  <span id="count" style="color:var(--dim);font-size:12px"></span>
</header>
<div id="grid"></div>
<div id="sentinel"></div>
<div id="empty" hidden></div>
<div id="player">
  <div id="bar">
    <span class="num" id="pnum"></span>
    <span class="title" id="ptitle"></span>
    <a class="dl" id="pdl" href="#" download>下载</a>
    <button id="pclose">关闭</button>
  </div>
  <div id="stage"><video id="video" controls playsinline preload="metadata"></video></div>
</div>
<div id="toast"></div>
<script>
(function () {
  var items = [], view = [], shown = 0, who = '', sort = 'date', mode = 'all';
  var CHUNK = 120;
  var grid = document.getElementById('grid'), q = document.getElementById('q');
  var empty = document.getElementById('empty'), count = document.getElementById('count');
  var preset = new URLSearchParams(location.search).get('who');
  if (preset) { who = preset; document.getElementById('who').value = preset; }

  // /api/items 用短数组传，字段顺序固定（见 server.ts 的 compactItem），这里还原成对象。
  function restore(a) {
    return { number:a[0], date:a[1], actress:a[2], title:a[3], downloaded:!!a[4], sizeBytes:a[5], addedAt:a[6],
      file:a[7], magnets:a[8], submitted:!!a[9], bd:!!a[10],
      cover:a[11] ? '/cover/' + encodeURIComponent(a[0]) + '.jpg' : null };
  }
  function fmt(n) { var g = n / 1073741824; return g >= 1 ? g.toFixed(2) + ' GB' : Math.round(n / 1048576) + ' MB'; }
  function isNew(it) { return it.addedAt && (Date.now() - new Date(it.addedAt).getTime()) < 7 * 86400000; }
  function media(it) { return '/media/' + encodeURIComponent(it.file); }
  function toast(msg) {
    var el = document.getElementById('toast');
    el.textContent = msg; el.classList.add('on');
    clearTimeout(el._t); el._t = setTimeout(function () { el.classList.remove('on'); }, 2600);
  }

  function apply() {
    var term = q.value.trim().toLowerCase();
    view = items.filter(function (it) {
      if (who && it.actress.replace(/等$/, '').split('、').indexOf(who) < 0) return false;
      if (mode === 'have' && !it.downloaded) return false;
      if (mode === 'miss' && it.downloaded) return false;
      if (!term) return true;
      return (it.number + ' ' + it.actress + ' ' + (it.title || '')).toLowerCase().indexOf(term) >= 0;
    });
    if (sort === 'added') {
      view = view.slice().sort(function (a, b) { return (b.addedAt || '').localeCompare(a.addedAt || ''); });
    }
    var have = 0;
    for (var i = 0; i < view.length; i++) if (view[i].downloaded) have++;
    count.textContent = view.length + ' / ' + items.length + '（已下 ' + have + '）';
    grid.innerHTML = ''; shown = 0;
    empty.hidden = view.length > 0;
    empty.textContent = view.length ? '' : '没有匹配的片子';
    more();
  }

  function card(it) {
    var shot = it.cover ? '<img loading="lazy" src="' + it.cover + '" alt="">' : '<div class="ph">' + it.number + '</div>';
    var badge = it.downloaded ? '<span class="badge ok">已下载</span>'
      : it.submitted ? '<span class="badge wait">等下载</span>'
      : (it.magnets > 0 ? '<span class="badge">' + it.magnets + ' 磁力</span>' : '<span class="badge">无磁力</span>');
    var sub = it.downloaded
      ? '<span>' + (it.date || '日期未知') + '</span><span>' + fmt(it.sizeBytes) + '</span>'
      : '<span>' + (it.date || '日期未知') + '</span><span>' + (it.bd ? 'BD版 · ' : '') + (it.magnets > 0 ? '点击下载' : '没有磁力') + '</span>';
    return '<article class="card ' + (it.downloaded ? '' : 'miss dl') + '" data-num="' + it.number + '"'
      + ' data-dl="' + (it.downloaded ? '0' : '1') + '">'
      + '<div class="shot">' + shot + (isNew(it) ? '<span class="new">NEW</span>' : '') + badge + '</div>'
      + '<div class="cap"><span class="num">' + it.number + '</span><span class="who">' + it.actress + '</span></div>'
      + '<div class="sub">' + sub + '</div>'
      + (it.title ? '<div class="sub"><span class="t">' + it.title + '</span></div>' : '')
      + '</article>';
  }

  function more() {
    if (shown >= view.length) return;
    var end = Math.min(shown + CHUNK, view.length), html = '';
    for (var i = shown; i < end; i++) html += card(view[i]);
    grid.insertAdjacentHTML('beforeend', html);
    shown = end;
  }

  new IntersectionObserver(function (rows) {
    if (rows[0].isIntersecting) more();
  }, { rootMargin: '600px' }).observe(document.getElementById('sentinel'));

  function markSubmitted(card) {
    card.dataset.state = 'done';
    var b = card.querySelector('.badge');
    if (b) { b.className = 'badge wait'; b.textContent = '等下载'; }
    var subs = card.querySelectorAll('.sub');
    if (subs.length && subs[0].lastElementChild) subs[0].lastElementChild.textContent = '已提交迅雷';
  }
  function download(num, card) {
    card.dataset.state = 'pending';
    toast('提交下载 ' + num + ' …');
    fetch('/api/download', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ number: num }) })
      .then(function (r) { return r.json().then(function (body) { return { ok: r.ok, body: body }; }); })
      .then(function (res) {
        if (!res.ok) { card.dataset.state = 'idle'; toast(num + ' 失败：' + (res.body.error || '未知原因')); return; }
        markSubmitted(card);
        toast(res.body.action === 'existing' ? (num + ' 已经在迅雷里了') : (num + ' 已提交迅雷'));
      })
      .catch(function (e) { card.dataset.state = 'idle'; toast(num + ' 提交失败：' + e.message); });
  }

  grid.addEventListener('click', function (e) {
    var card = e.target.closest('.card'); if (!card) return;
    var num = card.dataset.num;
    if (card.dataset.dl === '1') {
      if (card.dataset.state === 'pending' || card.dataset.state === 'done') return;
      var pending = items.filter(function (x) { return x.number === num && !x.downloaded; })[0];
      if (pending && pending.magnets === 0) { toast(num + ' 没有可用磁力'); return; }
      download(num, card);
      return;
    }
    var local = items.filter(function (x) { return x.number === num && x.downloaded; })[0];
    if (local) open(local);
  });

  function open(it) {
    var v = document.getElementById('video');
    document.getElementById('pnum').textContent = it.number + ' · ' + it.actress;
    document.getElementById('ptitle').textContent = it.title || it.file;
    document.getElementById('pdl').href = media(it) + '?dl=1';
    v.src = media(it);
    if (it.cover) v.poster = it.cover; else v.removeAttribute('poster');
    document.getElementById('player').classList.add('on');
    v.play().catch(function () {});
  }
  function close() {
    var v = document.getElementById('video');
    v.pause(); v.removeAttribute('src'); v.load();
    document.getElementById('player').classList.remove('on');
  }

  q.addEventListener('input', apply);
  document.getElementById('who').addEventListener('change', function (e) { who = e.target.value; apply(); });
  document.getElementById('sort').addEventListener('change', function (e) { sort = e.target.value; apply(); });
  document.getElementById('mode').addEventListener('click', function (e) {
    var btn = e.target.closest('button'); if (!btn) return;
    mode = btn.dataset.m;
    Array.prototype.forEach.call(document.querySelectorAll('#mode button'), function (b) { b.classList.toggle('on', b === btn); });
    apply();
  });
  document.getElementById('pclose').addEventListener('click', close);
  document.addEventListener('keydown', function (e) {
    if (!document.getElementById('player').classList.contains('on')) return;
    if (e.key === 'Escape') close();
  });

  fetch('/api/items').then(function (r) { return r.json(); }).then(function (data) {
    items = data.items.map(restore);
    var c = data.counts;
    document.getElementById('stat').textContent = c.downloaded + ' 部已下载 · ' + (c.totalBytes / 1073741824).toFixed(1)
      + ' GB · 共 ' + c.total + ' 部 · 缺 ' + c.missing + (c.multi ? ' · 已排除 ' + c.multi + ' 部拼盘' : '');
    apply();
  }).catch(function () { grid.innerHTML = '<p style="color:#8a8a99;padding:20px">读取片库失败</p>'; });
})();
</script>
</body>
</html>`;
}

export function renderActressWall(items: readonly WallItem[], meta: { unknownCount: number }): string {
  const groups = groupByActress(items);
  let totalBytes = 0, downloaded = 0;
  for (const item of items) {
    if (item.downloaded) { downloaded++; totalBytes += item.sizeBytes; }
  }
  const cards = groups.map(group => {
    const shot = group.cover
      ? `<img loading="lazy" src="${group.cover}" alt="">`
      : `<div class="ph">${esc(group.name.slice(0, 1))}</div>`;
    return `<a class="card" href="/?who=${encodeURIComponent(group.name)}" data-name="${esc(group.name)}">
      <div class="shot">${shot}<span class="cnt">${group.count}/${group.total}</span></div>
      <div class="cap"><span class="who">${esc(group.name)}</span><span class="gb">${(group.totalBytes / 2 ** 30).toFixed(1)} GB</span></div>
    </a>`;
  }).join('\n');
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>演员墙 · ${groups.length} 位</title>
<style>${sharedStyle}
  #grid { grid-template-columns:repeat(auto-fill,minmax(158px,1fr)); }
  .card { text-decoration:none; color:inherit; }
  .card:hover { transform:translateY(-2px); }
  .ph { font-size:34px; }
  .cnt { position:absolute; right:6px; top:6px; background:rgba(10,10,14,.78); color:var(--text);
         font-size:11px; font-weight:700; padding:2px 7px; border-radius:999px; font-variant-numeric:tabular-nums; }
  .cap { justify-content:space-between; }
  .gb { color:var(--dim); font-size:11px; font-variant-numeric:tabular-nums; white-space:nowrap; }
  @media (max-width:560px) { #grid { grid-template-columns:repeat(auto-fill,minmax(120px,1fr)); } }
</style>
</head>
<body>
<header>
  <h1>演员墙<small>${groups.length} 位 · 已下 ${downloaded} / 共 ${items.length} 部 · ${(totalBytes / 2 ** 30).toFixed(1)} GB${meta.unknownCount ? ` · ${meta.unknownCount} 部未标注` : ''}</small></h1>
  <input id="q" type="search" placeholder="搜演员…" autocomplete="off">
  <span class="spacer"></span>
  <a class="nav" href="/">全部影片</a>
  <a class="nav" href="/shows">剧集</a>
</header>
<div id="grid">
${cards}
</div>
<div id="empty" hidden>没有匹配的演员</div>
<script>
(function () {
  var q = document.getElementById('q'), grid = document.getElementById('grid'), empty = document.getElementById('empty');
  var cards = Array.prototype.slice.call(grid.querySelectorAll('.card'));
  q.addEventListener('input', function () {
    var term = q.value.trim().toLowerCase(), shown = 0;
    for (var i = 0; i < cards.length; i++) {
      var hit = !term || cards[i].dataset.name.toLowerCase().indexOf(term) >= 0;
      cards[i].hidden = !hit;
      if (hit) shown++;
    }
    empty.hidden = shown > 0;
  });
})();
</script>
</body>
</html>`;
}
