# AGENTS.md

`CLAUDE.md` is a symlink to this file — one set of instructions, two names.

## The repo

Personal site at **slavshik.me**, served by GitHub Pages from `main`.
Static: no build step, no package manager, no lockfile.

- `index.html` — the whole page. Markup, styles and page logic all live here.
- `tv.js` — the CRT television at the top of the page. ES module, lazy-loaded
  after first paint, only when WebGL is available.
- `vendor/` — three.js and `RoundedBoxGeometry`, vendored on purpose rather
  than pulled from a CDN. Wired up via an `importmap` in each HTML page.
- `lab/tv.html` — the television workbench: sliders over every physics
  constant, telemetry, theme and accent switching. Imports the same `/tv.js`
  as production; it never keeps its own copy of the code.
- `lab/og.html` — the source for `og.png` (1200×630). Regenerated with
  `make og`; the render command is also in a comment at the bottom of the file.
- `CNAME`, `robots.txt`, `sitemap.xml`, `favicon.svg`, `og.png` — service files.

## Working here

- **Use a server, never `file://`.** `tv.js` is an ES module, and modules do
  not load over `file://`. `make serve` → http://localhost:8000.
- **The television is off by default.** `?tv=1` turns it on. That gate is
  temporary — when the TV becomes visible to everyone, the single `if` in the
  bootstrap goes away and nothing else changes. `?aqa=1` is separate and
  permanent: it forbids motion for screenshot tests — no drop, pinned shader
  time, no random glitches, daytime accent, one frame and no rAF loop, then
  `data-tv="ready"` on `<html>`. The two are orthogonal, so `?aqa=1` alone is
  the page without the TV, deterministically.
- **`make check` before calling anything done**, and `make test` when a change
  could plausibly break how the page is served. `make test` includes `make e2e`,
  which drives a real Chromium and needs Playwright installed globally
  (`npm i -g playwright && npx playwright install chromium`) — it fails loudly
  rather than skipping if it isn't there. `make e2e` writes screenshots to
  `test/shots/` (gitignored); look at them, they are not baselines.
- **Commit messages are in Russian**, in the imperative mood, no prefixes and
  no trailing period — see `git log`. So is `README.md`. Keep both that way.
- **Don't add a build step or a dependency manager** without being asked. The
  absence of both is a deliberate property of this repo, and `README.md`
  explains why.
- The page must stay fully usable with JavaScript off: no television, daytime
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
