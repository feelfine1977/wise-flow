/**
 * The BPMN vocabulary of the bridge, one table read from tag to type by the
 * exporter and from type to tag by the importer.
 */
import { type FlowNode, hasTag } from "../core/index.js";
import { GENERATED_TAG, LOOP_TAG, gatewayLabel } from "./lite.js";
import { type ModdleElement, isType } from "./moddle.js";

type Pairs = readonly (readonly [tag: string, type: string])[];

export const BPMN_VOCABULARY = {
  eventDefinitions: [
    ["timer", "bpmn:TimerEventDefinition"],
    ["message", "bpmn:MessageEventDefinition"],
    ["error", "bpmn:ErrorEventDefinition"],
    ["signal", "bpmn:SignalEventDefinition"],
    ["escalation", "bpmn:EscalationEventDefinition"],
    ["terminate", "bpmn:TerminateEventDefinition"],
    ["conditional", "bpmn:ConditionalEventDefinition"],
  ] as Pairs,
  /** The last gateway is the default. */
  gateways: [
    ["and", "bpmn:ParallelGateway"],
    ["or", "bpmn:InclusiveGateway"],
    ["eventBased", "bpmn:EventBasedGateway"],
    ["complex", "bpmn:ComplexGateway"],
    ["xor", "bpmn:ExclusiveGateway"],
  ] as Pairs,
  /** Any other event is intermediate: it catches with the `catch` tag and throws without. */
  eventRoles: [
    ["start", "bpmn:StartEvent"],
    ["end", "bpmn:EndEvent"],
    ["boundary", "bpmn:BoundaryEvent"],
  ] as Pairs,
  intermediate: { role: "intermediate", catchTag: "catch", catch: "bpmn:IntermediateCatchEvent", throw: "bpmn:IntermediateThrowEvent" },
  /** Task sub-type tags; the type follows from the tag (`userTask` → `bpmn:UserTask`). */
  taskTypes: ["userTask", "serviceTask", "manualTask", "scriptTask", "businessRuleTask", "sendTask", "receiveTask", "callActivity", "subProcess"],
  loop: [LOOP_TAG, "bpmn:StandardLoopCharacteristics"],
  defaultFlow: "default",
  conditionalFlow: "conditional",
  /** Gateways tagged `generated` are written without a name; their label follows from the tags. */
  generated: GENERATED_TAG,
} as const;

const V = BPMN_VOCABULARY;
const typeOf = (pairs: Pairs, n: FlowNode) => pairs.find(([tag]) => hasTag(n, tag))?.[1];
const tagOf = (pairs: Pairs, el: ModdleElement) => pairs.find(([, type]) => isType(el, type))?.[0];

export function gatewayType(n: FlowNode): string {
  return typeOf(V.gateways, n) ?? V.gateways[V.gateways.length - 1][1];
}

export function gatewayTag(el: ModdleElement): string {
  return tagOf(V.gateways, el) ?? V.gateways[V.gateways.length - 1][0];
}

export function eventType(n: FlowNode): string {
  return typeOf(V.eventRoles, n) ?? (hasTag(n, V.intermediate.catchTag) ? V.intermediate.catch : V.intermediate.throw);
}

/** Role and catch tags of a BPMN event. */
export function eventTags(el: ModdleElement): string[] {
  const tags = [tagOf(V.eventRoles, el) ?? V.intermediate.role];
  if (isType(el, V.intermediate.catch)) tags.push(V.intermediate.catchTag);
  return tags;
}

/** Event definition types of the tags, in the order of the tags. */
export function eventDefinitionTypes(tags: readonly string[]): string[] {
  return tags.flatMap((tag) => V.eventDefinitions.filter(([t]) => t === tag).map(([, type]) => type));
}

export function eventDefinitionTag(definition: ModdleElement): string | undefined {
  return tagOf(V.eventDefinitions, definition);
}

export function isGeneratedGateway(n: FlowNode): boolean {
  return n.kind === "gateway" && hasTag(n, V.generated);
}

/** Label of an imported gateway: from its tags when it was generated and has no name. */
export function importedGatewayLabel(name: string | undefined, tags: string[] | undefined, fallback: string): string {
  return !name && tags?.includes(V.generated) ? gatewayLabel(tags) : fallback;
}
