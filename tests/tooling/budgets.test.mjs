import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertBudgets, gzipBytes } from '../../scripts/check-budgets.mjs';
test('size gates reject growth and missing measurements rather than silently passing', () => {
  assert.doesNotThrow(() => assertBudgets({ js: 100 }, { js: 100 }));
  for (const measured of [{ js: 101 }, {}, { js: NaN }, { js: -1 }]) assert.throws(() => assertBudgets(measured, { js: 100 }));
});
test('the library is measured as the sum of its files compressed one by one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wise-flow-gzip-'));
  try {
    for (const name of ['a.js', 'b.js']) writeFileSync(join(dir, name), '');
    // An empty file compresses to a 10-byte header, a 2-byte empty block and an 8-byte trailer.
    assert.equal(gzipBytes([join(dir, 'a.js')]), 20);
    assert.equal(gzipBytes([join(dir, 'a.js'), join(dir, 'b.js')]), 40);
    assert.equal(gzipBytes([]), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
