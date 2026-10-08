# drupal-sdc-thumbnail

Generate static thumbnail images for a Drupal theme's Single Directory
Components (SDC) by screenshotting their Storybook stories. The output is saved
next to each component as `{machine}.thumbnail.webp`, which the Canvas "static
preview image" feature then shows on hover instead of live-rendering the
component.

Pure Node + Playwright. It talks to a running Drupal site's Storybook render
endpoint; it does not call drush and does not run the Storybook Node server.

## How it works

1. Scan `<theme>/components/**/*.stories.json` for components (each must also
   have a matching `{machine}.component.yml`).
2. Pick one story per component: an explicit override, else a story named
   `Default`, else the first story.
3. Open the Drupal render endpoint for that story
   (`/storybook/stories/render/<server.id>`), which returns a full themed page
   with the component inside `#___storybook_wrapper`.
4. Screenshot the component (never cropped: it is letterbox-fit into the target
   size), encode WebP/PNG with sharp, and write
   `{machine}.thumbnail.{webp|png}`.

Story image URLs (`/components/...`) are rewritten to the theme's real web path
(`/themes/.../components/...`) in the browser, since that proxying is normally
done by Storybook's dev server, which this tool bypasses.

## Requirements

- Node 18+ (the DDEV web container's Node works; a too-old host Node does not).
- A running Drupal site with the `storybook` module **enabled**
  (`ddev drush en storybook`, part of `ddev storybook init`). In development
  mode the render endpoint is open; otherwise the request needs the
  "render storybook stories" permission.
- `*.stories.json` present for the components (`ddev storybook gen` regenerates
  them from the `*.stories.twig`).

## Install

```
cd tools/drupal-sdc-thumbnail
npm install
npx playwright install --with-deps chromium
```

## Usage

Run from the project root (so the relative theme path resolves), via the DDEV
container's Node:

```
ddev exec -d /var/www/html "node tools/drupal-sdc-thumbnail/src/index.mjs --theme web/themes/contrib/vartheme_bs5"
```

**Theme and site URL** come from flags or a config file (flags override the
config). Both are required:

- Site URL: `--url` or `siteUrl` in config.
- Theme path: `--theme` or `themePath` in config.

With a `sdc-thumbnail.config.json` that sets `themePath` and `siteUrl`, you can
run flag-free: `sdc-thumbnail`.

Options:

```
--theme <path>       Theme root (default from config)
--url <url>          Drupal site base URL (storybook module must be enabled)
--component <name>   Only this component machine name
--story <name|idx>   Story override for --component (name, or 0-based index)
--format <webp|png>  Output format (default webp)
--width <px>         Output width (default 600)
--height <px>        Output height (default 400)
--scale <n>          Capture device pixel ratio, 1..8 (default 2). Higher =
                     sharper small components, larger files / more memory
--no-enlarge         Do not upscale elements smaller than the output box
--only-missing       Skip components that already have a thumbnail
--help
```

## Config

`sdc-thumbnail.config.json` (looked up in the theme, then the cwd). CLI flags
override it.

```json
{
  "themePath": "web/themes/contrib/vartheme_bs5",
  "siteUrl": "https://my-site.ddev.site",
  "width": 600,
  "height": 400,
  "format": "webp",
  "scale": 2,
  "viewport": { "width": 600, "height": 900 },
  "viewports": { "media-banner": 1200, "card-pricing": 1100 },
  "stories": { "card": "Image left", "button": 2 }
}
```

- `viewport` — default layout width before capture. A moderate width keeps
  content components from rendering as a thin full-width strip. Nothing is
  cropped.
- `viewports` — per-component width (or `{ width, height }`) for full-width or
  multi-column components that need more room.
- `stories` — per-component story selection by name or 0-based index.
- `scale` — capture device pixel ratio (1..8, default 2). The page renders at
  this DPR so small components (e.g. a single icon glyph) have a large enough
  raster to downscale crisply instead of being upscaled and blurry. Higher =
  sharper but larger files and more memory. Equivalent CLI flag: `--scale`.
- `noEnlarge` (CLI `--no-enlarge`) — do not upscale an element smaller than the
  output box; keeps genuinely tiny elements crisp-but-small. Default off.

## Skipped components

Components whose chosen story renders empty (needs child items/slides, e.g.
`accordion-container`, `carousel`, `pagination`), that are demo stubs, or whose
render errors, are reported as skipped and left without a thumbnail. Supply a
hand-made `{machine}.thumbnail.webp` for those.

## Tests

```
npm test
```

Unit tests (Node's built-in `node:test`, no extra deps) cover the pure logic:
component discovery, story selection, config merging, and URL building, against
fixtures under `test/fixtures`. The Playwright/sharp render path needs a live
Drupal site and a browser, so it is exercised manually, not in these unit tests.

## Pairs with

The Canvas "static preview image for SDC components" patch, which serves
`{machine}.thumbnail.{png,webp,svg}` as the component's hover preview and skips
live rendering when present.
