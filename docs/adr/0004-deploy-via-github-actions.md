# Deploy to Pages from GitHub Actions, not from a branch

Status: accepted, not yet implemented

Pages served `main`'s root directly, which a build step makes impossible. The alternatives were committing `dist/` (build output in every diff) or a `gh-pages` branch (a second branch of generated content). We publish the build artifact from a GitHub Actions workflow instead, so the repository still contains only source — the property worth keeping from the pre-build era.

## Consequences

- The Pages source setting must be switched from a branch to GitHub Actions.
- `CNAME` must be emitted into the build output or **slavshik.me stops resolving**. It moves to `public/` along with `robots.txt`, `sitemap.xml`, `favicon.svg` and `og.png`.
- Publishing is no longer instant on push; it waits for a build and for tests.
