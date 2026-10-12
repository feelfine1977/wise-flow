/** Ids of the BPMN bridge: BPMN, FlowGraph and activity ids, and which of them name an element. */
import type { MappingRow } from "./import.js";
import { type ModdleElement, flowIdOf } from "./moddle.js";

export interface IdMap {
  /** FlowGraph id → BPMN element id. */
  toBpmn: Record<string, string>;
  /** BPMN element id → FlowGraph id. */
  toFlow: Record<string, string>;
}

/** Task ↔ activity mapping: rows from `importBpmn` or an object activity id → task id (FlowGraph or BPMN id). */
export type ActivityMapping = MappingRow[] | Record<string, string>;

export function createIdMap(): IdMap {
  return { toBpmn: {}, toFlow: {} };
}

/** Record that the BPMN element `bpmnId` carries the FlowGraph id `flowId`. */
export function registerId(ids: IdMap, bpmnId: string, flowId: string): void {
  ids.toBpmn[flowId] = bpmnId;
  ids.toFlow[bpmnId] = flowId;
}

/** Mapping as a plain object: activity id → task node ids and the inverse. */
export function mappingIndex(mapping: ActivityMapping): { toTasks: Record<string, string[]>; toActivity: Record<string, string> } {
  const toTasks: Record<string, string[]> = {};
  const toActivity: Record<string, string> = {};
  const add = (task: string, activity: string) => {
    (toTasks[activity] ??= []).push(task);
    toActivity[task] = activity;
  };
  if (Array.isArray(mapping)) {
    for (const row of mapping) if (row.activityId) add(row.nodeId, row.activityId);
  } else {
    for (const [activity, task] of Object.entries(mapping)) add(task, activity);
  }
  return { toTasks, toActivity };
}

/** A BPMN element given by its BPMN id or by its moddle element (business object). */
export type BpmnElementRef = string | ModdleElement;

export interface IdResolver {
  /** FlowGraph id of a BPMN element. */
  flowId(element: BpmnElementRef): string;
  /** BPMN id of a FlowGraph id, when the element is known. */
  bpmnId(flowId: string): string | undefined;
  /** Activity id a FlowGraph id is mapped to, directly or through its BPMN id. */
  activityId(flowId: string): string | undefined;
  /** FlowGraph ids of the tasks mapped to an activity id. */
  flowIdsOfActivity(activityId: string): string[];
  /** Every id that names the element: BPMN id, FlowGraph id, then the mapped activity ids. */
  names(element: BpmnElementRef): string[];
  /** True when `id` names the element (the alias rule). */
  matches(element: BpmnElementRef, id: string): boolean;
}

/**
 * Options of `createIdResolver`. Without an entry in `ids`, a moddle element's
 * FlowGraph id is its `wise:flowId` or XML id and a BPMN id string is its own
 * FlowGraph id, so elements added after the id map was built (in the modeler)
 * still resolve. Mapped task ids may be FlowGraph or BPMN ids.
 */
export interface IdResolverOptions {
  /** The id map of `importBpmn` or `exportBpmn`. */
  ids?: IdMap;
  mapping?: ActivityMapping;
}

/** Resolve ids between BPMN, FlowGraph and activities. */
export function createIdResolver(options: IdResolverOptions = {}): IdResolver {
  const ids = options.ids ?? createIdMap();
  const { toTasks, toActivity } = mappingIndex(options.mapping ?? []);
  const activitiesOf = new Map<string, string[]>();
  for (const [activity, tasks] of Object.entries(toTasks)) for (const task of tasks) activitiesOf.set(task, [...(activitiesOf.get(task) ?? []), activity]);
  const own = (element: BpmnElementRef): [bpmnId: string, flowId: string] => {
    if (typeof element === "string") return [element, ids.toFlow[element] ?? element];
    const bpmnId = String(element.id ?? "");
    return [bpmnId, ids.toFlow[bpmnId] ?? flowIdOf(element)];
  };
  const names = (element: BpmnElementRef): string[] => {
    const [bpmnId, flowId] = own(element);
    return [...new Set([bpmnId, flowId, ...(activitiesOf.get(flowId) ?? []), ...(activitiesOf.get(bpmnId) ?? [])])];
  };
  return {
    flowId: (element) => own(element)[1],
    bpmnId: (flowId) => ids.toBpmn[flowId],
    activityId: (flowId) => toActivity[flowId] ?? toActivity[ids.toBpmn[flowId] ?? flowId],
    flowIdsOfActivity: (activityId) => [...new Set((toTasks[activityId] ?? []).map((task) => ids.toFlow[task] ?? task))],
    names,
    matches: (element, id) => names(element).includes(id),
  };
}

/**
 * Node ids of a graph renamed to their mapped activity ids, as `applyMapping`
 * renames them. When two nodes map to one activity the first keeps the
 * activity id and the others get `<activity>#2`, `#3`; a rename never takes an
 * id that another node already has.
 */
export interface ActivityRenaming {
  /** Old node id → new node id, for the renamed nodes only. */
  renamed: Map<string, string>;
  /** The id a node has after the renaming. */
  toMapped(flowId: string): string;
  /** The FlowGraph id of a node id after the renaming. */
  toFlow(mappedId: string): string;
}

/** Rename mapped nodes to their activity ids (see `ActivityRenaming`). */
export function renameToActivities(nodeIds: readonly string[], resolver: IdResolver): ActivityRenaming {
  const renamed = new Map<string, string>();
  const used = new Set(nodeIds);
  const taken = new Map<string, number>();
  for (const id of nodeIds) {
    const activity = resolver.activityId(id);
    if (!activity || activity === id) continue;
    const count = (taken.get(activity) ?? 0) + 1;
    taken.set(activity, count);
    let target = count === 1 ? activity : `${activity}#${count}`;
    while (used.has(target) && target !== id) target = `${target}_`;
    used.add(target);
    renamed.set(id, target);
  }
  const back = new Map([...renamed].map(([from, to]) => [to, from]));
  return {
    renamed,
    toMapped: (flowId) => renamed.get(flowId) ?? flowId,
    toFlow: (mappedId) => back.get(mappedId) ?? mappedId,
  };
}
