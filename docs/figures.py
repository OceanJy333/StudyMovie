#!/usr/bin/env python3
"""input: none; output: docs/*.svg README figures; pos: regenerates the README illustrations.

Run `python3 docs/figures.py` after changing a figure. Every SVG carries its own light/dark palette
(prefers-color-scheme), so GitHub renders it correctly in both themes.
"""
from pathlib import Path

OUT = Path(__file__).resolve().parent

STYLE = """<style>
  .bg{fill:#f5f5f4}.card{fill:#ffffff}.box{fill:#ffffff;stroke:#2d3142;stroke-opacity:.32}
  .focal{fill:#fbeee8;stroke:#bf4520;stroke-width:1.5}.dim{fill:#ecebe8;stroke:#2d3142;stroke-opacity:.18}
  .ink{fill:#2d3142}.muted{fill:#5b5f6b}.soft{fill:#7c808c}.acc{fill:#bf4520}
  .line{stroke:#5b5f6b;stroke-width:1.4;fill:none}.aline{stroke:#bf4520;stroke-width:1.8;fill:none}
  .dash{stroke-dasharray:5 4}.rule{stroke:#2d3142;stroke-opacity:.16;fill:none}
  .tag{fill:#2d3142;fill-opacity:.07}.tagacc{fill:#bf4520;fill-opacity:.14}.mask{fill:#f5f5f4}
  .cover{fill:#dcdad5}.cover2{fill:#c9c6bf}.ok{fill:#2f7d4f}
  text{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans","Noto Sans CJK SC",Helvetica,Arial,sans-serif}
  .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
  .t{font-size:22px;font-weight:600}.n{font-size:15px;font-weight:600}.s{font-size:11.5px}.e{font-size:10.5px;letter-spacing:.08em}
  @media (prefers-color-scheme:dark){
    .bg,.mask{fill:#1d1f24}.card{fill:#262930}.box{fill:#262930;stroke:#e9e7e2;stroke-opacity:.30}
    .focal{fill:#3a2620;stroke:#ea7a52}.dim{fill:#2c2f36;stroke:#e9e7e2;stroke-opacity:.16}
    .ink{fill:#f2f0ea}.muted{fill:#b9bcc5}.soft{fill:#9599a5}.acc{fill:#ea7a52}
    .line{stroke:#b9bcc5}.aline{stroke:#ea7a52}.rule{stroke:#e9e7e2}.tag{fill:#e9e7e2}.tagacc{fill:#ea7a52}
    .cover{fill:#3a3d45}.cover2{fill:#464a53}.ok{fill:#5fbf85}
  }
</style>"""

DEFS = """<defs>
  <marker id="{p}a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" class="muted"/></marker>
  <marker id="{p}b" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" class="acc"/></marker>
</defs>"""


def svg(slug, w, h, title, desc, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" '
            f'aria-labelledby="{slug}-title {slug}-desc">\n<title id="{slug}-title">{title}</title>\n'
            f'<desc id="{slug}-desc">{desc}</desc>\n{DEFS.format(p=slug)}\n{STYLE}\n'
            f'<rect class="bg" width="{w}" height="{h}" rx="12"/>\n{body}\n</svg>\n')


def node(x, y, w, h, name, sub, tag=None, kind='box'):
    lines = sub if isinstance(sub, list) else [sub]
    # 框高至少容下标签、名字和全部副标题（底部留 14px）。
    h = max(h, (46 if tag else 22) + 18 + 16 * (len(lines) - 1) + 14)
    out = [f'<rect class="{kind}" x="{x}" y="{y}" width="{w}" height="{h}" rx="6"/>']
    ty = y + 22
    if tag:
        tw = 8 + len(tag) * 7
        out.append(f'<rect class="{"tagacc" if kind == "focal" else "tag"}" x="{x + 12}" y="{y + 10}" width="{tw}" height="16" rx="2"/>')
        out.append(f'<text class="mono e {"acc" if kind == "focal" else "muted"}" x="{x + 16}" y="{y + 22}">{tag}</text>')
        ty = y + 46
    out.append(f'<text class="n ink" x="{x + 12}" y="{ty}">{name}</text>')
    for i, line in enumerate(lines):
        out.append(f'<text class="mono s soft" x="{x + 12}" y="{ty + 18 + i * 16}">{line}</text>')
    return '\n'.join(out)


