/** The scene of a shown BPMN diagram over the boxes of its rendered elements. */
import { type Box, type EdgeRoute, type FlowGraph, type FlowScene, type LodRules, type Locale, type Overlay, type Positions, buildScene, createPositions } from "../core/index.js";
import type { ActivityRenaming, IdResolver } from "./ids.js";
import { type ModdleElement, isType } from "./moddle.js";

/** What the scene reads of an element of the bpmn-js element registry. */
export interface RegistryElement {
  id: string;
  businessObject?: ModdleElement;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  waypoints?: { x: number; y: number }[];
  labelTarget?: unknown;
}

/** The ids of the shown diagram: the resolver and the renaming of mapped tasks to their activity ids. */
export interface DiagramIds {
  resolver: IdResolver;
  renaming: ActivityRenaming;
}

export interface DiagramPositions<E extends RegistryElement = RegistryElement> {
  positions: Positions;
  /** The rendered element of every node and group key of `positions`. */
  elements: Map<string, E>;
}

function isGroupShape(el: RegistryElement): boolean {
  const bo = el.businessObject;
  return isType(bo, "bpmn:Lane") || isType(bo, "bpmn:Participant") || (isType(bo, "bpmn:SubProcess") && ((bo?.get("flowElements") as unknown[] | undefined)?.length ?? 0) > 0);
}

/** Boxes of the rendered elements (not labels): tasks under their table ids, groups and flows under FlowGraph ids; the first element keeps a key. */
export function registryPositions<E extends RegistryElement>(registry: readonly E[], ids: DiagramIds): DiagramPositions<E> {
  const nodes: Record<string, Box> = {};
  const groups: Record<string, Box> = {};
  const edges: Record<string, EdgeRoute> = {};
  const elements = new Map<string, E>();
  for (const el of registry) {
    if (el.labelTarget || !el.businessObject) continue;
    const flowId = ids.resolver.flowId(el.businessObject);
    if (el.waypoints) {
      edges[flowId] ??= { points: el.waypoints.map((p) => ({ x: p.x, y: p.y })) };
      continue;
    }
    if (typeof el.x !== "number" || typeof el.y !== "number") continue;
    const group = isGroupShape(el);
    const key = group ? flowId : ids.renaming.toMapped(flowId);
    if (elements.has(key)) continue;
    elements.set(key, el);
    (group ? groups : nodes)[key] = { x: el.x, y: el.y, width: el.width ?? 0, height: el.height ?? 0 };
  }
  return { positions: createPositions({ nodes, groups, edges }, "di", "RIGHT"), elements };
}

export interface DiagramScene {
  scene: FlowScene;
  /** The given overlays the scene shows, in its order. */
  listed: Overlay[];
}

/**
 * The scene of the diagram's graph with overlay targets and arc endpoints
 * resolved to its ids. Sequence flows are drawn by the diagram, so no follows
 * self-loops are added.
 */
export function diagramScene(graph: FlowGraph = { nodes: [], edges: [] }, positions: Positions, overlays: Overlay[], ids: DiagramIds, options: { locale?: Locale; lod?: Partial<LodRules> } = {}): DiagramScene {
  const known = new Set([...graph.nodes, ...(graph.groups ?? [])].map((n) => n.id));
  const resolve = (id: string): string => {
    const flowId = ids.resolver.flowId(id);
    const task = ids.resolver.flowIdsOfActivity(id)[0];
    return [id, ids.renaming.toMapped(flowId), flowId, task && ids.renaming.toMapped(task)].find((k) => k && known.has(k)) ?? id;
  };
  const given = new Map<Overlay, Overlay>();
  for (const o of overlays) {
    const p = o.payload;
    given.set({ ...o, target: resolve(o.target), payload: o.kind === "arc" && p ? { ...p, source: p.source && resolve(p.source), target: p.target && resolve(p.target) } : p }, o);
  }
  const scene = buildScene(graph, positions, { overlays: [...given.keys()], locale: options.locale, lod: options.lod, lodBySize: true, selfLoops: false });
  return { scene, listed: scene.overlays.map((o) => given.get(o) ?? o) };
}
