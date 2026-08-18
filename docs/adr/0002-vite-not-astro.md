# Plain Vite rather than Astro

Status: accepted, not yet implemented

`.devcontainer/devcontainer.json` forwards port 4321 and says in a comment that
Node is there in case the page grows into a blog and moves to Astro — so a
future reader finding plain Vite here will reasonably ask why the stated plan
was not followed.

Because the blog is conditional and the site is one page. Astro's value is in
multi-page routing, layouts and content collections, none of which exist yet,
and it would add framework surface to a site whose defining property is having
almost none. Astro runs on Vite, so this is a subset rather than a divergence:
if the blog becomes real, a single page of markup and styles is a small thing
to move.
