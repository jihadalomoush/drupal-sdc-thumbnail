// Discovery, config, story-selection, and path helpers.
// No Drupal/drush dependency: the only runtime inputs are the theme's files on
// disk and the site URL used to reach the Storybook render endpoint.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';

export const DEFAULT_CONFIG = {
  // Path to the theme whose components get thumbnails. Required: set via
  // --theme or sdc-thumbnail.config.json.
  themePath: null,
  // Base URL of the running Drupal site (the storybook module must be enabled).
  // Required: set via --url or sdc-thumbnail.config.json.
  siteUrl: null,
  // Output thumbnail geometry and encoding.
  width: 600,
  height: 400,
  format: 'webp', // 'webp' | 'png'
  background: '#ffffff',
  // Viewport the component is laid out in before it is captured. A moderate
  // width keeps content components (cards, text) from rendering as a thin
  // full-width strip. Nothing is cropped: the capture is letterbox-fit.
  viewport: { width: 600, height: 900 },
  // Per-component viewport override (for full-width components like heroes or
  // multi-column layouts). Key = machine name, value = width (number) or
  // { width, height }. Example: { "media-banner": 1200, "card-pricing": 1100 }.
  viewports: {},
  // Web path the theme is served from (e.g. /themes/contrib/vartheme_bs5).
  // Derived from themePath when null; used to rewrite story image URLs.
  themeUrlBase: null,
  // Per-component story override. Key = component machine name, value = story
  // name (string) or zero-based index (number). Example: { "card": 2 }.
  stories: {},
  // Device pixel ratio the page is rendered at. Capturing at 2x (or more) gives
  // a larger source raster so small components (e.g. a single icon glyph)
  // downscale crisply into the output instead of being upscaled and blurry.
  // Clamped to 1..8. Higher = sharper but larger files and more memory.
  scale: 2,
  // When true, sharp will not upscale an element smaller than the output box
  // (keeps genuinely tiny elements crisp-but-small instead of blown up to fill).
  noEnlarge: false,
};

// Merge file config (sdc-thumbnail.config.json, looked up in the theme then the
// cwd) over the defaults, then CLI overrides over that.
export function loadConfig(themePathHint, cliOverrides = {}) {
  let config = { ...DEFAULT_CONFIG };
  const candidates = [
    themePathHint && join(themePathHint, 'sdc-thumbnail.config.json'),
    'sdc-thumbnail.config.json',
  ].filter(Boolean);
  for (const file of candidates) {
    if (existsSync(file)) {
      config = { ...config, ...JSON.parse(readFileSync(file, 'utf8')) };
      break;
    }
  }
  return { ...config, ...stripUndefined(cliOverrides) };
}

function stripUndefined(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

// Recursively collect every *.stories.json under <themePath>/components.
function findStoriesJson(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.stories.json')) out.push(full);
    }
  };
  if (existsSync(root)) walk(root);
  return out;
}

// Discover components that have BOTH a stories.json and a matching
// component.yml in the same directory. Returns one record per component.
export function discoverComponents(themePath) {
  const componentsRoot = join(themePath, 'components');
  const records = [];
  const skipped = [];
  for (const storiesPath of findStoriesJson(componentsRoot)) {
    const dir = dirname(storiesPath);
    const machine = basename(storiesPath).replace(/\.stories\.json$/, '');
    const componentYml = join(dir, `${machine}.component.yml`);
    if (!existsSync(componentYml)) continue; // not a real SDC (e.g. docs story)
    let data;
    try {
      data = JSON.parse(readFileSync(storiesPath, 'utf8'));
    } catch (e) {
      skipped.push({ machine, dir, reason: `unreadable stories.json: ${e.message}` });
      continue;
    }
    if (!Array.isArray(data.stories) || data.stories.length === 0) {
      skipped.push({ machine, dir, reason: 'no stories in stories.json' });
      continue;
    }
    records.push({ machine, dir, storiesPath, data });
  }
  return { records, skipped };
}

// Choose which story to screenshot:
//   1. explicit override (by name or zero-based index),
//   2. a story named "Default",
//   3. the first story.
// Returns { story, label } or throws if an override cannot be resolved.
export function pickStory(record, override) {
  const stories = record.data.stories;
  if (override !== undefined && override !== null) {
    if (typeof override === 'number') {
      const story = stories[override];
      if (!story) throw new Error(`story index ${override} out of range (${stories.length} stories)`);
      return { story, label: `#${override} ${story.name}` };
    }
    const story = stories.find((s) => s.name === override);
    if (!story) throw new Error(`no story named "${override}"`);
    return { story, label: override };
  }
  const byDefault = stories.find((s) => s.name === 'Default');
  if (byDefault) return { story: byDefault, label: 'Default' };
  return { story: stories[0], label: `${stories[0].name} (first)` };
}

// The storybook module's render route. The stored server.id is already in the
// exact URL-ready form Storybook itself uses to call the endpoint, so it is
// used verbatim (no re-encoding).
export function renderUrl(siteUrl, story) {
  const id = story?.parameters?.server?.id;
  if (!id) throw new Error('story has no parameters.server.id');
  return `${siteUrl.replace(/\/$/, '')}/storybook/stories/render/${id}`;
}

export function outputPath(record, format) {
  return join(record.dir, `${record.machine}.thumbnail.${format}`);
}
