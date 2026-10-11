import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allowList, cssLiterals, literalReport, tsLiterals } from '../../scripts/check-literals.mjs';

const list = allowList();
const css = (text) => cssLiterals(text, list.values).map((l) => `${l.rule}: ${l.text}`);
const module = (text, file = 'src/x.ts') => tsLiterals(text, file, list.values).map((l) => `${l.line} ${l.rule}`);

test('src/ names every size, radius, stroke, dash, weight, opacity and z-order in the token table', () => {
  assert.deepEqual(literalReport(), { violations: [], unused: [] });
});

test('the allow-list is short and every value and place in it is explained', () => {
  assert.deepEqual(list.values.px, [0, 1, -1]);
  assert.deepEqual(list.values.number, [0, 1, -1]);
  assert.ok(list.values.why.length > 40);
  for (const rule of Object.values(list.rules)) assert.ok(rule.length > 40);
  for (const place of list.places) assert.ok(place.file && place.text && place.why?.length > 20, JSON.stringify(place));
});

test('a stylesheet fails on a pixel length, a font size or weight, a radius, a stroke width, a dash, an opacity and a z-index', () => {
  assert.deepEqual(css('.a { padding: 4px 8px; }'), ['pixel length: padding: 4px 8px']);
  assert.deepEqual(css('.a { font-size: 0.875rem; }'), ['font size: font-size: 0.875rem']);
  assert.deepEqual(css('.a { font-weight: 600; }'), ['font weight: font-weight: 600']);
  assert.deepEqual(css('.a { border-radius: 50%; }'), ['radius: border-radius: 50%']);
  assert.deepEqual(css('.a { border-radius: 3px 0 0 var(--wf-radius-band); }'), ['pixel length: border-radius: 3px 0 0 var(--wf-radius-band)']);
  assert.deepEqual(css('.a { stroke-width: 2; }'), ['stroke width: stroke-width: 2']);
  assert.deepEqual(css('.a { stroke-dasharray: 4 3; }'), ['dash: stroke-dasharray: 4 3']);
  assert.deepEqual(css('.a { opacity: 0.35; }'), ['opacity: opacity: 0.35']);
  assert.deepEqual(css('.a { z-index: 30; }'), ['z-order: z-index: 30']);
  assert.deepEqual(css('.a { width: calc(100% - 16px); }'), ['pixel length: width: calc(100% - 16px)']);
});

test('a stylesheet passes with tokens, hairlines, none and relative layout', () => {
  assert.deepEqual(
    css(`.a {
      border: 1px solid var(--wf-line);
      margin: -1px;
      padding: 0;
      border-radius: 0;
      stroke-width: 1;
      opacity: 0;
      z-index: 0;
      font-size: var(--wf-text-panel);
      font-weight: var(--wf-weight-panel-heading);
      font: inherit;
      left: calc(-1 * var(--wf-stroke-node));
      width: calc(100% + 2 * var(--wf-stroke-node));
      background: color-mix(in srgb, var(--wf-group-color, var(--wf-line)) calc(100% * var(--wf-opacity-group-fill)), transparent);
      padding: 0.4rem 0.65rem;
      letter-spacing: 0.02em;
      /* 12px in a comment */
    }`),
    [],
  );
});

test('a module fails on a drawn literal: Canvas state, a dash, markup attributes, CSS pixels, mark properties and JSX', () => {
  assert.deepEqual(module('ctx.lineWidth = 2.5;'), ['1 lineWidth']);
  assert.deepEqual(module('ctx.lineWidth = highlighted ? Math.max(m.width, 2.5) : m.width;'), ['1 lineWidth']);
  assert.deepEqual(module('ctx.globalAlpha = dimmed ? 0.35 : 1;'), ['1 globalAlpha']);
  assert.deepEqual(module('ctx.setLineDash([6, 4]);'), ['1 setLineDash argument']);
  assert.deepEqual(module('ctx.font = `600 14px ${tokens.font}`;'), ['1 pixel length in a string']);
  assert.deepEqual(module('roundedRect(ctx, b, 10);'), ['1 roundedRect argument']);
  assert.deepEqual(module('out.push(`<rect rx="3" fill="${c}"/>`);'), ['1 rx in markup']);
  assert.deepEqual(module('text(0, 14, s, `font-size="13" font-weight="700" fill="${ink}"`);'), ['1 font-size in markup', '1 font-weight in markup']);
  assert.deepEqual(module('const a = `stroke-dasharray="6 4"`;'), ['1 stroke-dasharray in markup']);
  assert.deepEqual(module('const mark = { radius: 12, stroke: { paint: "value", width: 2 }, texts: [{ size: 10, weight: 700 }] };'), ['1 radius', '1 stroke width', '1 size', '1 weight']);
  assert.deepEqual(module('const RECONNECTED_DASH = Object.freeze([4, 3]);'), ['1 RECONNECTED_DASH']);
  assert.deepEqual(module('const e = <circle r={violates ? 6.5 : 5} strokeWidth={1.5} />;', 'src/x.tsx'), ['1 r', '1 strokeWidth']);
  assert.deepEqual(module('const s = { zIndex: hovered ? 5 : 0 };'), ['1 zIndex']);
});

test('a module passes with tokens, hairlines and layout arithmetic', () => {
  assert.deepEqual(
    module(`
      ctx.lineWidth = 1;
      ctx.lineWidth = strokeTokens.focus;
      ctx.setLineDash([]);
      ctx.font = \`\${role.size}px \${family}\`;
      roundedRect(ctx, g, g.height / 2);
      const mark = { radius: s.height / 2, box: { width: 14, height: 12 }, stroke: { paint: "ink", width: strokeTokens.gateway } };
      const r = Math.min(box.width, box.height) / 2 + 3;
      out.push(\`<rect rx="\${radiusTokens.band}" stroke-width="1" fill-opacity="0"/>\`);
      const label = "Activity key";
    `),
    [],
  );
});

test('the report names a literal the allow-list does not name, and an allow-list entry that names nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wf-literals-'));
  try {
    mkdirSync(join(dir, 'react'));
    writeFileSync(join(dir, 'react', 'style.css'), '.a { gap: 6px; }\n.b { margin: 3px; }\n');
    const places = [{ file: 'src/react/style.css', text: 'margin: 3px', why: 'an example place' }, { file: 'src/react/style.css', text: 'gap: 9px', why: 'matches nothing' }];
    // The directory stands for src/.
    const report = literalReport({ ...list, places }, dir);
    assert.deepEqual(report.violations.map((v) => `${v.file}:${v.line}: ${v.rule}: ${v.text}`), ['src/react/style.css:1: pixel length: gap: 6px']);
    assert.deepEqual(report.unused, [places[1]]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
