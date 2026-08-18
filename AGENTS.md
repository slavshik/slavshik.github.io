# AGENTS.md

`CLAUDE.md` is a symlink to this file — one set of instructions, two names.

## The repo

Personal site at **slavshik.me**. Built with Vite, written in TypeScript,
published to GitHub Pages from a GitHub Actions workflow. The repository
contains only source: `dist/` is never committed.

- `index.html` — the markup, and nothing else. Vite's entry point. Metadata,
  JSON-LD and the pre-paint theme script live here; styles and logic do not.
- `src/main.ts` — page logic: time-of-day accent, theme button, the lazy
  television bootstrap.
- `src/styles.css` — the whole design.
- `src/tv/` — the CRT television, eight modules. `index.ts` exports `mount()`;
  `physics.ts`, `palette.ts`, `constants.ts` and `shaders.ts` contain no three
  and no WebGL, which is what makes the physics unit-testable. `lab.ts` is the
  workbench control surface and must stay out of the production chunk.
- `lab/tv.html` — the television workbench: sliders over every physics
  constant, telemetry, theme and accent switching. Imports the same `src/tv/`
  as production; it never keeps its own copy of the code.
- `lab/og.html` — the source for `og.png` (1200×630). Regenerated with
  `make og`.
- `public/` — `CNAME`, `robots.txt`, `sitemap.xml`, `favicon.svg`, `og.png`.
  Copied verbatim into the build. **`CNAME` leaving `public/` takes the domain
  down**, so treat that file as load-bearing.
- `test/unit/` — Vitest over the physics. `test/e2e/` — Playwright screenshots
  at three viewports, with baselines committed in `__screenshots__/`.
- `docs/adr/` — why this repo looks the way it does. Read before changing the
  build, the deployment or the module boundaries.

## Working here

- **`npm ci`, then `make dev`** → http://localhost:5173. `make help` lists
  everything else.
- **The television is off by default.** `?tv=1` turns it on. That gate is
  temporary — when the TV becomes visible to everyone, the single condition in
  `src/main.ts` goes away and nothing else changes. `?aqa=1` is separate and
  permanent: it forbids motion for screenshot tests — no drop, pinned shader
  time, no random glitches, daytime accent, one frame and no rAF loop, then
  `data-tv="ready"` on `<html>`. The two are orthogonal, so `?aqa=1` alone is
  the page without the TV, deterministically.
- **`make check` before calling anything done** (types, lint, format), plus
  `make unit` for anything under `src/tv/`. Run `make test` — which adds
  `make e2e` and `make size` — when a change could plausibly move a pixel or
  the byte count.
- **Screenshot baselines are exact.** The tolerance is zero pixels, and the
  tests only run inside the pinned Playwright container (`make e2e`), because
  macOS and CI Linux render differently. If a snapshot diff appears, it is a
  real change — look at it before reaching for `make e2e-update`.
- **The pre-paint script in `index.html` stays inline and hand-written.** It
  sets `data-theme` before first paint; bundle it and dark mode flashes light.
- **Prettier does not touch HTML** (`.prettierignore`). The markup is aligned
  by hand and its comments sit next to what they explain.
- **Commit messages are in Russian**, in the imperative mood, no prefixes and
  no trailing period — see `git log`. So is `README.md`. Keep both that way.
- **Keep the payload honest.** The page without the television is what every
  visitor pays for; `make size` holds it under 10 kB gzip and stops the TV
  chunk from growing more than 10% unnoticed. Adding a dependency to `src/`
  needs a reason.
- The page must stay fully usable with JavaScript off: no television, no theme
  button (it is `hidden` in the markup and JS reveals it), daytime
  accent colour, everything else intact.

## Agent skills

### Issue tracker

Issues live in GitHub Issues at `slavshik/slavshik.github.io`, via the `gh`
CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name. See
`docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See
`docs/agents/domain.md`.
