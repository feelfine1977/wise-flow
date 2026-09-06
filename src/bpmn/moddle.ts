/**
 * bpmn-moddle setup shared by the exporter, the importer and `<BpmnView/>`:
 * the `wise` extension carries FlowGraph ids, kinds, tags and metrics through
 * BPMN 2.0 XML so that an export → import round trip is lossless.
 */
import BpmnModdle from "bpmn-moddle";

/** Namespace of the `wise` extension attributes and elements. */
export const WISE_NS = "http://wise-workbench.org/schema/flow";

/**
 * Moddle descriptor of the extension. Registered under the prefix `wise`:
 * `wise:flowId` (the FlowGraph id when it is not a valid XML id), `wise:kind`
 * (FlowGraph node or group kind when it differs from the BPMN default),
 * `wise:tags` (space-separated) and `<wise:metric name value/>` extension
 * elements for the numbers of an element.
 */
export const wiseModdleDescriptor = {
  name: "Wise",
  uri: WISE_NS,
  prefix: "wise",
  xml: { tagAlias: "lowerCase" },
  types: [
    {
      name: "Origin",
      extends: ["bpmn:BaseElement"],
      properties: [
        { name: "flowId", isAttr: true, type: "String" },
        { name: "kind", isAttr: true, type: "String" },
        { name: "tags", isAttr: true, type: "String" },
      ],
    },
    {
      name: "Metric",
      superClass: ["Element"],
      properties: [
        { name: "name", isAttr: true, type: "String" },
        { name: "value", isAttr: true, type: "Real" },
      ],
    },
  ],
} as const;

/** Structural view of a moddle element (bpmn-moddle ships no types). */
export interface ModdleElement {
  $type: string;
  $parent?: ModdleElement;
  $attrs?: Record<string, string>;
  id?: string;
  name?: string;
  get(name: string): unknown;
  set(name: string, value: unknown): void;
  [key: string]: unknown;
}

export interface ModdleParseWarning {
  message: string;
  error?: Error;
  element?: ModdleElement;
}

/** The subset of bpmn-moddle the bridge relies on. */
export interface BpmnModdleInstance {
  create(type: string, attrs?: Record<string, unknown>): ModdleElement;
  fromXML(xml: string): Promise<{ rootElement: ModdleElement; elementsById: Record<string, ModdleElement>; warnings: ModdleParseWarning[] }>;
  toXML(element: ModdleElement, options?: { format?: boolean; preamble?: boolean }): Promise<{ xml: string }>;
}

/** A bpmn-moddle instance with the `wise` extension registered. */
export function createModdle(): BpmnModdleInstance {
  return new BpmnModdle({ wise: wiseModdleDescriptor }) as unknown as BpmnModdleInstance;
}

/** Read a `wise:` attribute whether the extension is registered or not. */
export function wiseAttr(el: ModdleElement, name: "flowId" | "kind" | "tags"): string | undefined {
  const direct = el.get(`wise:${name}`);
  if (typeof direct === "string" && direct.length > 0) return direct;
  const raw = el.$attrs?.[`wise:${name}`];
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

/** The FlowGraph id of a BPMN element: the `wise:flowId` origin when present, the XML id otherwise. */
export function flowIdOf(el: ModdleElement): string {
  return wiseAttr(el, "flowId") ?? String(el.id ?? "");
}

/** True when the element is an instance of the BPMN type (moddle's `$instanceOf`). */
export function isType(el: ModdleElement | undefined, type: string): boolean {
  if (!el) return false;
  const fn = (el as { $instanceOf?: (t: string) => boolean }).$instanceOf;
  if (typeof fn === "function") return fn.call(el, type);
  return el.$type === type;
}

export function isAnyType(el: ModdleElement | undefined, types: string[]): boolean {
  return types.some((t) => isType(el, t));
}

/** Type name without the `bpmn:` prefix and with a lower-case first letter, as used in tags: `bpmn:UserTask` → `userTask`. */
export function tagOfType(type: string): string {
  const local = type.includes(":") ? type.slice(type.indexOf(":") + 1) : type;
  return local.charAt(0).toLowerCase() + local.slice(1);
}

/** Inverse of `tagOfType`: `userTask` → `bpmn:UserTask`. */
export function typeOfTag(tag: string): string {
  const local = tag.startsWith("bpmn:") ? tag.slice(5) : tag;
  return `bpmn:${local.charAt(0).toUpperCase()}${local.slice(1)}`;
}
