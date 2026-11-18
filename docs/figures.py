#!/usr/bin/env python3
"""input: none; output: docs/*.svg（中文，默认 README 用）和 docs/en/*.svg（英文 README 用）；pos: regenerates the README illustrations.

Run `python3 docs/figures.py` after changing a figure. Each text is written once as L(english, chinese). Every SVG carries its own light/dark palette
(prefers-color-scheme), so GitHub renders it correctly in both themes.
"""
from pathlib import Path

OUT = Path(__file__).resolve().parent
LANG = 'zh'


def L(en, zh):
    return zh if LANG == 'zh' else en


def width(text, size):
    """估算文字宽度：中日文字符按一个字号宽，其余按 0.62 个字号。"""
    return sum(size if ord(ch) > 0x2E80 else size * 0.62 for ch in text)

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
        tw = 10 + width(tag, 10.5)
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
    w = width(text, 10.5) + 12
    left = x - w / 2 if anchor == 'middle' else x - 5
    return (f'<rect class="mask" x="{left}" y="{y - 11}" width="{w}" height="16"/>'
            f'<text class="mono e muted" x="{x if anchor == "middle" else x}" y="{y + 1}" text-anchor="{"middle" if anchor == "middle" else "start"}">{text}</text>')


def title(x, y, eyebrow, text):
    return (f'<text class="mono e soft" x="{x}" y="{y}">{eyebrow}</text>'
            f'<text class="t ink" x="{x}" y="{y + 30}">{text}</text>')


def architecture():
    s = 'architecture'
    b = [title(32, 40, L('OVERVIEW', '总览'), L('How StudyMovie fits together', 'StudyMovie 怎么运转'))]
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
    b += [label(631, 262, L('RENAME', '改名')), label(800, 232, L('DOWNLOAD', '下载完成'), 'start'), label(800, 360, L('SCAN', '扫描'), 'start')]
    b += [node(32, 96, 220, 64, L('Browser bookmarks', '浏览器书签'), L('teacher folder → roster', '演员文件夹 → 名册'), L('INPUT', '输入')),
          node(32, 192, 220, 64, L('JavDB App API', 'JavDB App 接口'), L('filmographies by actor id', '按演员 id 列作品'), L('WORKS', '作品')),
          node(32, 288, 220, 64, L('javdb.com movie page', 'javdb.com 影片页'), L('actresses + magnets', '女演员 + 磁力'), L('METADATA', '元数据')),
          node(32, 384, 220, 64, L('sukebei RSS', 'sukebei RSS'), L('fallback magnets by code', '按番号补查磁力'), L('FALLBACK', '备用'))]
    b += [node(372, 196, 216, 156, 'StudyMovie', ['teachers auto', 'organize', 'catalog', 'web · :8850'],
               L('CLI · LAPTOP OR NAS', 'CLI · 电脑或 NAS'), kind='focal')]
    b += [node(680, 128, 236, 60, 'aria2 / ' + L('Thunder', '迅雷'), L('this computer or NAS', '本机或 NAS'), L('DOWNLOAD', '下载')),
          node(680, 256, 236, 60, L('Flat library', '平铺片库'), L('date · code · actress.mp4', '日期 番号 演员.mp4'), L('FILES', '文件')),
          node(680, 384, 236, 60, L('Library wall', '影片墙'), L('covers · play · 1-click get', '封面 · 播放 · 一键下载'), L('LAN WEB', '局域网网页'))]
    b += ['<line class="rule" x1="32" y1="488" x2="916" y2="488"/>',
          f'<rect class="focal" x="32" y="504" width="14" height="10" rx="2"/><text class="mono e muted" x="54" y="513">{L("THE CLI", "命令行工具")}</text>',
          f'<line class="aline" x1="170" y1="509" x2="200" y2="509"/><text class="mono e muted" x="208" y="513">{L("PRIMARY PATH", "主路径")}</text>',
          f'<line class="line dash" x1="330" y1="509" x2="360" y2="509"/><text class="mono e muted" x="368" y="513">{L("FALLBACK", "备用路径")}</text>']
    return svg(s, 948, 536, L('How StudyMovie fits together', 'StudyMovie 架构'),
               L('Bookmarks, the JavDB API, javdb.com pages and sukebei feed StudyMovie, which submits to aria2 or Thunder, renames files into a flat library and serves a library wall.',
                 '浏览器书签、JavDB App 接口、javdb.com 影片页和 sukebei 为 StudyMovie 提供数据；StudyMovie 把磁力交给 aria2 或迅雷下载，下完改名成平铺片库，并提供局域网影片墙。'),
               '\n'.join(b))


