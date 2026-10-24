// Ship asset bytes and their original notices; CSS URLs remain relative to fonts.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const dependency = (name) => dirname(require.resolve(`${name}/package.json`));
const copy = (from, to) => {
  const target = join(root, "dist", to);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(from, target);
};
copy(join(root, "src/tokens.css"), "tokens.css");
// The library's rules in the cascade layer `wf`, React Flow's in its sublayer below them, so that
// any unlayered host rule wins; and the library's rules without a layer, for pages with an unlayered reset.
const reactFlowCss = readFileSync(join(dependency("@xyflow/react"), "dist/style.css"), "utf8");
const flowCss = readFileSync(join(root, "src/react/style.css"), "utf8");
const layered = `@layer wf.react-flow {\n${reactFlowCss}\n}\n@layer wf {\n${flowCss}\n}\n`;
writeFileSync(join(root, "dist/style.css"), layered);
copy(join(root, "src/react/style.css"), "style.unlayered.css");
copy(join(dependency("@xyflow/react"), "dist/style.css"), "react-flow.css");
// File by file: Node's recursive copy fails on some mounted file systems.
const copyDirectory = (from, to) => {
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.isDirectory()) copyDirectory(join(from, entry.name), join(to, entry.name));
    else copy(join(from, entry.name), join(to, entry.name));
  }
};
copyDirectory(join(dependency("bpmn-js"), "dist/assets"), "bpmn/assets");
writeFileSync(join(root, "dist/bpmn.css"), [
  '@import "./bpmn/assets/diagram-js.css";',
  '@import "./bpmn/assets/bpmn-js.css";',
  '@import "./bpmn/assets/bpmn-font/css/bpmn.css";',
  '',
].join("\n"));
copy(join(dependency("elkjs"), "lib/elk-worker.min.js"), "elk-worker.min.js");
// The Dagre worker: Dagre unchanged in a function scope of its own, and the compiled
// Dagre job of the layout module, which answers each input with `{ output }` or `{ error }`.
const { dagreJob } = await import(pathToFileURL(join(root, "dist/core/layout.js")).href);
writeFileSync(join(root, "dist/dagre-worker.min.js"), [
  `var flowDagre = (function () {\n${readFileSync(join(dependency("@dagrejs/dagre"), "dist/dagre.min.js"), "utf8").replace(/\n\/\/# sourceMappingURL=.*\s*$/, "")}\nreturn dagre;\n})();`,
  `var flowDagreJob = ${dagreJob};`,
  `self.onmessage = function (event) {
  var answer;
  try { answer = { output: flowDagreJob(flowDagre, event.data) }; } catch (error) { answer = { error: String(error && error.message || error) }; }
  self.postMessage(answer);
};`,
  "",
].join("\n"));
for (const [name, license] of [["bpmn-js", "LICENSE"], ["@xyflow/react", "LICENSE"], ["elkjs", "LICENSE.md"], ["@dagrejs/dagre", "LICENSE"], ["@dagrejs/graphlib", "LICENSE"]]) {
  copy(join(dependency(name), license), `licenses/${name.replaceAll("/", "-")}.txt`);
}
console.log("Copied Flow, React Flow, BPMN CSS/fonts, ELK worker, Dagre worker and notices.");
