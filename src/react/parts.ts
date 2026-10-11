/**
 * The data attributes of the styling contract (`docs/styling-contract.json`):
 * the part an element is, its kind and its states, space-separated.
 */
export function part(name: string, kind?: string, states?: unknown[]): Record<string, string | undefined> {
  return { "data-wf-part": name, "data-wf-kind": kind, "data-wf-state": states?.filter((s) => typeof s === "string").join(" ") || undefined };
}
