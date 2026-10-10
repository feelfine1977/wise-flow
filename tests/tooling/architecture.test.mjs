import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { adapterViolations, boundaryViolations, bridgeViolations, deepImportViolations, entryNames, nodeTestViolations, seamNames, seamViolations, storyMaps, storyViolations } from '../../scripts/check-architecture.mjs';

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
test('the scene module, the overlay placement, the overlay, node and edge marks they read, their SVG elements and the legend and figure frame stay inside the core', () => {
  for (const name of ['scene.ts', 'overlay-geometry.ts', 'overlay-marks.ts', 'element-marks.ts', 'mark-svg.ts', 'observed-loops.ts', 'figure.ts', 'map-controller.ts', 'selection.ts', 'lanes.ts', 'layout.ts', 'layout-key.ts', 'tokens.ts']) {
    const path = fileURLToPath(new URL(`../../src/core/${name}`, import.meta.url));
    assert.deepEqual(boundaryViolations(path, readFileSync(path, 'utf8')), [], name);
  }
});

const bridgeFile = fileURLToPath(new URL('../../src/bpmn/example.ts', import.meta.url));
test('the BPMN bridge keeps React, the renderers, its entry point and eager bpmn-js out of its modules', () => {
  for (const source of [
    'import { useState } from "react";',
    'import { Legend } from "../react/Legend.js";',
    'export { BpmnView } from "./index.js";',
    'import Viewer from "bpmn-js/lib/NavigatedViewer.js";',
    'import { ReactFlow } from "@xyflow/react";',
    'const mod = import(name);',
  ]) assert.ok(bridgeViolations(bridgeFile, source).length > 0, source);
});
test('the BPMN bridge may use the core, itself, bpmn-moddle and bpmn-js on demand', () => {
  assert.deepEqual(bridgeViolations(bridgeFile, `
    import { buildScene } from '../core/index.js';
    import type { IdResolver } from './ids.js';
    import BpmnModdle from 'bpmn-moddle';
    const viewer = await import('bpmn-js/lib/Modeler.js');
  `), []);
});
test('the bridge modules as they are pass, and the entry point alone loads the view', () => {
  const dir = fileURLToPath(new URL('../../src/bpmn/', import.meta.url));
  for (const name of ['headless.ts', 'viewer.ts', 'bpmn-js.ts', 'projection.ts', 'scene.ts', 'ids.ts', 'import.ts', 'export.ts']) {
    assert.deepEqual(bridgeViolations(dir + name, readFileSync(dir + name, 'utf8')), [], name);
  }
  assert.ok(bridgeViolations(dir + 'index.ts', readFileSync(dir + 'index.ts', 'utf8')).length > 0);
});
test('Node tests reach the BPMN bridge without its entry point and without React', () => {
  const testFile = fileURLToPath(new URL('../../tests/core/example.test.ts', import.meta.url));
  for (const source of [
    'import { liteFromStages } from "../../src/bpmn/index";',
    'import { liteFromStages } from "../../src/bpmn/index.js";',
    'import { liteFromStages } from "../../src/bpmn";',
    'import { liteFromStages } from "../../src/bpmn/";',
    'import { BpmnView } from "../../src/react/BpmnView";',
    'import { render } from "@testing-library/react";',
    'import React from "react";',
  ]) assert.ok(nodeTestViolations(testFile, source).length > 0, source);
  assert.deepEqual(nodeTestViolations(testFile, 'import { liteFromStages } from "../../src/bpmn/headless";\nimport { describe } from "vitest";'), []);
});

const reactFile = fileURLToPath(new URL('../../src/react/example.ts', import.meta.url));
test('outside the core, names the core entry point provides come from the entry point', () => {
  const names = new Set(['FlowScene', 'buildScene']);
  for (const source of [
    'import type { FlowScene } from "../core/scene.js";',
    'import { buildScene as build } from "../core/scene.js";',
    'export { buildScene } from "../core/scene.js";',
    'export * from "../core/scene.js";',
    'import * as scene from "../core/scene.js";',
  ]) assert.ok(deepImportViolations(reactFile, source, names).length > 0, source);
  assert.deepEqual(deepImportViolations(reactFile, `
    import { type FlowScene, buildScene } from '../core/index.js';
    import { mapStep } from '../core/map-controller.js';
    import { retainScene } from '../canvas/scene.js';
  `, names), []);
});
test('the entry point names are read from its explicit lists', () => {
  const names = entryNames('export { a, /** @deprecated */ b } from "./x.js";\nexport type { C } from "./y.js";');
  assert.deepEqual([...names], ['a', 'b', 'C']);
  assert.ok(entryNames().has('buildScene'));
});

