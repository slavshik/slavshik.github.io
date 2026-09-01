# three.js as an npm dependency, not vendored

Status: accepted, not yet implemented

three.js was vendored into `vendor/` on purpose — zero external requests, no CDN that can disappear or change under the page — and `README.md` documents the exact `curl` incantation used to refresh it. That reasoning stands, but it was reasoning about a site with no build step.

With a build, `three` becomes a normal dependency: still bundled into our own output and still served from our own origin, so nothing about the no-third-party-requests property changes, but now tree-shaken instead of shipped whole as 751 KB of minified source. `vendor/` and the importmap go away.
