# 3D renders

The `/render` skill lives in `.claude/skills/render/`. It turns a description or
a reference image into parametric [build123d](https://github.com/gumyr/build123d)
Python, runs it, and shows the result in a Three.js viewer at
http://localhost:3123.

Vendored from [mfranzon/render](https://github.com/mfranzon/render); the
adjustments made for this repo are listed at the bottom.

## Using it

```
/render a gear with 12 teeth
/render the television from src/tv, in millimetres
/render apply pending edits
```

The viewer starts on the first render (`make render` starts it by hand). It has
a code panel for tweaking parameters (Ctrl+Enter re-renders), a gallery of
previous models, dimension and cross-section overlays, STEP/STL export, and an
edit mode: drag a box over a region, type an instruction, and the request is
queued in `viewer/edits/pending/` for `/render apply pending edits` to pick up.

## What it is not

It is not part of the site. Nothing here is imported by `src/`, built by Vite,
or served from `public/`. It is a modelling scratchpad that happens to live in
the repo so that the television's proportions and the model's proportions can be
compared without leaving it.

The television on the page is procedural Three.js geometry in `src/tv/scene.ts`,
and it stays that way — see `docs/adr/`. A build123d model of it is a study, not
a source of truth, and `.glb` files never become a runtime dependency.

## Scene units

`src/tv/constants.ts` is in scene units: `BODY_W = 1.1`, `BODY_H = 0.88`,
`BODY_D = 0.8`, `FOOT_H = 0.045`. build123d is millimetre-native, so model the
television at **×100** — a 110 × 88 × 80 mm cabinet — and the numbers in a model
script stay recognisably the same numbers as in `constants.ts`.

## What is and isn't committed

The skill's own `.gitignore` keeps `.venv/`, the generated `.glb`, `.step` and
`.stl` files and `viewer/edits/` out of git. The model **scripts** in
`viewer/models/*.py` are kept: they are the model, the meshes are just its
output. Delete the ones that were throwaway rather than committing them.

## Changes from upstream

- `setup.sh` picks a Python 3.10–3.13 interpreter instead of calling `python3`,
  which on macOS is 3.9 and cannot resolve build123d's dependencies at all.
- It installs `build123d` from PyPI rather than the git main branch, so the
  bootstrap is a wheel download and not a source build.
- `SKILL.md` gained the repo-specific section: scene units, the rule that `src/`
  is off limits, and the site palette as the default model colours.
- `SKILL.md` also documents that renders are scratch and that `make render`
  starts the viewer.
- The repo side: a `render` target in the `Makefile`, and `.claude` added to
  `eslint.config.js` ignores and `.prettierignore` — otherwise `make check`
  lints the skill's venv and the vendored viewer JS.