const src = (path) => fileURLToPath(new URL(`../../src/${path}`, import.meta.url));
test('the scene and the map controller are owned by the core: their names are declared nowhere else', () => {
  const names = seamNames();
  for (const name of ['buildScene', 'FlowScene', 'mapStep', 'MapState', 'menuKey', 'clickSelection']) assert.ok(names.has(name), name);
  assert.equal(names.get('buildScene'), 'src/core/scene.ts');
  assert.equal(names.get('mapStep'), 'src/core/map-controller.ts');
  for (const source of [
    'export function buildScene() {}',
    'function mapStep(state, event) { return state; }',
    'const menuKey = () => null;',
    'export interface MapState { focus: string }',
    'type FlowScene = {};',
  ]) assert.ok(seamViolations(src('react/example.ts'), source, names).length > 0, source);
  assert.deepEqual(seamViolations(src('canvas/example.ts'), `
    import { buildScene, mapStep } from '../core/index.js';
    export function prepareScene() { return buildScene; }
    const step = mapStep;
  `, names), []);
  assert.throws(() => seamNames(['src/react/map-controller.ts']), /stay inside the core/);
});
test('renderer adapters do not import each other outside their hosts', () => {
  for (const [file, source] of [
    ['canvas/draw.ts', 'import { Legend } from "../react/Legend.js";'],
    ['canvas/png.ts', 'import { projectMarks } from "../bpmn/projection.js";'],
    ['canvas/renderer.ts', 'import { useState } from "react";'],
    ['bpmn/projection.ts', 'import { drawScene } from "../canvas/draw.js";'],
    ['bpmn/index.ts', 'export { ProcessMap } from "../react/ProcessMap.js";'],
    ['react/ProcessMap.tsx', 'import { drawScene } from "../canvas/draw.js";'],
    ['react/nodes.tsx', 'import { projectMarks } from "../bpmn/projection.js";'],
    ['react/CanvasMap.tsx', 'import { selectionOf } from "../bpmn/viewer.js";'],
    ['react/BpmnView.tsx', 'const canvas = import("../canvas/index.js");'],
    ['react/OverlayLayer.tsx', 'const viewer = import("bpmn-js/lib/NavigatedViewer.js");'],
  ]) assert.ok(adapterViolations(src(file), source).length > 0, `${file}: ${source}`);
  for (const [file, source] of [
    ['react/CanvasMap.tsx', 'import { CanvasRenderer } from "../canvas/index.js";\nimport { useRef } from "react";'],
    ['react/map-elements.ts', 'import { retainScene } from "../canvas/scene.js";'],
    ['react/BpmnView.tsx', 'import { projectMarks } from "../bpmn/projection.js";'],
    ['bpmn/index.ts', 'export { BpmnView } from "../react/BpmnView.js";'],
    ['bpmn/bpmn-js.ts', 'const mod = await import("bpmn-js/lib/Modeler.js");'],
    ['canvas/draw.ts', 'import { buildScene } from "../core/index.js";\nimport { readTokens } from "./tokens.js";'],
  ]) assert.deepEqual(adapterViolations(src(file), source), [], `${file}: ${source}`);
});

test('stories take their maps from the shared module and never ask for an adaptive edge budget', () => {
  const story = fileURLToPath(new URL('../../stories/Example.stories.tsx', import.meta.url));
  const shared = fileURLToPath(new URL(`../../${storyMaps}`, import.meta.url));
  for (const [path, source] of [
    [story, 'import { ProcessMap } from "../src/react/index";\nexport const A = () => <ProcessMap graph={g} />;'],
    [story, 'import { ViewSwitcher as Views } from "../src/react/index";'],
    [story, 'import { CanvasMap } from "../src/react/CanvasMap";'],
    [story, 'import * as flow from "../src/react/index";'],
    [story, 'import { ProcessMap } from "./maps";\nexport const A = () => <ProcessMap graph={g} edgeBudget="adaptive" />;'],
    [story, 'export default { args: { edgeBudget: "adaptive" } };'],
    [shared, 'import { ProcessMap as M } from "../src/react/index";\nexport const P = (p) => <M {...p} />;'],
    [shared, 'import { ProcessMap as M } from "../src/react/index";\nexport const P = (p) => <M edgeBudget="all" {...p} />;'],
    [shared, 'import { ProcessMap as M } from "../src/react/index";\nexport const P = (p) => <M {...p} edgeBudget={p.edgeBudget} />;'],
    [shared, 'import { ViewSwitcher as V } from "../src/react/index";\nexport const P = (p) => <V {...p} edgeBudget={p.edgeBudget ?? undefined} />;'],
  ]) assert.ok(storyViolations(path, source).length > 0, source);
  for (const [path, source] of [
    [story, 'import { ProcessMap } from "./maps";\nimport { TraceTimeline, type Selection } from "../src/react/index";\nexport const A = () => <ProcessMap graph={g} />;'],
    [story, 'import { ProcessMap } from "./maps";\nexport const A = () => <ProcessMap graph={g} edgeBudget={500} />;'],
    [shared, 'import { ProcessMap as M } from "../src/react/index";\nexport const P = (p) => <M {...p} edgeBudget={p.edgeBudget ?? "all"} />;'],
    [shared, 'import { ViewSwitcher as V } from "../src/react/index";\nexport const P = (p) => <V {...p} edgeBudget={2000} />;'],
  ]) assert.deepEqual(storyViolations(path, source), [], source);
});

test('the stories as they are draw with a fixed edge budget', () => {
  for (const name of ['maps.tsx', 'ProcessMap.stories.tsx', 'Views.stories.tsx', 'Canvas.stories.tsx']) {
    const path = fileURLToPath(new URL(`../../stories/${name}`, import.meta.url));
    assert.deepEqual(storyViolations(path, readFileSync(path, 'utf8')), [], name);
  }
});
