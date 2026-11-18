---
name: studymovie
description: Install, configure and drive StudyMovie, a local CLI that downloads JAV works either on this computer through aria2 (BitTorrent) or to a NAS through Thunder (迅雷), follows bookmarked actresses' new releases, renames the library to "date code actress", and manages TV/anime subscriptions. Use when the user asks to download a code such as ABC-123, check what is downloading, pull an actress's new works, organize or rename the library, add or check a TV/anime subscription, or set up studymovie on this machine.
---

# StudyMovie

`studymovie` is a command-line tool. Every command prints JSON to stdout, and progress notes go to stderr. Commands that change something only print a plan until `--apply` is added.

## 1. Make sure the CLI is installed

```bash
studymovie --help
```

If the command is missing, install it globally from GitHub (Node.js 18 or newer; `dist/` is prebuilt):

```bash
npm install -g --install-links github:OceanJy333/StudyMovie
```

Upgrade with the same command.

## 2. Pick where downloads happen

Ask the user once: **download on this computer, or on a NAS running Thunder (迅雷)?**

**This computer (default).** Needs `aria2c` on the PATH: `brew install aria2` on macOS, `sudo apt install aria2` on Debian/Ubuntu, `winget install aria2.aria2` on Windows. No `config.json` is needed. Ask which folder the library should live in and write it to `~/.config/nas-movie/env`:

```bash
NAS_MOVIE_ARCHIVE=/path/to/library
```

The CLI starts an `aria2c` daemon on `127.0.0.1:6800` the first time it needs one; downloads keep running after the command exits. To use an aria2 the user already runs (Motrix, a NAS, a seedbox), write `~/.config/nas-movie/config.json`:

```json
{ "downloader": "aria2", "aria2": { "rpc": "http://host:6800/jsonrpc", "secret": "…" } }
```

**NAS with Thunder.** Write `~/.config/nas-movie/config.json` from [`config.example.json`](https://github.com/OceanJy333/StudyMovie/blob/main/config.example.json). Ask the user for these values and do not guess them: the NAS SSH host and user, the Thunder device id (`space`, which looks like `device_id#…`), and the library folder on the NAS.

Other personal settings (bookmark source, proxy) go in `~/.config/nas-movie/env`; template: [`env.example`](https://github.com/OceanJy333/StudyMovie/blob/main/env.example). Set both files to mode `600`, then run:

```bash
studymovie doctor
```

`doctor` names the backend (`aria2` or `thunder`) and must succeed before you run anything else.

## 3. Map the request to a command

| User wants | Command (plan first, then add `--apply`) |
|---|---|
| Download specific codes | `studymovie teachers auto --numbers ABC-123,XYZ-045` |
| New works of all followed actresses | `studymovie teachers auto` |
| Fill the library with the newest N works | `studymovie teachers backfill --limit 50` |
| What is downloading | `studymovie status` (add a keyword or hash to filter; `--all` includes finished tasks) |
| Add one magnet link | `studymovie add "magnet:?xt=…" [--to /folder/]` |
| Rename and flatten finished downloads | `studymovie organize` |
| Refresh the actress roster from bookmarks | `studymovie teachers names --save ~/.config/nas-movie/performers.json` |
| TV or anime | `studymovie shows list`, `shows add <name> --query "..." --season 1`, `shows check`, `shows organize` |
| Movies | `studymovie resources "<English title>" --year 2020`, then `fetch ... --hash <BTIH>` |
| Download folders Thunder accepts (Thunder only) | `studymovie paths` |

## 4. Rules

- **Run the plan first.** Run the command without `--apply` and summarize the plan: which codes, which torrent, which target folder, which renames. Add `--apply` only when the user has asked for the download or move itself.
- **Report failures as they are.** Exit code 1 means a source or the download backend failed. Quote the `failures` field, or the last stderr line, to the user. Do not retry in a loop.
- **Keep secrets out of chat.** Do not print the contents of `config.json`. Do not edit files under `~/.config/nas-movie/state/` by hand: they are ledgers that the CLI owns.
- **Expect some works to wait.** A work showing `还没有种子` (no torrent yet) or `未发行或本周已查` (unreleased, or already checked this week) is normal. The daily run checks it again on schedule.

## 5. Unattended daily runs (optional)

On a personal computer, run `studymovie teachers auto --apply` and `studymovie organize --apply` when the user asks, or schedule them with the system's own scheduler if the user wants that.

To run the timers on the NAS itself (downloads at 18:00, organize at 15:00 and so on), clone the repository and run its deploy script from the user's machine:

```bash
git clone https://github.com/OceanJy333/StudyMovie.git
cd StudyMovie
./deploy-nas.sh
```

The script needs `NAS_SSH` in `~/.config/nas-movie/env`. It builds the CLI, uploads it, installs the systemd user timers and dry-runs each job.
