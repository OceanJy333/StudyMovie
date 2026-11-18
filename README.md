# nas-movie-cli

**nas-movie-cli is a self-hosted command-line tool that turns a home NAS into an automatic JAV library.** It follows the actresses you bookmark, finds their new releases on JavDB, sends the best magnet to the NAS's Thunder (迅雷) downloader, renames every finished file to `YYYY-MM-DD CODE Actress.ext`, and serves a LAN web wall of what you have and what you are missing. It also subscribes to TV series and anime and files episodes into `Show/Season 01/`.

[English](README.md) · [简体中文](README.zh-CN.md)

![Node.js ≥ 18](https://img.shields.io/badge/node-%E2%89%A518-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)
![Runtime dependencies](https://img.shields.io/badge/runtime%20deps-0%20on%20the%20NAS-555)
![Tests](https://img.shields.io/badge/tests-77%20passing-2f7d4f)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)

<p align="center"><img src="docs/architecture.svg" alt="Architecture: bookmarks, JavDB API, javdb.com pages and sukebei feed nas-movie on the NAS, which drives Thunder, organizes the library and serves a web wall" width="100%"></p>

## At a glance

| | |
|---|---|
| **What it is** | A TypeScript CLI plus five systemd user timers and one small web server, all running on the NAS |
| **Who it is for** | People with a NAS running Thunder (for example UGREEN UGOS) who want new releases of followed actresses to download and file themselves |
| **Input** | A browser bookmark folder of actress pages (Edge or Chrome format) |
| **Output** | A flat, date-sorted library: `2026-09-10 ABC-123 Actress A、Actress B.mp4` |
| **Metadata** | JavDB public app endpoints and javdb.com movie pages, no account or login |
| **Magnets** | javdb.com movie page first, sukebei RSS as fallback |
| **Runtime on the NAS** | Node.js 18+, no npm packages (only `dist/` is deployed) |
| **Measured** | Full deploy in about 2 minutes; daily auto run in about 1 minute for a pool of ~570 works; re-checking a 380-file library from cache in 1.4 s |

## Why does it exist?

Following 60+ actresses by hand means checking every profile, finding a magnet, starting a download and renaming the file. nas-movie-cli does that every day at 18:00 and keeps doing it when sources change: when JavDB put its search, detail and magnet endpoints behind login in November 2026, the tool switched to endpoints and pages that need no account, and it now exits non-zero when a source fails instead of reporting a silent "success".

## Features

- **Follow actresses, not files.** Bookmark an actress page and her new releases are queued automatically. Actress IDs are pinned in a roster file, so renamed or aliased names keep working.
- **Two magnet sources with a schedule.** Works are queried from one day before release, daily for 14 days, then weekly. Unreleased works cost no requests.
- **Picks the sensible release.** Full releases over samples, original over AI "reducing mosaic" edits, seeded over dead, smaller non-HD first.
- **Library organizer.** Parses messy names such as `hhd800.com@ABC123ch.mp4`, looks up the female cast, writes all co-stars (up to four, then `等`), and moves leftovers to a trash folder with a rollback log.
- **LAN library wall.** Covers, search, filter by actress, play in the browser, and one-click download for works you are missing.
- **TV and anime subscriptions.** Searches through Jackett, submits new episodes and archives them as `Show/Season 01/Show - S01E03.mkv` for Jellyfin.
- **Fails loudly.** Any failed source or submission makes the run exit 1, so `systemctl --user status` shows the problem the same day.

## How does it work?

### Daily schedule

<p align="center"><img src="docs/schedule.svg" alt="Timers: catalog 03:00, shows check 04:00, shows organize 08:00 and 20:00, organize 15:00, teachers auto 18:00" width="100%"></p>

### Where do magnets come from?

<p align="center"><img src="docs/magnets.svg" alt="Due works are looked up on the javdb.com movie page first and sukebei second; unreleased works are skipped" width="100%"></p>

Both sources are rate-limited, so each HTTP client paces itself: javdb.com pages at one request per 0.8 s (more than about 1.5 per second returns HTTP 429), sukebei at one per 1.3 s. Work is checked in small parallel batches so the two sources wait at the same time.

### How are files named?

<p align="center"><img src="docs/naming.svg" alt="Download name to code to JavDB id to female cast to library file name" width="100%"></p>

The JavDB id comes from the local catalog when it is known; otherwise the tool jumps through the code's release list by number distance (2–4 requests instead of paging from the start). Results are cached, so later runs read the cache and send no requests.

### The library wall

<p align="center"><img src="docs/wall.svg" alt="Illustration of the web wall: search box, filter chips and a grid of placeholder covers" width="100%"></p>

## Use it from an AI agent

nas-movie ships an [agent skill](skills/nas-movie/SKILL.md). Paste this into Claude Code, Codex, Cursor or any other coding agent:

> Install nas-movie-cli from https://github.com/OceanJy333/nas-movie-cli: follow skills/nas-movie/SKILL.md, then run `nas-movie doctor`.

To give the agent the skill permanently, add it with the open [skills](https://github.com/vercel-labs/skills) installer:

```bash
npx skills add OceanJy333/nas-movie-cli
```

The agent then installs the CLI locally (`npm install -g github:OceanJy333/nas-movie-cli`), asks you for the NAS and Thunder settings, and maps requests such as "download ABC-123" or "what is the NAS downloading?" to commands. It always shows the plan before it adds `--apply`.

## Quick start

### Requirements

- A Linux NAS with SSH access and systemd user services (tested on UGREEN UGOS, Debian based).
- Thunder (迅雷) for NAS with its local API on `127.0.0.1:5050`.
- Node.js 18 or newer on the NAS; Node.js 22.6+ on the machine you build from.
- Optional: an HTTP proxy on the NAS (mihomo/clash) if javdb.com or sukebei is blocked on your network; Jackett for movie and TV search.

### Install the CLI on your computer

```bash
npm install -g github:OceanJy333/nas-movie-cli
nas-movie --help
```

The CLI talks to the NAS over SSH, so you can use it from a laptop without the timers.

### Install from source and deploy the timers

```bash
git clone https://github.com/OceanJy333/nas-movie-cli.git
cd nas-movie-cli
npm install
npm test
```

```bash
mkdir -p ~/.config/nas-movie
cp config.example.json ~/.config/nas-movie/config.json
cp env.example ~/.config/nas-movie/env
```

Edit both files, then deploy. The script builds `dist/`, uploads it, installs the timers and runs a dry run of each job:

```bash
./deploy-nas.sh
```

### Try it without changing anything

Every command prints a plan as JSON until you add `--apply`:

```bash
npm run movie -- teachers auto
npm run movie -- organize
```

## Commands

| Command | What it does |
|---|---|
| `teachers auto [--apply] [--days 30]` | Pool all followed actresses' recent works and download the ones that now have a torrent |
| `teachers backfill [--apply] [--limit 100]` | One-off: fill the library with the newest N works across all actresses |
| `teachers names --save roster.json` | Export the bookmark folder and pin each actress to a JavDB id |
| `catalog [--pages 8]` | Fetch full filmographies so the wall can show what you have not downloaded |
| `organize [--apply]` | Flatten finished downloads into the library and rename them |
| `web [--port 8850]` | Serve the LAN library wall |
| `shows add <name> --query "..."` / `shows check --apply` / `shows organize --apply` | TV and anime subscriptions |
| `status`, `paths`, `add <magnet>`, `doctor` | Thunder tasks, download folders, manual add, health check |
| `search` / `resources` / `fetch <title> --year 2020` | Movie search through Jackett with seed, quality and size ranking |

## Configuration

Personal settings live in `~/.config/nas-movie/env` (see [`env.example`](env.example)); connection details in `~/.config/nas-movie/config.json` (see [`config.example.json`](config.example.json)). Real environment variables take precedence over the file.

| Variable | Default | Meaning |
|---|---|---|
| `NAS_SSH` | (required for deploy) | ssh config host of the NAS |
| `NAS_MOVIE_ARCHIVE` | `~/Media/JAV` | Flat JAV library and default Thunder target |
| `NAS_MOVIE_SHOWS_ROOT` | `~/Media/Shows` | TV / anime library |
| `NAS_MOVIE_TRASH` | `~/.nas-movie-trash` | Where organize moves leftovers |
| `NAS_MOVIE_BOOKMARKS_HOST` | empty (local) | ssh host that holds the browser bookmarks |
| `NAS_MOVIE_BOOKMARKS_FILE` | Edge default path | Bookmarks file |
| `NAS_MOVIE_BOOKMARKS_FOLDER` | `Teachers` | Bookmark folder with actress pages |
| `NAS_MOVIE_PROXY` | none (deploy sets `http://127.0.0.1:7890`) | HTTP proxy for javdb.com and sukebei |

State files (roster, download ledger, metadata cache, rename log) live under `~/.config/nas-movie/state/` on the NAS.

## FAQ

### Does nas-movie-cli need a JavDB account?

No. It uses JavDB app endpoints that are still public (actor filmographies, maker and code lists, actor profiles) and the public javdb.com movie page for cast and magnets. Logging in was rejected on purpose: tokens expire and would become a new single point of failure.

### What happens when a source starts blocking requests?

The run exits with code 1 and the summary line names what failed, for example `失败 2（ABC-123 磁力查询…）`. A page that is not a movie page (a challenge page or a redesign) is treated as an error, never as "no actresses" or "no magnets".

### How does it decide which torrent to download?

From sukebei it keeps only torrents whose name contains the full code (so `ABC-123` never matches `ABC-1230`), prefers seeded ones and skips AI "reducing mosaic" edits when an original exists. Across both sources it prefers full releases of at least 400 MB, then non-HD, then the smaller file.

### Will it rename files I already have?

Only files already in the `YYYY-MM-DD CODE Actress.ext` format at the library root are re-checked, and only renamed when the result changes (for example an unknown actress is now known, or co-stars were added). Every move is logged in `state/organized.json` with its original path.

### Can I use it without a NAS?

The CLI runs anywhere with Node.js, but downloading relies on the Thunder NAS API, and the timers are systemd user units. The organizer and the web wall work on any folder.

### How is it different from metadata scrapers?

| | Metadata scrapers | nas-movie-cli |
|---|---|---|
| Finds new releases of followed actresses | No | Yes, daily |
| Starts downloads | No | Yes, through Thunder |
| Renames into a flat library | Yes | Yes, with all co-stars |
| Writes NFO files and posters for media servers | Usually | No, the file name is the metadata |
| Runs unattended on the NAS | Rarely | Yes, systemd timers |

## Project layout

```text
src/
  teachers/   roster, pool, daily selection and submission
  javdb/      JavDB app client, web page adapter, magnet rules
  sukebei.ts  sukebei RSS adapter
  library/    code parsing, naming, metadata cache, organize
  catalog/    full filmography catalog for the wall
  web/        LAN library wall server and views
  shows/      TV and anime subscriptions
  core/       HTTP client (proxy, pacing, deadlines), paths, JSON, async helpers
skills/       agent skill (SKILL.md) for Claude Code, Codex and other agents
docs/         README figures (regenerate with python3 docs/figures.py)
deploy-nas.sh build, upload, install timers, dry run
```

## Development

```bash
npm run check   # tsc --noEmit
npm test        # node --test, 77 tests
npm run build   # dist/ for the NAS
```

## License

[MIT](LICENSE)
