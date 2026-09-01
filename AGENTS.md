# AGENTS.md

`CLAUDE.md` is a symlink to this file — one set of instructions, two names.

## The repo

Personal site at **slavshik.me**. Built with Vite, written in TypeScript, published to GitHub Pages from a GitHub Actions workflow. The repository contains only source: `dist/` is never committed.

- `index.html` — the markup, and nothing else. Vite's entry point. Metadata, JSON-LD and the pre-paint theme script live here; styles and logic do not.
- `src/main.ts` — page logic: time-of-day accent, theme button, the lazy television bootstrap.
- `src/styles.css` — the whole design.
- `src/tv/` — the CRT television, eleven modules. `index.ts` exports `mount()`; `physics.ts`, `constants.ts`, `look.ts` and `shaders.ts` contain no three and no WebGL, which is what makes the physics unit-testable. `lab.ts` is the workbench control surface and must stay out of the production chunk.
- **The look is a spec, not literals.** `src/tv/look.ts` holds every number about shape, materials and light; `cabinet.ts` builds the body from it and `lighting.ts` the lights. Tune in the Look Lab, then paste the numbers back here — never hand-edit a constructor call. Body dimensions are seeded from `constants.ts`, where physics and the raycast proxy also read them: if the cabinet changes size, that file changes first.
- `lab/tv.html` — the television workbench: sliders over every physics constant, telemetry, theme and accent switching. Imports the same `src/tv/` as production; it never keeps its own copy of the code.
- `lab/look.html` — the Look Lab: orbit the television, tune shape, materials and light, copy the spec back out as JSON, export GLB or USDZ. Does not call `mount()` — no physics, no input, no broadcast.
- `lab/og.html` — the source for `og.png` (1200×630). Regenerated with `make og`.
- `public/` — `CNAME`, `robots.txt`, `sitemap.xml`, `favicon.svg`, `og.png`. Copied verbatim into the build. **`CNAME` leaving `public/` takes the domain down**, so treat that file as load-bearing.
- `test/unit/` — Vitest over the physics and over the visit query string. `test/e2e/` — Playwright screenshots at three viewports, with baselines committed in `__screenshots__/`. `test/size.mjs` and `test/syntax.mjs` are the two checks over `dist/`: what it weighs, and whether it parses in the oldest browser we promise.
- `docs/adr/` — why this repo looks the way it does. Read before changing the build, the deployment or the module boundaries.

## Working here

- **`npm ci`, then `make dev`** → http://localhost:5173. `make help` lists everything else.
- **The television is on for everyone.** The `?tv=1` gate is gone; it loads wherever it is welcome, and the conditions that turn it away are all about the visitor, not the URL: `prefers-reduced-motion: reduce`, no WebGL2, `saveData`, under 2 GB of memory. `?aqa=1` is separate and permanent: it forbids motion for screenshot tests — no drop, pinned shader time, no random glitches, daytime accent, one frame and no rAF loop, then `data-tv="ready"` on `<html>`. The page without the television is now reached by emulating reduced motion, which is what the `page.png` baseline does.
- **A television that does not appear says why.** Whichever condition turned it away rides along with the visit as `x=` — `dom`, `rm`, `net`, `mem`, `gl` — and a chunk that fails to load or throws on mount reports itself afterwards as `x=err`, landing in the `why` column of `visits`. Without it a browser where the television is broken looks exactly like one where it was politely declined. `x=err` rows are reports, not visits: exclude them when counting.
- **Tune the look in the Look Lab, not in the source.** `make dev`, then `make look` — or `make lan`, which prints a LAN address so the same page opens on a phone or tablet. The Lab also ships to Pages at `/lab/look.html` (noindex, like every Lab), so tuning needs no laptop. Finished? The «JSON» button copies the whole spec; paste the changed numbers into `src/tv/look.ts` and re-run `make e2e`, which will show the new look as a baseline diff — look at it, then `make e2e-update`.
- **`make check` before calling anything done** (types, lint, format), plus `make unit` for anything under `src/tv/`. Run `make test` — which adds `make e2e`, `make size` and `make syntax` — when a change could plausibly move a pixel or the byte count.
- **Screenshot baselines are exact.** The tolerance is zero pixels, and the tests only run inside the pinned Playwright container (`make e2e`), because macOS and CI Linux render differently. If a snapshot diff appears, it is a real change — look at it before reaching for `make e2e-update`.
- **The pre-paint script in `index.html` stays inline and hand-written.** It sets `data-theme` before first paint; bundle it and dark mode flashes light.
- **Prettier does not touch HTML** (`.prettierignore`). The markup is aligned by hand and its comments sit next to what they explain — and a build plugin strips those comments out of `dist/`. They are Russian, two bytes a letter, and they were 1.35 kB gzipped: forty per cent of the page, more than its JS and CSS together. Indentation stays; collapsing it buys 78 bytes and costs a readable build.
- **Commit messages are in English, Conventional Commits.** `type(scope): subject` — imperative mood, lower case, no trailing period. History before 2026-09-01 is in Russian and free-form; do not rewrite it, just do not copy it. `README.md` stays in Russian — that rule changed for commits only.
- **Safari 16 is the floor, and it is a syntax problem, not an API one.** `build.target` in `vite.config.ts` names a browser next to the year because a year is not a browser: three declares its classes with `static {}`, WebKit only learned that in 16.4, and on iOS 16.3 the whole television chunk failed to parse — `import()` rejected, the `.catch()` swallowed it, the page stayed whole and said nothing. `make syntax` is what notices; it states the promise independently of how the build keeps it, so loosening the build fails the check rather than someone's phone.
- **Keep the payload honest.** The page without the television is what every visitor pays for; `make size` holds it under 10 kB gzip — markup included, which is how the comments were caught — and stops the TV chunk from growing more than 10% unnoticed. Adding a dependency to `src/` needs a reason.
- The page must stay fully usable with JavaScript off: no television, no theme button (it is `hidden` in the markup and JS reveals it), daytime accent colour, everything else intact.

## Agent skills

### Issue tracker

Issues live in GitHub Issues at `slavshik/slavshik.github.io`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### 3D renders

`/render` builds parametric build123d models and shows them in a local viewer. Vendored in `.claude/skills/render/`, never part of the site. See `docs/agents/render.md`.
