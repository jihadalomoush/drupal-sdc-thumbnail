import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  DEFAULT_CONFIG,
  loadConfig,
  discoverComponents,
  pickStory,
  renderUrl,
  outputPath,
} from '../src/lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const THEME = join(here, 'fixtures', 'theme');
const WITH_CONFIG = join(here, 'fixtures', 'withconfig');

// Build a minimal record for pickStory tests.
function record(stories) {
  return { machine: 'x', dir: '/tmp/x', data: { stories } };
}
const story = (name, id) => ({ name, parameters: { server: { id } } });

test('pickStory: prefers a story named Default over the first', () => {
  const r = record([story('First', 'a'), story('Default', 'b')]);
  const { story: s, label } = pickStory(r, undefined);
  assert.equal(s.parameters.server.id, 'b');
  assert.equal(label, 'Default');
});

test('pickStory: falls back to the first story when no Default', () => {
  const r = record([story('Only', 'a'), story('Second', 'b')]);
  const { story: s, label } = pickStory(r, undefined);
  assert.equal(s.parameters.server.id, 'a');
  assert.match(label, /first/);
});

test('pickStory: override by zero-based index', () => {
  const r = record([story('A', 'a'), story('B', 'b'), story('C', 'c')]);
  assert.equal(pickStory(r, 2).story.parameters.server.id, 'c');
});

test('pickStory: override by index out of range throws', () => {
  const r = record([story('A', 'a')]);
  assert.throws(() => pickStory(r, 5), /out of range/);
});

test('pickStory: override by name', () => {
  const r = record([story('A', 'a'), story('Image left', 'b')]);
  assert.equal(pickStory(r, 'Image left').story.parameters.server.id, 'b');
});

test('pickStory: override by missing name throws', () => {
  const r = record([story('A', 'a')]);
  assert.throws(() => pickStory(r, 'Nope'), /no story named/);
});

test('renderUrl: joins site + server id, strips trailing slash', () => {
  const url = renderUrl('https://site.test/', story('D', 'HASH'));
  assert.equal(url, 'https://site.test/storybook/stories/render/HASH');
});

test('renderUrl: throws when the story has no server id', () => {
  assert.throws(() => renderUrl('https://site.test', { name: 'D', parameters: {} }), /server\.id/);
});

test('outputPath: dir + machine + format', () => {
  assert.equal(
    outputPath({ dir: '/t/card', machine: 'card' }, 'webp'),
    '/t/card/card.thumbnail.webp',
  );
});

test('discoverComponents: finds SDCs with a stories.json + component.yml', () => {
  const { records, skipped } = discoverComponents(THEME);
  const machines = records.map((r) => r.machine).sort();
  // alpha + delta are valid; beta has no component.yml; gamma has empty stories.
  assert.deepEqual(machines, ['alpha', 'delta']);
  // gamma is reported as skipped; beta is excluded silently (no component.yml).
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].machine, 'gamma');
  assert.match(skipped[0].reason, /no stories/);
});

test('discoverComponents: chosen stories resolve correctly per component', () => {
  const { records } = discoverComponents(THEME);
  const byMachine = Object.fromEntries(records.map((r) => [r.machine, r]));
  assert.equal(pickStory(byMachine.alpha, undefined).story.parameters.server.id, 'alpha-default');
  assert.equal(pickStory(byMachine.delta, undefined).story.parameters.server.id, 'delta-only');
});

test('loadConfig: returns defaults when no config file is found', () => {
  const cfg = loadConfig(THEME, {}); // THEME dir has no config file
  assert.equal(cfg.format, DEFAULT_CONFIG.format);
  assert.equal(cfg.width, DEFAULT_CONFIG.width);
  assert.equal(cfg.themePath, null);
});

test('loadConfig: merges values from sdc-thumbnail.config.json', () => {
  const cfg = loadConfig(WITH_CONFIG, {});
  assert.equal(cfg.format, 'png');
  assert.equal(cfg.width, 123);
  assert.equal(cfg.siteUrl, 'https://cfg.example');
});

test('loadConfig: CLI overrides beat the file; undefined is ignored', () => {
  const cfg = loadConfig(WITH_CONFIG, { format: 'webp', width: undefined });
  assert.equal(cfg.format, 'webp'); // CLI wins
  assert.equal(cfg.width, 123); // undefined did not clobber the file value
});