def schedule():
    s = 'schedule'
    x0, x1, y = 48, 900, 150
    hx = lambda h: x0 + (x1 - x0) * h / 24
    b = [title(32, 40, L('DAILY TIMERS', '每日定时任务'), L('On a NAS: five systemd timers', 'NAS 上：5 个 systemd 定时任务')),
         f'<line class="rule" x1="{x0}" y1="{y}" x2="{x1}" y2="{y}" style="stroke-opacity:.5"/>']
    for h in range(0, 25, 3):
        if h == 15:  # organize 的引线从这里往下走，不画刻度字
            continue
        b.append(f'<line class="rule" x1="{hx(h)}" y1="{y - 4}" x2="{hx(h)}" y2="{y + 4}" style="stroke-opacity:.5"/>'
                 f'<text class="mono e soft" x="{hx(h)}" y="{y + 22}" text-anchor="middle">{h:02d}:00</text>')
    # 中文版：名字写中文，副标题写命令；英文版：名字写命令，副标题写说明。
    events = [(3, 'catalog', 'full filmographies', '作品目录', 'up'), (4, 'shows check', 'new TV episodes', '查剧集新集', 'down'),
              (8, 'shows organize', 'Show/Season 01', '剧集归档', 'up'), (15, 'organize', 'rename + flatten', '片库整理', 'down'),
              (18, 'teachers auto', 'download new works', '下载新作', 'up'), (20, 'shows organize', 'second pass', '剧集归档', 'down')]
    for h, command, en, zh, side in events:
        name, sub = L(command, zh), L(en, command)
        cx = hx(h)
        focal = command == 'teachers auto'
        dot = f'<circle cx="{cx}" cy="{y}" r="{6 if focal else 4.5}" class="{"acc" if focal else "ink"}"/>'
        ty = y - 52 if side == 'up' else y + 56
        b.append(f'<line class="{"aline" if focal else "line"}" x1="{cx}" y1="{y}" x2="{cx}" y2="{ty + (24 if side == "up" else -18)}"/>')
        b.append(dot)
        b.append(f'<text class="n {"acc" if focal else "ink"}" x="{cx}" y="{ty}" text-anchor="middle">{name}</text>'
                 f'<text class="mono s soft" x="{cx}" y="{ty + 16}" text-anchor="middle">{sub}</text>')
    b.append(f'<text class="mono s soft" x="32" y="{y + 104}">{L("Plus a resident library wall on :8850. On a laptop, run the same commands when you want.", "另有常驻的影片墙（:8850）。在自己电脑上，需要时手动跑同样的命令。")}</text>')
    return svg(s, 948, 282, L('StudyMovie daily schedule', 'StudyMovie 每日定时任务'),
               L('Timers run catalog at 03:00, show checks at 04:00, show archiving at 08:00 and 20:00, library organizing at 15:00 and teacher downloads at 18:00.',
                 '03:00 更新作品目录，04:00 查剧集新集，08:00 和 20:00 剧集归档，15:00 整理片库，18:00 下载关注演员的新作。'),
               '\n'.join(b))


def magnets():
    s = 'magnets'
    b = [title(32, 40, L('MAGNET SOURCES', '磁力来源'), L('Two sources, checked only when a torrent is likely', '两个来源，只在可能有种子时才查'))]
    b += [path('M172 148 H226', s), path('M372 148 H426', s, accent=True), path('M602 136 H656', s, accent=True),
          path('M812 148 H866', s, accent=True), path('M302 194 V242', s), path('M517 194 V242', s, dashed=True),
          path('M602 264 H624 Q632 264 632 256 V170 Q632 162 640 162 H656', s, dashed=True),
          path('M602 290 H656', s, dashed=True)]
    b += [label(399, 136, L('DUE', '到期')), label(629, 124, L('FOUND', '找到')), label(312, 222, L('NOT DUE', '未到期'), 'start'),
          label(527, 222, L('NONE / ERROR', '没有 / 出错'), 'start')]
    b += [node(32, 116, 140, 64, L('New work', '新作品'), L('from the pool', '来自作品池'), L('POOL', '作品池')),
          node(232, 116, 140, 64, L('Due today?', '今天该查？'), L('by release date', '按发行日期'), L('RULE', '规则')),
          node(432, 116, 170, 64, L('javdb.com page', 'javdb.com 影片页'), L('~1.3 pages / sec', '约每秒 1.3 页'), L('PRIMARY', '首选'), kind='focal'),
          node(662, 116, 150, 64, L('Pick the best', '挑最合适的'), L('full, smaller first', '完整版、小的优先'), L('CHOOSE', '挑选')),
          node(872, 116, 136, 64, L('Submit', '提交下载'), L('aria2 or Thunder', 'aria2 或迅雷'), L('DONE', '完成')),
          node(232, 248, 140, 64, L('Wait', '等待'), L('not checked today', '今天不查'), L('SKIP', '跳过'), kind='dim'),
          node(432, 248, 170, 64, 'sukebei RSS', L('&lt; 1 request / sec', '每秒不到 1 次'), L('FALLBACK', '备用')),
          node(662, 248, 150, 64, L('No torrent yet', '暂无种子'), L('retry on schedule', '按日程再查'), L('LATER', '稍后'), kind='dim')]
    b += ['<line class="rule" x1="32" y1="350" x2="1008" y2="350"/>',
          f'<text class="mono s soft" x="32" y="376">{L("Schedule: from 1 day before release, daily for 14 days, then weekly. Unreleased works are not queried.", "查询日程：发行前 1 天开始，发行后 14 天内每天查，之后每周查一次。未发行的作品不发请求。")}</text>']
    return svg(s, 1040, 400, L('Magnet lookup with two sources', '双来源磁力查询'),
               L('For each due work StudyMovie reads magnets from the javdb.com movie page and falls back to sukebei; unreleased or recently checked works are skipped.',
                 '到期的作品先从 javdb.com 影片页取磁力，没有再查 sukebei；未发行或本周已查过的作品跳过。'),
               '\n'.join(b))


