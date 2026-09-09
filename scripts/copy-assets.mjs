// Ship asset bytes and their original notices; CSS URLs remain relative to fonts.
import { copyFileSync, cpSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const dependency = (name) => dirname(require.resolve(`${name}/package.json`));
const copy = (from, to) => {
  const target = join(root, "dist", to);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(from, target);
};
copy(join(root, "src/tokens.css"), "tokens.css");
copy(join(root, "src/react/style.css"), "style.css");
copy(join(root, "src/react/style.css"), "react/style.css");
copy(join(dependency("@xyflow/react"), "dist/style.css"), "react-flow.css");
cpSync(join(dependency("bpmn-js"), "dist/assets"), join(root, "dist/bpmn/assets"), { recursive: true });
writeFileSync(join(root, "dist/bpmn.css"), [
  '@import "./bpmn/assets/diagram-js.css";',
  '@import "./bpmn/assets/bpmn-js.css";',
  '@import "./bpmn/assets/bpmn-font/css/bpmn.css";',
  '',
].join("\n"));
copy(join(dependency("elkjs"), "lib/elk-worker.min.js"), "elk-worker.min.js");
for (const [name, license] of [["bpmn-js", "LICENSE"], ["@xyflow/react", "LICENSE"], ["elkjs", "LICENSE.md"]]) {
  copy(join(dependency(name), license), `licenses/${name.replaceAll("/", "-")}.txt`);
}
console.log("Copied Flow, React Flow, BPMN CSS/fonts, ELK worker and notices.");
