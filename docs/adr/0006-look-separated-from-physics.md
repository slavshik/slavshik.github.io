# The Television's Look is data, and the Look Lab does not mount the Television

Status: accepted

ADR-0005 split physics from rendering, but the _look_ — cabinet geometry, materials, lights — stayed where it was: three hundred lines of `buildTV()` with every dimension written as a literal into a constructor call, plus five lines of lights inside `mount()`. Tuning any of it meant editing code blind and reloading, and the only workbench, `lab/tv.html`, boots the whole `mount()`: physics, input, broadcast, layout derived from the page's `<h1>`, camera nailed to a head-on view. It answers "does the toy fall correctly", not "is this the right shape".

Two decisions follow.

**The look is a plain-data spec.** `src/tv/look.ts` holds every number — with no three.js and no DOM in scope, like `constants.ts` — and `cabinet.ts` and `lighting.ts` are factories over it. Body dimensions are seeded from `constants.ts` rather than restated: physics, the raycast proxy and the layout already measure the Television there, and a second source of dimensions would diverge on the first tuning session.

**The Look Lab does not call `mount()`.** `lab/look.html` builds renderer, camera, orbit, lights and cabinet directly — about sixty lines, which is the whole point of the seam. Its panel is generated from a schema over the spec, so a new field costs one line, and geometry changes rebuild the cabinet rather than mutating meshes: the same path the numbers take to production.

## Consequences

- The refactor was required to be pixel-identical; the zero-tolerance screenshot baselines are what proved it, and they did not move.
- New lighting levers (rim light, environment map, tone mapping) ship switched off. A spec of zeroes must render exactly what the old code did, otherwise the baselines cannot tell a refactor from a redesign.
- The model stays procedural. glTF and USDZ are _exports_ from the Lab — for Blender, and for AR Quick Look on iOS — not a runtime format: a loader plus a binary would cost the visitor bytes and cost the Lab its sliders.
- A third HTML entry made the bundler split the shared `src/tv/` modules into a second chunk, which the visitor would have paid for with an extra request. `advancedChunks` in `vite.config.ts` pins the Television back into one chunk.
- Real shadow maps are deliberately absent from the Lab. There is no floor under the Television on the page — the contact shadow is a billboard — so a shadow map would tune something that can never ship.
