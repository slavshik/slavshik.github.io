# Adopt a build step and TypeScript

Status: accepted, not yet implemented

The site was deliberately built with no build step and no dependency manager, and `README.md` argued the case: nothing to install, nothing to break, the repository is the deployed artifact. That property has been given up on purpose. `tv.js` had grown to 1343 lines in a single file with a 740-line `mount()` closure, which no amount of discipline was going to make navigable — for a person or for an agent — and the physics inside it could not be tested without a browser and a WebGL context.

We accept a Vite build and npm dependencies in exchange for TypeScript, module boundaries, tree-shaken output and a real test harness.

## Consequences

- `README.md` and `AGENTS.md` both assert the opposite and must be rewritten; the README's reasoning is worth preserving as history, not as instruction.
- The repository is no longer the deployed artifact. See ADR-0004.
- "It works if you just open the file" stops being true; a dev server was already required for ES modules, so this is a smaller loss than it reads.
