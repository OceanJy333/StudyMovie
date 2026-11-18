# Agent guide

## Installing nas-movie for a user

Follow [`skills/nas-movie/SKILL.md`](skills/nas-movie/SKILL.md). In short:

1. Run `npm install -g github:OceanJy333/nas-movie-cli`.
2. Write `~/.config/nas-movie/config.json` and `~/.config/nas-movie/env` from the example files, using values the user gives you.
3. Run `nas-movie doctor`.

To give a coding agent the skill permanently, run:

```bash
npx skills add OceanJy333/nas-movie-cli
```

Or copy `skills/nas-movie/` into the agent's skills folder, for example `~/.claude/skills/nas-movie/`.

## Working on this repository

- TypeScript, ES modules. During development Node runs `src/` directly; the NAS runs the compiled `dist/`.
- `npm run check` and `npm test` must pass before you commit.
- Every command prints JSON. Anything that downloads or moves files needs `--apply`.
- Personal paths and hosts belong in `~/.config/nas-movie/env`, never in code (see `src/core/paths.ts`).
- README figures are generated: edit `docs/figures.py`, then run `python3 docs/figures.py`.
