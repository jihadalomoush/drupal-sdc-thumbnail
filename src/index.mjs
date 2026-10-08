#!/usr/bin/env node
// CLI entry point: discover theme SDC components, pick one story each, render a
// thumbnail via the Drupal storybook render endpoint, and write it next to the
// component as {machine}.thumbnail.{webp|png}.

import { parseArgs } from 'node:util';
import { loadConfig, discoverComponents, pickStory } from './lib.mjs';
import { renderAll } from './render.mjs';

const { values } = parseArgs({
  options: {
    theme: { type: 'string' },
    url: { type: 'string' },
    component: { type: 'string' }, // limit to one machine name
    story: { type: 'string' }, // override story for the single --component
    format: { type: 'string' }, // webp | png
    width: { type: 'string' },
    height: { type: 'string' },
    scale: { type: 'string' }, // device pixel ratio for capture (1..4, default 2)
    'no-enlarge': { type: 'boolean' }, // don't upscale elements smaller than the box
    'only-missing': { type: 'boolean' },
    help: { type: 'boolean' },
  },
});

if (values.help) {
  console.log(`Usage: sdc-thumbnail [options]

  --theme <path>       Theme root (default from config: web/themes/contrib/vartheme_bs5)
  --url <url>          Drupal site base URL (storybook module must be enabled)
  --component <name>   Only this component machine name
  --story <name|idx>   Story override for --component (name, or 0-based index)
  --format <webp|png>  Output format (default webp)
  --width <px>         Output width (default 600)
  --height <px>        Output height (default 400)
  --scale <n>          Capture device pixel ratio, 1..8 (default 2). Higher =
                       sharper small components, larger files / more memory
  --no-enlarge         Do not upscale elements smaller than the output box
                       (keeps tiny elements crisp-but-small instead of blurry)
  --only-missing       Skip components that already have a thumbnail
  --help
`);
  process.exit(0);
}

const config = loadConfig(values.theme, {
  themePath: values.theme,
  siteUrl: values.url,
  format: values.format,
  width: values.width ? Number(values.width) : undefined,
  height: values.height ? Number(values.height) : undefined,
  scale: values.scale ? Number(values.scale) : undefined,
  noEnlarge: values['no-enlarge'] || undefined,
});

// Clamp the capture scale to a sane range; fall back to 2 on bad input.
// 2-3 is enough for most components; higher mainly helps genuinely tiny
// elements (single glyphs) and costs memory/time (raster grows ~scale^2).
const requestedScale = Number(config.scale);
config.scale = Number.isFinite(requestedScale)
  ? Math.min(8, Math.max(1, requestedScale))
  : 2;

if (!config.themePath || !config.siteUrl) {
  console.error(
    'Missing required config. Provide both:\n' +
      '  --theme <path to theme>   (or "themePath" in sdc-thumbnail.config.json)\n' +
      '  --url <drupal site url>   (or "siteUrl" in sdc-thumbnail.config.json)\n' +
      'The site must be running with the "storybook" module enabled.',
  );
  process.exit(2);
}

// Derive the theme's web path (for rewriting story image URLs) from the theme
// filesystem path when not set explicitly: .../web/themes/x -> /themes/x.
if (!config.themeUrlBase) {
  const m = config.themePath.replace(/\\/g, '/').match(/(?:^|\/)web\/(.+?)\/?$/);
  config.themeUrlBase = m ? `/${m[1]}` : null;
}

const { records, skipped } = discoverComponents(config.themePath);

let selected = records;
if (values.component) {
  selected = records.filter((r) => r.machine === values.component);
  if (selected.length === 0) {
    console.error(`No component with stories found for "${values.component}" under ${config.themePath}`);
    process.exit(1);
  }
}

// Resolve the story for each selected component up front, so a bad override
// fails fast and clearly.
const picks = [];
const ready = [];
for (const record of selected) {
  let override = config.stories[record.machine];
  if (values.component && values.story !== undefined) {
    override = /^\d+$/.test(values.story) ? Number(values.story) : values.story;
  }
  try {
    picks.push(pickStory(record, override));
    ready.push(record);
  } catch (e) {
    console.warn(`skip ${record.machine}: ${e.message}`);
  }
}

console.log(
  `Theme: ${config.themePath}\n` +
    `Site:  ${config.siteUrl}\n` +
    `Components with stories: ${records.length}` +
    (skipped.length ? ` (skipped ${skipped.length} without usable stories)` : '') +
    `\nRendering: ${ready.length} -> ${config.width}x${config.height} ${config.format}\n`,
);

const results = await renderAll(ready, picks, config, { onlyMissing: values['only-missing'] });

let ok = 0;
let skip = 0;
for (const r of results) {
  if (r.status === 'ok') {
    ok++;
    console.log(`  ok    ${r.machine}  [${r.story}]  ${(r.bytes / 1024).toFixed(1)} KB`);
  } else if (r.status === 'exists') {
    console.log(`  keep  ${r.machine}  (already has thumbnail)`);
  } else {
    skip++;
    console.log(`  skip  ${r.machine}  [${r.story}]  ${r.reason} (needs a manual thumbnail)`);
  }
}
for (const s of skipped) {
  skip++;
  console.log(`  skip  ${s.machine}  (${s.reason})`);
}

console.log(`\nDone: ${ok} rendered, ${skip} skipped (need manual thumbnails).`);
process.exit(0);
