/**
 * Minimal typing of `bpmn-moddle` (the package ships none). Only the surface
 * the BPMN bridge uses is declared; elements are typed structurally through
 * `ModdleElement` in `./moddle.ts`.
 */
declare module "bpmn-moddle" {
  export interface ModdleParseResult {
    rootElement: ModdleElementLike;
    elementsById: Record<string, ModdleElementLike>;
    references: unknown[];
    warnings: { message: string; error?: Error; element?: ModdleElementLike }[];
  }

  export interface ModdleElementLike {
    $type: string;
    $parent?: ModdleElementLike;
    $attrs?: Record<string, string>;
    id?: string;
    name?: string;
    get(name: string): unknown;
    set(name: string, value: unknown): void;
    [key: string]: unknown;
  }

  export default class BpmnModdle {
    constructor(packages?: Record<string, unknown>, options?: Record<string, unknown>);
    create(type: string, attrs?: Record<string, unknown>): ModdleElementLike;
    fromXML(xml: string, options?: Record<string, unknown>): Promise<ModdleParseResult>;
    toXML(element: ModdleElementLike, options?: { format?: boolean; preamble?: boolean }): Promise<{ xml: string; warnings?: unknown[] }>;
    getType(type: string): unknown;
  }
}