def path(d, slug, accent=False, dashed=False):
    cls = ('aline' if accent else 'line') + (' dash' if dashed else '')
    return f'<path class="{cls}" d="{d}" marker-end="url(#{slug}{"b" if accent else "a"})"/>'


def label(x, y, text, anchor='middle'):
    w = len(text) * 7 + 10
    left = x - w / 2 if anchor == 'middle' else x - 5
    return (f'<rect class="mask" x="{left}" y="{y - 11}" width="{w}" height="16"/>'
            f'<text class="mono e muted" x="{x if anchor == "middle" else x}" y="{y + 1}" text-anchor="{"middle" if anchor == "middle" else "start"}">{text}</text>')


def title(x, y, eyebrow, text):
    return (f'<text class="mono e soft" x="{x}" y="{y}">{eyebrow}</text>'
            f'<text class="t ink" x="{x}" y="{y + 30}">{text}</text>')


def architecture():
    s = 'architecture'
    b = [title(32, 40, 'OVERVIEW', 'How StudyMovie fits together')]
    # source → core connectors (drawn first, behind boxes)
    b += [path('M252 128 H332 Q340 128 340 136 V218 Q340 226 348 226 H366', s),
          path('M252 224 H296 Q304 224 304 232 V250 Q304 258 312 258 H366', s),
          path('M252 320 H296 Q304 320 304 312 V298 Q304 290 312 290 H366', s, accent=True),
          path('M252 416 H332 Q340 416 340 408 V330 Q340 322 348 322 H366', s, dashed=True)]
    # core → outputs
    b += [path('M588 226 H624 Q632 226 632 218 V168 Q632 160 640 160 H674', s, accent=True),
          path('M588 274 H674', s),
          path('M588 322 H624 Q632 322 632 330 V408 Q632 416 640 416 H674', s),
          path('M790 206 V250', s), path('M790 334 V378', s)]
    b += [label(631, 262, 'RENAME'), label(800, 232, 'DOWNLOAD', 'start'), label(800, 360, 'SCAN', 'start')]
    b += [node(32, 96, 220, 64, 'Browser bookmarks', 'teacher folder → roster', 'INPUT'),
          node(32, 192, 220, 64, 'JavDB App API', 'filmographies by actor id', 'WORKS'),
          node(32, 288, 220, 64, 'javdb.com movie page', 'actresses + magnets', 'METADATA'),
          node(32, 384, 220, 64, 'sukebei RSS', 'fallback magnets by code', 'FALLBACK')]
    b += [node(372, 196, 216, 156, 'StudyMovie', ['teachers auto · 18:00', 'organize · 15:00', 'catalog · 03:00', 'web · :8850'],
               'RUNS ON THE NAS', kind='focal')]
    b += [node(680, 128, 236, 60, 'aria2 / Thunder', 'this computer or NAS', 'DOWNLOAD'),
          node(680, 256, 236, 60, 'Flat library', 'date · code · actress.mp4', 'FILES'),
          node(680, 384, 236, 60, 'Library wall', 'covers · play · 1-click get', 'LAN WEB')]
    b += ['<line class="rule" x1="32" y1="488" x2="916" y2="488"/>',
          '<rect class="focal" x="32" y="504" width="14" height="10" rx="2"/><text class="mono e muted" x="54" y="513">RUNS ON NAS</text>',
          '<line class="aline" x1="170" y1="509" x2="200" y2="509"/><text class="mono e muted" x="208" y="513">PRIMARY PATH</text>',
          '<line class="line dash" x1="330" y1="509" x2="360" y2="509"/><text class="mono e muted" x="368" y="513">FALLBACK</text>']
    return svg(s, 948, 536, 'How StudyMovie fits together',
               'Bookmarks, the JavDB API, javdb.com pages and sukebei feed StudyMovie, which submits to aria2 or Thunder, renames files into a flat library and serves a library wall.',
               '\n'.join(b))


