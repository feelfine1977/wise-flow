import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ESLint } from 'eslint';

const eslint = new ESLint({ cwd: new URL('../..', import.meta.url).pathname });
const restricted = async (code, filePath = 'src/core/example.ts') => {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((m) => m.ruleId === 'no-restricted-syntax').length;
};

test('the source lint rejects spreading or applying an array to Math.max and Math.min', async () => {
  assert.equal(await restricted('export const f = (xs: number[]) => Math.max(...xs);\n'), 1);
  assert.equal(await restricted('export const f = (xs: number[]) => Math.min(0, ...xs.map((x) => x * 2));\n'), 1);
  assert.equal(await restricted('export const f = (xs: number[]) => Math.max(1, ...[...xs]);\n'), 1);
  assert.equal(await restricted('export const f = (xs: number[]) => Math.max.apply(null, xs);\n'), 1);
  assert.equal(await restricted('export const f = (xs: number[]) => <b>{Math.min(...xs)}</b>;\n', 'src/react/Example.tsx'), 1);
});

test('the source lint accepts reducing loops and spreads of array literals', async () => {
  assert.equal(await restricted('export const f = (xs: number[]) => xs.reduce((m, x) => Math.max(m, x), -Infinity);\n'), 0);
  assert.equal(await restricted('export const f = (a: number, b: number[]) => Math.min(...[a, 1], ...[b.length]);\n'), 0);
});
