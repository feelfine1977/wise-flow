import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertBudgets } from '../../scripts/check-budgets.mjs';
test('size gates reject growth and missing measurements rather than silently passing', () => {
  assert.doesNotThrow(() => assertBudgets({ js: 100 }, { js: 100 }));
  for (const measured of [{ js: 101 }, {}, { js: NaN }, { js: -1 }]) assert.throws(() => assertBudgets(measured, { js: 100 }));
});
