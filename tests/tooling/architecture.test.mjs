import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { boundaryViolations } from '../../scripts/check-architecture.mjs';

const file = fileURLToPath(new URL('../../src/core/example.ts', import.meta.url));
test('headless boundaries reject transitive entry points, types and dynamic renderer imports', () => {
  for (const source of [
    'import React from "react";',
    'export * from "../react/index.js";',
    'const view = import("bpmn-js/lib/Modeler");',
    'type View = import("../react/types.js").View;',
    'const view = import(location);',
  ]) assert.ok(boundaryViolations(file, source).length > 0, source);
});
test('headless checks allow local algorithms, reviewed layout imports and import-like comments', () => {
  assert.deepEqual(boundaryViolations(file, `
    import type { FlowGraph } from './model.js';
    export * from './filters.js';
    const elk = import('elkjs/lib/elk-api.js');
    // import React from 'react';
  `), []);
});
test('the scene module and the overlay placement and marks it reads stay inside the core', () => {
  for (const name of ['scene.ts', 'overlay-geometry.ts', 'overlay-marks.ts', 'observed-loops.ts']) {
    const path = fileURLToPath(new URL(`../../src/core/${name}`, import.meta.url));
    assert.deepEqual(boundaryViolations(path, readFileSync(path, 'utf8')), [], name);
  }
});
