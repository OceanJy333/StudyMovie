# Agent guide

## Installing studymovie for a user

Follow [`skills/studymovie/SKILL.md`](skills/studymovie/SKILL.md). In short:

1. Run `npm install -g --install-links github:OceanJy333/StudyMovie`.
2. Write `~/.config/nas-movie/config.json` and `~/.config/nas-movie/env` from the example files, using values the user gives you.
3. Run `studymovie doctor`.

To give a coding agent the skill permanently, run:

```bash
npx skills add OceanJy333/StudyMovie
```

Or copy `skills/studymovie/` into the agent's skills folder, for example `~/.claude/skills/studymovie/`.

## Working on this repository

- TypeScript, ES modules. During development Node runs `src/` directly; the NAS runs the compiled `dist/`.
- `npm run check` and `npm test` must pass before you commit.
- Every command prints JSON. Anything that downloads or moves files needs `--apply`.
- Personal paths and hosts belong in `~/.config/nas-movie/env`, never in code (see `src/core/paths.ts`).
- README figures are generated: edit `docs/figures.py`, then run `python3 docs/figures.py`.
