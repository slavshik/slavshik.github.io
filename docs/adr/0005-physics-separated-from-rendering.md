# The Television's physics does not know about three.js

Status: accepted, not yet implemented

The 740-line `mount()` closure shared mutable state between physics, layout, input, theming and the render loop by having them all in scope together, so no part of it could be exercised alone. Splitting it into files forces a choice about how that state crosses the boundaries; passing one context object to everything would have preserved the coupling under a new name.

Instead the parts that are genuinely pure — the integrator, the Rope, the Palette reader, the shader sources — become functions over explicit arguments with no three.js in scope, and the parts that own effects become factories that receive only what they need. `mount()` is reduced to wiring.

## Consequences

- The integrator and the Rope are unit-testable with no browser and no WebGL.
- One incidental dependency is removed to make this true: the integrator's single `THREE.MathUtils.clamp` call becomes a local `clamp`.
- Wiring the modules together in `mount()` is now explicit and slightly verbose. That is the point; it is where the dependency graph became visible.
