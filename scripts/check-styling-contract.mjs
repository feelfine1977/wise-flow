// The styling contract: the parts, kinds and states of docs/styling-contract.json must be drawn
// by the interactive map and its panels and listed in the table of docs/API.md.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const CONTRACT = 'docs/styling-contract.json';
const BREAKING = `Removing a part, kind or state of the styling contract is a breaking change for every host stylesheet written against it: keep drawing it, or remove it from ${CONTRACT} and docs/API.md together with a Changeset that says so.`;

export function readContract(root = fileURLToPath(new URL('../', import.meta.url))) {
  return JSON.parse(readFileSync(root + CONTRACT, 'utf8'));
}

/** Rows `| \`part\` | element | kinds | states |` of the "Styling contract" section, with the names in backticks. */
export function documentedParts(markdown) {
  const start = markdown.indexOf('\n## Styling contract\n');
  if (start < 0) return new Map();
  const next = markdown.indexOf('\n## ', start + 1);
  const section = markdown.slice(start, next < 0 ? undefined : next);
  const names = (cell) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  return new Map([...section.matchAll(/^\| `([^`]+)` \|([^|]*)\|([^|]*)\|([^|]*)\|$/gm)].map(([, part, , kinds, states]) => [part, { kinds: names(kinds), states: names(states) }]));
}

/**
 * What the contract lists and the fixtures do not draw or the document does not list, and parts the
 * fixtures draw that the contract does not list. `found` maps each drawn part to its kinds and states.
 */
export function stylingContractErrors(contract, found, markdown) {
  const errors = [];
  const documented = documentedParts(markdown);
  const missing = (what, where) => errors.push(`${what} is listed in ${CONTRACT} but ${where}. ${BREAKING}`);
  for (const state of contract.states) if (!Object.values(contract.parts).some((p) => p.states?.includes(state))) errors.push(`state \`${state}\` belongs to no part of ${CONTRACT}`);
  for (const [part, { kinds = [], states = [] }] of Object.entries(contract.parts)) {
    const drawn = found[part];
    const row = documented.get(part);
    if (!drawn) missing(`part \`${part}\``, 'no element of the rendered fixtures carries it');
    if (!row) missing(`part \`${part}\``, 'docs/API.md does not list it');
    for (const kind of kinds) {
      if (drawn && !drawn.kinds.includes(kind)) missing(`kind \`${kind}\` of \`${part}\``, 'no element of the rendered fixtures carries it');
      if (row && !row.kinds.includes(kind)) missing(`kind \`${kind}\` of \`${part}\``, 'docs/API.md does not list it');
    }
    for (const state of states) {
      if (!contract.states.includes(state)) errors.push(`state \`${state}\` of \`${part}\` is not one of the contract's states`);
      if (drawn && !drawn.states.includes(state)) missing(`state \`${state}\` of \`${part}\``, 'no element of the rendered fixtures carries it');
      if (row && !row.states.includes(state)) missing(`state \`${state}\` of \`${part}\``, 'docs/API.md does not list it');
    }
  }
  for (const [part, { kinds, states }] of Object.entries(found)) {
    const listed = contract.parts[part];
    if (!listed) {
      errors.push(`part \`${part}\` is drawn but not listed in ${CONTRACT}; add it there and to docs/API.md`);
      continue;
    }
    for (const kind of kinds) if (!listed.kinds?.includes(kind)) errors.push(`kind \`${kind}\` of \`${part}\` is drawn but not listed in ${CONTRACT}; add it there and to docs/API.md`);
    for (const state of states) if (!listed.states?.includes(state)) errors.push(`state \`${state}\` of \`${part}\` is drawn but not listed in ${CONTRACT}; add it there and to docs/API.md`);
  }
  return errors;
}

/** The parts, kinds and states the `data-wf-*` attributes of the elements under `roots` carry. */
export function partsIn(roots) {
  const found = {};
  for (const root of roots) {
    for (const element of root.querySelectorAll('[data-wf-part]')) {
      const entry = (found[element.getAttribute('data-wf-part')] ??= { kinds: [], states: [] });
      const kind = element.getAttribute('data-wf-kind');
      if (kind && !entry.kinds.includes(kind)) entry.kinds.push(kind);
      for (const state of (element.getAttribute('data-wf-state') ?? '').split(' ').filter(Boolean)) if (!entry.states.includes(state)) entry.states.push(state);
    }
  }
  return found;
}
