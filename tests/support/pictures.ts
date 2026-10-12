/**
 * The pictures of failing rungs, saved beside the test report (`reports/`,
 * which CI keeps with the JUnit file) so that a test can attach them.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

export const PICTURES = "reports/thresholds";

/** Write a rung's picture (`pictureOf`) under `PICTURES`, named after its title; the path from the working directory. */
export function savePicture(title: string, svg: string): string {
  const file = resolve(PICTURES, `${title.replace(/[^\w.-]+/g, "-").replace(/^-|-$/g, "")}.svg`);
  mkdirSync(resolve(PICTURES), { recursive: true });
  writeFileSync(file, svg);
  return relative(process.cwd(), file);
}
