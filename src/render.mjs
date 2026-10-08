// Playwright screenshot + sharp post-processing.

import { existsSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { renderUrl, outputPath } from './lib.mjs';

const WRAPPER = '#___storybook_wrapper';

// Kill animations/transitions and give the story a transparent page background
// so the component's own background is what gets captured.
const FREEZE_CSS = `
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
    animation-duration: 0s !important;
    caret-color: transparent !important;
  }
  html, body { background: transparent !important; }
`;

// Resolve the viewport for a component: per-component override, else default.
function viewportFor(record, config) {
  const override = config.viewports?.[record.machine];
  if (typeof override === 'number') return { width: override, height: config.viewport.height };
  if (override && typeof override === 'object') return { ...config.viewport, ...override };
  return config.viewport;
}

// Render one component's chosen story to an image buffer.
async function shoot(page, record, chosen, config) {
  await page.setViewportSize(viewportFor(record, config));
  const url = renderUrl(config.siteUrl, chosen.story);
  const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  if (!response || !response.ok()) {
    throw new Error(`render HTTP ${response ? response.status() : 'no response'}`);
  }
  await page.addStyleTag({ content: FREEZE_CSS });
  await page.evaluate(() => document.fonts && document.fonts.ready);

  const wrapper = page.locator(WRAPPER);
  if ((await wrapper.count()) === 0) throw new Error('render wrapper not found');
  // Screenshot the component itself (the wrapper's first element child) so we
  // crop tight to the component rather than the full-width page container.
  const target = wrapper.locator(':scope > *').first();
  const el = (await target.count()) > 0 ? target : wrapper;

  const box = await el.boundingBox();
  if (!box || box.width < 2 || box.height < 2) throw new Error('component rendered empty');

  // Never crop: capture the element, then letterbox-fit it into the target.
  const raw = await el.screenshot({ type: 'png' });
  const pipeline = sharp(raw).resize(config.width, config.height, {
    fit: 'contain',
    background: config.background,
  });
  const buffer =
    config.format === 'png'
      ? await pipeline.png().toBuffer()
      : await pipeline.webp({ quality: 82 }).toBuffer();
  return buffer;
}

// Theme-relative asset URLs in stories (e.g. `/components/foundation/...`) only
// resolve through Storybook's dev-server middleware. Hitting the Drupal render
// endpoint directly, those 404. Rewrite `/components/*` to the theme's real web
// path so images render in the screenshot.
async function installAssetRewrite(page, themeUrlBase) {
  if (!themeUrlBase) return;
  await page.route('**/components/**', (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith('/components/')) {
      u.pathname = `${themeUrlBase}${u.pathname}`;
      return route.continue({ url: u.toString() });
    }
    return route.continue();
  });
}

// Render every given component record. Returns a results array. A per-component
// render problem is recorded as `skip` (not a hard failure): those components
// need a hand-made thumbnail.
export async function renderAll(records, picks, config, { onlyMissing = false } = {}) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: config.viewport, ignoreHTTPSErrors: true });
  await installAssetRewrite(page, config.themeUrlBase);
  const results = [];
  try {
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const chosen = picks[i];
      const out = outputPath(record, config.format);
      if (onlyMissing && existsSync(out)) {
        results.push({ machine: record.machine, status: 'exists', out });
        continue;
      }
      try {
        const buffer = await shoot(page, record, chosen, config);
        writeFileSync(out, buffer);
        results.push({ machine: record.machine, status: 'ok', out, story: chosen.label, bytes: buffer.length });
      } catch (e) {
        results.push({ machine: record.machine, status: 'skip', reason: e.message, story: chosen.label });
      }
    }
  } finally {
    await browser.close();
  }
  return results;
}
