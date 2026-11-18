# StudyMovie：JavDB 演员新作自动下载与番号整理工具

**StudyMovie 是一个自托管的命令行工具，在你自己的电脑或家里的 NAS 上维护一个自动更新的 JAV 片库。** 你在浏览器里收藏演员页，它去 JavDB 找这些演员的新作，挑最合适的磁力，用本机的 aria2（BT，任何电脑）或 NAS 上的迅雷下载，下完后把文件统一命名成 `发行日期 番号 演员.ext`，再在局域网里提供一面影片墙，显示已有和缺少的作品。它也能订阅电视剧和番剧，下完按 `剧名/Season 01/` 归档。

简体中文 · [English](README.en.md)

![Node.js ≥ 18](https://img.shields.io/badge/node-%E2%89%A518-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)
![Tests](https://img.shields.io/badge/tests-81%20passing-2f7d4f)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)

<p align="center"><img src="docs/architecture.svg" alt="架构：书签、JavDB App 接口、javdb.com 影片页和 sukebei 为 StudyMovie 提供数据，StudyMovie 驱动 aria2 或迅雷、整理片库并提供影片墙" width="100%"></p>

## 一览

| | |
|---|---|
| **是什么** | 一个 TypeScript CLI 和一个小型 Web 服务；放在 NAS 上时再加 5 个 systemd 用户定时任务 |
| **适合谁** | 想让关注演员的新作自动下载、自动归档的人，笔记本或 NAS 都行 |
| **下载后端** | 本机 aria2（默认，自动拉起）或 NAS 上的迅雷（经 SSH） |
| **输入** | 浏览器书签里的一个演员页文件夹（Edge / Chrome 格式） |
| **输出** | 平铺、按日期排序的片库：`2026-09-10 ABC-123 演员甲、演员乙.mp4` |
| **元数据** | JavDB 仍公开的 App 接口和 javdb.com 影片网页，不需要账号 |
| **磁力** | 先取 javdb.com 影片页上的磁力，没有再查 sukebei RSS |
| **运行环境** | Node.js 18+，没有运行时 npm 依赖 |
| **实测** | 完整部署约 2 分钟；约 570 部作品的池子，每日任务约 1 分钟；380 个文件的片库用缓存重算一次 1.4 秒 |

## 能用它做什么？

- 关注的演员一出新作，就自动找磁力、自动下载，不用每天刷 JavDB。
- 把 `hhd800.com@ABC123ch.mp4` 这类乱七八糟的下载文件，批量改成 `2026-09-10 ABC-123 演员.mp4`。
- 在自己电脑上用 aria2 下磁力，或者让 NAS 上的迅雷在后台下。
- 在局域网里打开一面影片墙，看哪些已经下了、哪些还缺，缺的点一下就下。
- 让 Claude Code、Codex 这类 AI agent 用一句话帮你下指定番号。

## 为什么做这个？

手动跟 60 多位演员，意味着要逐个看主页、找磁力、开下载、改文件名。StudyMovie 每天 18:00 做这件事，数据源变了也能继续工作：2026 年 11 月 JavDB 把搜索、详情和磁力接口都改成要登录，工具换成了不需要账号的接口和网页；现在只要有数据源失败，任务就以非零状态退出，不会再"成功"地什么都没下。

## 功能

- **跟人，不跟文件。** 收藏演员页，她的新作就会自动排进下载。演员 id 固化在名册文件里，改名、别名都不受影响。
- **在哪都能下。** 在笔记本或台式机上驱动 aria2（自己拉起守护进程，重启后续传，下完不做种）；在 NAS 上驱动迅雷。
- **双磁力来源，按日程查询。** 从发行前一天开始查，发行后两周每天查，之后每周查一次。没发行的作品不发请求。
- **挑合适的版本。** 完整版优先于样片，原版优先于 AI 去码版，有做种的优先，非高清、体积小的优先。
- **片库整理。** 能解析 `hhd800.com@ABC123ch.mp4` 这类乱名，查出全部女演员（最多写 4 位，再多加「等」），种子和广告挪进回收目录，每次移动都记账可回滚。
- **局域网影片墙。** 封面、搜索、按演员筛选、浏览器内播放，没下的作品一键下载。
- **剧集和番剧订阅。** 通过 Jackett 搜索新集并下载，下完按 `剧名/Season 01/剧名 - S01E03.mkv` 归档，Jellyfin 直接识别。
- **出错就报错。** 任何数据源或提交失败，任务都以退出码 1 结束，当天就能在 `systemctl --user status` 里看到。

## 怎么工作？

### 每天的定时任务

<p align="center"><img src="docs/schedule.svg" alt="定时任务：03:00 作品目录，04:00 剧集检查，08:00 和 20:00 剧集归档，15:00 片库整理，18:00 老师自动下载" width="100%"></p>

### 磁力从哪来？

<p align="center"><img src="docs/magnets.svg" alt="到期的作品先查 javdb.com 影片页，再查 sukebei；没发行的跳过" width="100%"></p>

两个来源都有限流，所以每个 HTTP 客户端自己控制节奏：javdb.com 影片页每 0.8 秒一次（超过约每秒 1.5 次会返回 429），sukebei 每 1.3 秒一次。查询按小批并发，两个来源的等待时间能重叠。

### 文件怎么命名？

<p align="center"><img src="docs/naming.svg" alt="下载文件名 → 番号 → JavDB id → 女演员 → 片库文件名" width="100%"></p>

JavDB id 优先用本地作品目录里记过的；没有时按番号差在同前缀片单里跳页查找，一般 2–4 次请求，不用从头翻。结果会缓存，之后每轮只读缓存，不再请求。

### 影片墙

<p align="center"><img src="docs/wall.svg" alt="影片墙示意：搜索框、筛选按钮和占位封面网格" width="100%"></p>

## 交给 AI agent 用

StudyMovie 自带一个 [agent skill](skills/studymovie/SKILL.md)。把下面这句话发给 Claude Code、Codex、Cursor 或其他编程 agent：

> 从 https://github.com/OceanJy333/StudyMovie 安装 StudyMovie：按 skills/studymovie/SKILL.md 操作，最后运行 `studymovie doctor`。

想让 agent 长期带着这个 skill，可以用开源的 [skills](https://github.com/vercel-labs/skills) 安装器添加：

```bash
npx skills add OceanJy333/StudyMovie
```

agent 会把 CLI 装到本机（`npm install -g --install-links github:OceanJy333/StudyMovie`），先问你在本机下还是在 NAS 上下，再把"下载 ABC-123""NAS 在下什么"这类请求翻成命令。它总是先给出计划，再加 `--apply` 执行。

## 快速开始

### 在自己电脑上（aria2）

需要 Node.js 18+ 和 [aria2](https://aria2.github.io/)（`brew install aria2`、`sudo apt install aria2` 或 `winget install aria2.aria2`）。

```bash
npm install -g --install-links github:OceanJy333/StudyMovie
mkdir -p ~/.config/nas-movie
echo 'NAS_MOVIE_ARCHIVE=/path/to/library' >> ~/.config/nas-movie/env
studymovie doctor
studymovie teachers auto --numbers ABC-123 --apply
```

不需要 `config.json`。第一次下载时会在 `127.0.0.1:6800` 拉起 `aria2c` 守护进程，命令退出后继续下载，重启后续传。`studymovie status` 看进度，`studymovie organize --apply` 给下完的文件改名。想用已经在跑的 aria2（Motrix、远程下载机），在 `~/.config/nas-movie/config.json` 写 `{"downloader": "aria2", "aria2": {"rpc": "http://host:6800/jsonrpc", "secret": "…"}}`。

### 在 NAS 上（迅雷和定时任务）

- 能 SSH 登录、支持 systemd 用户服务的 Linux NAS（在绿联 UGOS 上验证过，基于 Debian）。
- NAS 版迅雷，本机接口在 `127.0.0.1:5050`。
- NAS 上 Node.js 18 或更新；构建用的电脑上 Node.js 22.6+。
- 可选：网络访问不了 javdb.com 或 sukebei 时，NAS 上需要一个 HTTP 代理（mihomo / clash）；搜电影和剧集需要 Jackett。

从源码安装并部署定时任务：

```bash
git clone https://github.com/OceanJy333/StudyMovie.git
cd StudyMovie
npm install
npm test
```

```bash
mkdir -p ~/.config/nas-movie
cp config.example.json ~/.config/nas-movie/config.json
cp env.example ~/.config/nas-movie/env
```

改好这两个文件后部署。脚本会构建 `dist/`、上传、安装定时任务，并把每个任务 dry-run 一遍：

```bash
./deploy-nas.sh
```

### 先看计划，不动任何东西

不加 `--apply` 时，每个命令只输出 JSON 计划：

```bash
npm run movie -- teachers auto
npm run movie -- organize
```

## 命令

| 命令 | 作用 |
|---|---|
| `teachers auto [--apply] [--days 30]` | 把所有关注演员的近期作品放进一个池，已经有种子的就下载 |
| `teachers backfill [--apply] [--limit 100]` | 一次性补齐：所有演员合起来最新的 N 部 |
| `teachers names --save roster.json` | 导出书签文件夹，给每位演员固定 JavDB id |
| `catalog [--pages 8]` | 抓完整片单，影片墙才能显示没下的作品 |
| `organize [--apply]` | 把下载完的片子平铺进片库并改名 |
| `web [--port 8850]` | 启动局域网影片墙 |
| `shows add <名字> --query "..."` / `shows check --apply` / `shows organize --apply` | 剧集和番剧订阅 |
| `status`、`add <magnet>`、`doctor` | 下载任务、手动添加、健康检查（`paths` 列迅雷目录） |
| `search` / `resources` / `fetch <片名> --year 2020` | 通过 Jackett 搜电影，按做种、画质、体积排序 |

## 配置

个人设置放在 `~/.config/nas-movie/env`（见 [`env.example`](env.example)），连接信息放在 `~/.config/nas-movie/config.json`（见 [`config.example.json`](config.example.json)）。真实环境变量优先于文件。

| 变量 | 默认值 | 含义 |
|---|---|---|
| `NAS_SSH` | 部署时必填 | NAS 在 ssh config 里的主机名 |
| `NAS_MOVIE_ARCHIVE` | `~/Media/JAV` | 平铺片库，也是默认下载目录 |
| `NAS_MOVIE_SHOWS_ROOT` | `~/Media/Shows` | 剧集和番剧库 |
| `NAS_MOVIE_TRASH` | `~/.nas-movie-trash` | 整理时挪走的残留文件 |
| `NAS_MOVIE_BOOKMARKS_HOST` | 空（本机） | 书签所在电脑的 ssh 主机名 |
| `NAS_MOVIE_BOOKMARKS_FILE` | Edge 默认路径 | 书签文件 |
| `NAS_MOVIE_BOOKMARKS_FOLDER` | `Teachers` | 放演员页的书签文件夹 |
| `NAS_MOVIE_PROXY` | 无（部署脚本设为 `http://127.0.0.1:7890`） | 访问 javdb.com 和 sukebei 的 HTTP 代理 |

状态文件（名册、下载账本、元数据缓存、改名记录）在 NAS 的 `~/.config/nas-movie/state/` 下。

## 常见问题

### 怎么自动追更 JavDB 上关注演员的新作？

把演员的 JavDB 页面收藏进浏览器书签里的一个文件夹（默认叫 `Teachers`），运行 `studymovie teachers names --save ~/.config/nas-movie/performers.json` 固定名册，之后每天跑 `studymovie teachers auto --apply`。在 NAS 上部署后，18:00 的定时任务会自动跑。

### 怎么用 aria2 自动下载磁力？

装好 aria2，不写 `config.json`，直接运行 `studymovie add "magnet:?xt=urn:btih:…"` 或 `studymovie teachers auto --apply`。CLI 发现本机 6800 端口没有 aria2 时会自己启动它，下完自动停止做种。

### 迅雷 NAS 版能用脚本调用吗？

能。StudyMovie 经 SSH 调用 NAS 版迅雷的本机接口（`127.0.0.1:5050`），从迅雷页面读取登录凭据，提交任务前先查重，提交后在任务列表里确认。

### 怎么批量整理番号文件名？

运行 `studymovie organize` 看计划，确认后加 `--apply`。它会解析番号、查 JavDB 拿发行日期和女演员，把文件平铺到片库根目录，命名为 `发行日期 番号 演员.ext`，广告和种子文件挪进回收目录。

### 需要 JavDB 账号吗？

不需要。它用 JavDB 仍然公开的 App 接口（演员片单、厂牌和番号前缀列表、演员资料），演员和磁力取自公开的 javdb.com 影片页。没有选择登录：token 会过期，会成为新的故障点。

### 数据源开始拦截请求会怎样？

任务以退出码 1 结束，汇总行会点名失败项，例如 `失败 2（ABC-123 磁力查询…）`。拿到的不是影片页（挑战页、改版）一律算错误，不会当成"没有演员"或"没有磁力"。

### 怎么决定下哪个种子？

sukebei 的结果只保留名字里有完整番号的（`ABC-123` 不会误中 `ABC-1230`），有做种的优先，有原版时不选 AI 去码版。两个来源合起来，优先 400 MB 以上的完整版，再优先非高清，再优先体积小的。

### 会改我已有的文件吗？

只会重查片库根目录里已经是 `发行日期 番号 演员.ext` 格式的文件，名字有变化才改（比如未知演员认出来了，或补上了共演者）。每次移动都记在 `state/organized.json`，带原路径。

### 没有 NAS 能用吗？

能。没有 `config.json` 时，CLI 用所在电脑上的 aria2 下载，片库整理和影片墙对任意目录都能用。只有部署脚本和 systemd 定时任务是 NAS 专用的；在笔记本上需要时跑一次 `teachers auto --apply`，或者自己用系统计划任务定时。macOS 实测过；Linux 应当一样；Windows 未测试。

### 和 Movie_Data_Capture、JavSP 这类刮削工具有什么不同？

刮削工具负责给已有文件补元数据；StudyMovie 负责发现新作、下载和命名，两者可以一起用。

| | 元数据刮削工具 | StudyMovie |
|---|---|---|
| 发现关注演员的新作 | 否 | 是，每天 |
| 发起下载 | 否 | 是，aria2 或迅雷 |
| 改名成平铺片库 | 是 | 是，写全共演者 |
| 给媒体服务器写 NFO 和海报 | 通常会 | 否，文件名就是元数据 |
| 在 NAS 上无人值守运行 | 少见 | 是，systemd 定时任务 |

## 目录结构

```text
src/
  teachers/   名册、作品池、每日挑选和提交
  javdb/      JavDB App 客户端、网页适配器、磁力规则
  sukebei.ts  sukebei RSS 适配器
  library/    番号解析、命名、元数据缓存、整理
  catalog/    影片墙用的完整作品目录
  web/        局域网影片墙服务和页面
  shows/      剧集和番剧订阅
  core/       HTTP 客户端（代理、节流、超时）、路径、JSON、并发工具
skills/       给 Claude Code、Codex 等 agent 用的 skill（SKILL.md）
docs/         README 插图（用 python3 docs/figures.py 重新生成）
deploy-nas.sh 构建、上传、安装定时任务、dry-run
```

## 开发

```bash
npm run check   # tsc --noEmit
npm test        # node --test，81 项
npm run build   # 生成给 NAS 用的 dist/
```

## 许可证

[MIT](LICENSE)，免费使用和修改。
