// Copies the stylesheets next to the compiled output so that consumers can
// import `@wise/flow/tokens.css` and `@wise/flow/style.css`.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  ["src/tokens.css", "dist/tokens.css"],
  ["src/react/style.css", "dist/style.css"],
  ["src/react/style.css", "dist/react/style.css"],
];
for (const [from, to] of files) {
  mkdirSync(dirname(join(root, to)), { recursive: true });
  copyFileSync(join(root, from), join(root, to));
}
console.log(`copied ${files.length} stylesheets to dist/`);