def schedule():
    s = 'schedule'
    x0, x1, y = 48, 900, 150
    hx = lambda h: x0 + (x1 - x0) * h / 24
    b = [title(32, 40, 'DAILY TIMERS', 'One NAS, five systemd timers'),
         f'<line class="rule" x1="{x0}" y1="{y}" x2="{x1}" y2="{y}" style="stroke-opacity:.5"/>']
    for h in range(0, 25, 3):
        if h == 15:  # organize 的引线从这里往下走，不画刻度字
            continue
        b.append(f'<line class="rule" x1="{hx(h)}" y1="{y - 4}" x2="{hx(h)}" y2="{y + 4}" style="stroke-opacity:.5"/>'
                 f'<text class="mono e soft" x="{hx(h)}" y="{y + 22}" text-anchor="middle">{h:02d}:00</text>')
    events = [(3, 'catalog', 'full filmographies', 'up'), (4, 'shows check', 'new TV episodes', 'down'),
              (8, 'shows organize', 'Show/Season 01', 'up'), (15, 'organize', 'rename + flatten', 'down'),
              (18, 'teachers auto', 'download new works', 'up'), (20, 'shows organize', 'second pass', 'down')]
    for h, name, sub, side in events:
        cx = hx(h)
        focal = name == 'teachers auto'
        dot = f'<circle cx="{cx}" cy="{y}" r="{6 if focal else 4.5}" class="{"acc" if focal else "ink"}"/>'
        ty = y - 52 if side == 'up' else y + 56
        b.append(f'<line class="{"aline" if focal else "line"}" x1="{cx}" y1="{y}" x2="{cx}" y2="{ty + (14 if side == "up" else -18)}"/>')
        b.append(dot)
        b.append(f'<text class="n {"acc" if focal else "ink"}" x="{cx}" y="{ty}" text-anchor="middle">{name}</text>'
                 f'<text class="mono s soft" x="{cx}" y="{ty + 16}" text-anchor="middle">{sub}</text>')
    b.append(f'<text class="mono s soft" x="32" y="{y + 104}">Plus a resident library wall on :8850.</text>')
    return svg(s, 948, 282, 'StudyMovie daily schedule',
               'Timers run catalog at 03:00, show checks at 04:00, show archiving at 08:00 and 20:00, library organizing at 15:00 and teacher downloads at 18:00.',
               '\n'.join(b))


def magnets():
    s = 'magnets'
    b = [title(32, 40, 'MAGNET SOURCES', 'Two sources, checked only when a torrent is likely')]
    b += [path('M172 148 H226', s), path('M372 148 H426', s, accent=True), path('M602 136 H656', s, accent=True),
          path('M812 148 H866', s, accent=True), path('M302 194 V242', s), path('M517 194 V242', s, dashed=True),
          path('M602 264 H624 Q632 264 632 256 V170 Q632 162 640 162 H656', s, dashed=True),
          path('M602 290 H656', s, dashed=True)]
    b += [label(399, 136, 'DUE'), label(629, 124, 'FOUND'), label(312, 222, 'NOT DUE', 'start'),
          label(527, 222, 'NONE / ERROR', 'start')]
    b += [node(32, 116, 140, 64, 'New work', 'from the pool', 'POOL'),
          node(232, 116, 140, 64, 'Due today?', 'by release date', 'RULE'),
          node(432, 116, 170, 64, 'javdb.com page', '~1.3 pages / sec', 'PRIMARY', kind='focal'),
          node(662, 116, 150, 64, 'Pick the best', 'full, smaller first', 'CHOOSE'),
          node(872, 116, 136, 64, 'Submit', 'to downloader', 'DONE'),
          node(232, 248, 140, 64, 'Wait', 'not checked today', 'SKIP', kind='dim'),
          node(432, 248, 170, 64, 'sukebei RSS', '&lt; 1 request / sec', 'FALLBACK'),
          node(662, 248, 150, 64, 'No torrent yet', 'retry on schedule', 'LATER', kind='dim')]
    b += ['<line class="rule" x1="32" y1="350" x2="1008" y2="350"/>',
          '<text class="mono s soft" x="32" y="376">Schedule: from 1 day before release, daily for 14 days, then weekly. Unreleased works are not queried.</text>']
    return svg(s, 1040, 400, 'Magnet lookup with two sources',
               'For each due work StudyMovie reads magnets from the javdb.com movie page and falls back to sukebei; unreleased or recently checked works are skipped.',
               '\n'.join(b))


