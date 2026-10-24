#!/usr/bin/env node
// Draws a FlowGraph (as csv-to-flowgraph.mjs writes it) as an SVG figure, without a browser.
//
//   node examples/event-log/render-svg.mjs graph.json --measure performance --activities 0.6 --paths 0.3 --out map.svg
//
// --measure is frequency (default), performance or shortfall; --activities and --paths are the shares of activities
// and paths shown, 0 to 1 (default 1, everything); --theme is print (default, for papers) or default (the screen's
// look); --preset fits the figure to a width with readable text: single-column, double-column or slide (default none). In this repository run `npm run build` first: the import below resolves to the built package. In an
// application that installed wise-flow, the same import works as it is.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { abstract, layout, toSVG, validateGraph } from 'wise-flow';

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    measure: { type: 'string', default: 'frequency' },
    activities: { type: 'string', default: '1' },
    paths: { type: 'string', default: '1' },
    theme: { type: 'string', default: 'print' },
    preset: { type: 'string', default: 'none' },
    title: { type: 'string' },
    out: { type: 'string' },
  },
});
const [graphPath] = positionals;
if (!graphPath) {
  console.error('Usage: render-svg.mjs <graph.json> [--measure frequency|performance|shortfall] [--activities 0..1] [--paths 0..1] [--theme print|default] [--preset single-column|double-column|slide] [--title text] [--out map.svg]');
  process.exit(2);
}

const full = JSON.parse(readFileSync(graphPath, 'utf8'));
const errors = validateGraph(full).filter((issue) => issue.level === 'error');
if (errors.length) throw new Error(`The graph is not valid: ${errors.map((issue) => issue.message).join('; ')}`);

// Fewer activities and paths keep a large log readable; the figure's caption says how much of the graph it shows.
const graph = abstract(full, { activityDetail: Number(options.activities), pathDetail: Number(options.paths) });
const positions = await layout(graph);
const svg = toSVG(
  { graph, positions, measure: options.measure, title: options.title ?? full.meta?.label },
  { theme: options.theme, preset: options.preset },
);
if (options.out) writeFileSync(options.out, svg);
else process.stdout.write(svg);