def naming():
    s = 'naming'
    xs = [32 + i * 212 for i in range(5)]
    b = [title(32, 40, L('ORGANIZE', '片库整理'), L('From a messy download to a library name', '从杂乱的下载名到统一的片库文件名'))]
    for i in range(4):
        b.append(path(f'M{xs[i] + 168} 150 H{xs[i + 1] - 6}', s, accent=i == 3))
    b += [node(xs[0], 112, 168, 76, L('Download', '下载文件'), ['hhd800.com@', 'ABC123ch.mp4'], L('INPUT', '输入')),
          node(xs[1], 112, 168, 76, L('Code', '番号'), ['ABC-123', L('ranked candidates', '候选排序')], L('PARSE', '解析')),
          node(xs[2], 112, 168, 76, L('JavDB id', 'JavDB id'), [L('catalog cache or', '作品目录缓存'), L('page-jump search', '或按番号跳页查')], L('LOOKUP', '查找')),
          node(xs[3], 112, 168, 76, L('Actresses', '女演员'), [L('actor-female only', '只取女演员'), L('main star first', '主演排第一')], L('MOVIE PAGE', '影片页')),
          node(xs[4], 112, 228, 76, L('Library file', '片库文件'), ['2026-09-10 ABC-123', L('Actress A、Actress B.mp4', '演员甲、演员乙.mp4')], L('OUTPUT', '输出'), kind='focal')]
    b += ['<line class="rule" x1="32" y1="232" x2="1108" y2="232"/>',
          f'<text class="mono s soft" x="32" y="258">{L("Up to 4 names, then 等. Unknown or undated files are re-checked every run; renames are logged for rollback.", "最多写 4 位演员，再多加「等」。未知演员或缺日期的文件每轮重查；每次改名都记账，可回滚。")}</text>']
    return svg(s, 1140, 280, L('How organize names a file', '整理怎么给文件命名'),
               L('A download name is parsed into a code, matched to a JavDB id, enriched with the female cast from the movie page and renamed to date, code and actresses.',
                 '下载文件名先解析出番号，再对应到 JavDB id，从影片页取女演员，最后改名成「发行日期 番号 演员」。'),
               '\n'.join(b))


def wall():
    s = 'wall'
    b = [title(32, 40, L('LAN WEB', '局域网网页'), L('The library wall (illustration)', '影片墙（示意）')),
         '<rect class="card" x="32" y="84" width="884" height="404" rx="10" style="stroke:#7c808c;stroke-opacity:.35"/>',
         '<circle cx="54" cy="104" r="5" class="cover2"/><circle cx="72" cy="104" r="5" class="cover2"/><circle cx="90" cy="104" r="5" class="cover2"/>',
         '<rect class="dim" x="120" y="94" width="300" height="20" rx="10"/><text class="mono s soft" x="134" y="108">nas.local:8850</text>',
         '<line class="rule" x1="32" y1="124" x2="916" y2="124"/>',
         f'<rect class="dim" x="52" y="140" width="260" height="30" rx="15"/><text class="s soft" x="70" y="159">{L("Search code, actress, title…", "搜番号、演员、标题…")}</text>']
    who = [L('Actress A', '演员甲'), L('Actress B', '演员乙'), L('Actress C', '演员丙')]
    chips = [(L('All', '全部'), True), (L('Downloaded', '已下载'), False), (L('Missing', '未下载'), False)] + [(name, False) for name in who]
    x = 332
    for text, on in chips:
        w = width(text, 11.5) + 28
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
                 f'<text class="s muted" x="{cx}" y="{cy + 134}">{who[i % 3]}</text>')
        badge = (L('Local', '已有'), 'ok') if have else (L('Get', '下载'), 'acc')
        b.append(f'<rect class="card" x="{cx + 104}" y="{cy + 8}" width="44" height="18" rx="9"/>'
                 f'<text class="mono e {badge[1]}" x="{cx + 126}" y="{cy + 21}" text-anchor="middle">{badge[0]}</text>')
    return svg(s, 948, 516, L('Library wall illustration', '影片墙示意图'),
               L('A browser page with a search box, filter chips and a grid of cover placeholders marked local or downloadable.',
                 '浏览器页面：搜索框、筛选按钮，以及标注「已有」或「下载」的封面网格。'),
               '\n'.join(b))


for LANG, folder in [('zh', OUT), ('en', OUT / 'en')]:
    folder.mkdir(exist_ok=True)
    for name, build in [('architecture', architecture), ('schedule', schedule), ('magnets', magnets), ('naming', naming), ('wall', wall)]:
        (folder / f'{name}.svg').write_text(build(), encoding='utf-8')
    print('wrote', LANG)