def naming():
    s = 'naming'
    xs = [32 + i * 212 for i in range(5)]
    b = [title(32, 40, 'ORGANIZE', 'From a messy download to a library name')]
    for i in range(4):
        b.append(path(f'M{xs[i] + 168} 150 H{xs[i + 1] - 6}', s, accent=i == 3))
    b += [node(xs[0], 112, 168, 76, 'Download', ['hhd800.com@', 'ABC123ch.mp4'], 'INPUT'),
          node(xs[1], 112, 168, 76, 'Code', ['ABC-123', 'ranked candidates'], 'PARSE'),
          node(xs[2], 112, 168, 76, 'JavDB id', ['catalog cache or', 'page-jump search'], 'LOOKUP'),
          node(xs[3], 112, 168, 76, 'Actresses', ['actor-female only', 'main star first'], 'MOVIE PAGE'),
          node(xs[4], 112, 228, 76, 'Library file', ['2026-09-10 ABC-123', 'Actress A、Actress B.mp4'], 'OUTPUT', kind='focal')]
    b += ['<line class="rule" x1="32" y1="232" x2="1108" y2="232"/>',
          '<text class="mono s soft" x="32" y="258">Up to 4 names, then 等. Unknown or undated files are re-checked every run; renames are logged for rollback.</text>']
    return svg(s, 1140, 280, 'How organize names a file',
               'A download name is parsed into a code, matched to a JavDB id, enriched with the female cast from the movie page and renamed to date, code and actresses.',
               '\n'.join(b))


def wall():
    s = 'wall'
    b = [title(32, 40, 'LAN WEB', 'The library wall (illustration)'),
         '<rect class="card" x="32" y="84" width="884" height="404" rx="10" style="stroke:#7c808c;stroke-opacity:.35"/>',
         '<circle cx="54" cy="104" r="5" class="cover2"/><circle cx="72" cy="104" r="5" class="cover2"/><circle cx="90" cy="104" r="5" class="cover2"/>',
         '<rect class="dim" x="120" y="94" width="300" height="20" rx="10"/><text class="mono s soft" x="134" y="108">nas.local:8850</text>',
         '<line class="rule" x1="32" y1="124" x2="916" y2="124"/>',
         '<rect class="dim" x="52" y="140" width="260" height="30" rx="15"/><text class="s soft" x="70" y="159">Search code, actress, title…</text>']
    chips = [('All', True), ('Downloaded', False), ('Missing', False), ('Actress A', False), ('Actress B', False), ('Actress C', False)]
    x = 332
    for text, on in chips:
        w = len(text) * 7.2 + 28
        b.append(f'<rect class="{"focal" if on else "dim"}" x="{x}" y="140" width="{w}" height="30" rx="15"/>'
                 f'<text class="s {"acc" if on else "muted"}" x="{x + w / 2}" y="159" text-anchor="middle">{text}</text>')
        x += w + 8
    codes = ['ABC-123', 'ABC-118', 'XYZ-045', 'DEF-210', 'ABC-101', 'XYZ-031', 'GHI-007', 'DEF-188', 'ABC-097', 'XYZ-022']
    for i, code in enumerate(codes):
        col, row = i % 5, i // 5
        cx, cy = 52 + col * 172, 188 + row * 146
        have = i not in (2, 7, 9)
        b.append(f'<rect class="{"cover" if i % 2 else "cover2"}" x="{cx}" y="{cy}" width="156" height="98" rx="6"/>')
        b.append(f'<text class="mono s ink" x="{cx}" y="{cy + 118}">{code}</text>'
                 f'<text class="s muted" x="{cx}" y="{cy + 134}">Actress {"ABC"[i % 3]}</text>')
        badge = ('Local', 'ok') if have else ('Get', 'acc')
        b.append(f'<rect class="card" x="{cx + 104}" y="{cy + 8}" width="44" height="18" rx="9"/>'
                 f'<text class="mono e {badge[1]}" x="{cx + 126}" y="{cy + 21}" text-anchor="middle">{badge[0]}</text>')
    return svg(s, 948, 516, 'Library wall illustration',
               'A browser page with a search box, filter chips and a grid of cover placeholders marked local or downloadable.',
               '\n'.join(b))


for name, build in [('architecture', architecture), ('schedule', schedule), ('magnets', magnets), ('naming', naming), ('wall', wall)]:
    (OUT / f'{name}.svg').write_text(build(), encoding='utf-8')
    print('wrote', name)
