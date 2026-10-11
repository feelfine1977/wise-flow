export interface StylingContract { states: string[]; parts: Record<string, { kinds?: string[]; states?: string[] }> }
export type DrawnParts = Record<string, { kinds: string[]; states: string[] }>;
export const CONTRACT: string;
export function readContract(root?: string): StylingContract;
export function documentedParts(markdown: string): Map<string, { kinds: string[]; states: string[] }>;
export function stylingContractErrors(contract: StylingContract, found: DrawnParts, markdown: string): string[];
export function partsIn(roots: Iterable<ParentNode>): DrawnParts;
