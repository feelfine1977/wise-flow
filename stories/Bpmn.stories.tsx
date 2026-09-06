import type { Meta, StoryObj } from "@storybook/react";
import elkWorkerUrl from "elkjs/lib/elk-worker.min.js?url";
import { useEffect, useMemo, useRef, useState } from "react";
import { constraintItems, globalScene, vendorSceneKey } from "../fixtures/bpic2019";
import { p2pStages, withSceneMetrics } from "../fixtures/p2p_stages";
import smallXml from "../fixtures/p2p_small.bpmn?raw";
import {
  type BpmnExport,
  type BpmnImport,
  type BpmnSelection,
  type BpmnValidation,
  type BpmnViewHandle,
  BpmnView,
  applyMapping,
  exportBpmn,
  importBpmn,
  liteCounts,
  liteFromGraph,
  liteFromStages,
  validateBpmn,
} from "../src/bpmn/index";
import { type FlowGraph, type Overlay, overlaysFor } from "../src/index";
import { ProcessMap } from "../src/react/index";

const meta: Meta = {
  title: "BPMN",
  parameters: { layout: "fullscreen" },
};
export default meta;

const layout = { elkWorkerUrl };
const activities = globalScene.nodes.filter((n) => n.kind === "activity").map((n) => ({ id: n.id, label: n.label }));

const panel: React.CSSProperties = {
  padding: "6px 12px",
  borderBottom: "1px solid var(--wf-line)",
  display: "flex",
  gap: 16,
  alignItems: "center",
  flexWrap: "wrap",
  fontFamily: "var(--wf-font)",
  fontSize: 12,
  color: "var(--wf-ink)",
  background: "var(--wf-paper)",
};

function Counts({ graph }: { graph: FlowGraph }) {
  const c = liteCounts(graph);
  return (
    <span data-testid="lite-counts" style={{ color: "var(--wf-ink-muted)" }}>
      {c.tasks} tasks · {c.gateways} gateways · {c.events} events · {c.flows} flows · {c.lanes} lanes
    </span>
  );
}

function SelectionReadout({ selection, hovered }: { selection: BpmnSelection; hovered: string | null }) {
  return (
    <span data-testid="bpmn-selection" style={{ fontVariantNumeric: "tabular-nums" }}>
      selected tasks [{selection.tasks.join(", ")}] flows [{selection.flows.join(", ")}] lanes [{selection.lanes.join(", ")}]
      {hovered ? ` · hover ${hovered}` : ""}
    </span>
  );
}

/**
 * The purchase-to-pay stage model (known activities, no log) as a BPMN-lite
 * graph: one start, one end, tasks per stage, XOR gateways around optional
 * activities and the goods-or-service choice, lanes from the stages or the
 * roles. Rendered on bpmn-js from the exported BPMN 2.0 XML, or natively on
 * the process map.
 */
export const FromStages: StoryObj = {
  name: "from stage model (P2P)",
  render: () => {
    const [lanes, setLanes] = useState<"stage" | "role" | "none">("stage");
    const [native, setNative] = useState(false);
    const [mode, setMode] = useState<"view" | "model">("view");
    const [withOverlays, setWithOverlays] = useState(false);
    const [selection, setSelection] = useState<BpmnSelection>({ tasks: [], flows: [], lanes: [] });
    const [hovered, setHovered] = useState<string | null>(null);
    const lite = useMemo(() => liteFromStages(withSceneMetrics(p2pStages, globalScene), { lanes }), [lanes]);
    const overlays = useMemo(() => (withOverlays ? overlaysFor(constraintItems("global"), { graph: lite }) : []), [withOverlays, lite]);
    return (
      <div style={{ display: "grid", gridTemplateRows: "auto 1fr", height: "100vh", width: "100vw" }}>
        <div style={panel}>
          <strong>Stage model → BPMN-lite</strong>
          <Counts graph={lite} />
          <label>
            Lanes{" "}
            <select value={lanes} onChange={(e) => setLanes(e.target.value as typeof lanes)}>
              <option value="stage">stages</option>
              <option value="role">roles</option>
              <option value="none">none</option>
            </select>
          </label>
          <label>
            <input type="checkbox" checked={native} onChange={(e) => setNative(e.target.checked)} /> native process map
          </label>
          <label>
            <input type="checkbox" checked={mode === "model"} onChange={(e) => setMode(e.target.checked ? "model" : "view")} disabled={native} /> modeler
          </label>
          <label>
            <input type="checkbox" checked={withOverlays} onChange={(e) => setWithOverlays(e.target.checked)} /> fixture overlays
          </label>
          <SelectionReadout selection={selection} hovered={hovered} />
        </div>
        <div style={{ minHeight: 0 }}>
          {native ? (
            <ProcessMap graph={lite} overlays={overlays} layout={layout} controls={false} onHover={setHovered} />
          ) : (
            <BpmnView graph={lite} layout={layout} mode={mode} overlays={overlays} selection={selection} onSelect={setSelection} onHover={setHovered} />
          )}
        </div>
      </div>
    );
  },
};

/**
 * The BPI Challenge 2019 log as a BPMN-lite model: the directly-follows graph
 * is abstracted with the sliders, then every branching node gets an XOR split
 * and every merging node an XOR join (AND where the successors follow each
 * other in both orders). Stage groups become lanes; the constraint overlays of
 * the fixture sit on the tasks.
 */
export const FromLog: StoryObj = {
  name: "from log (BPIC 2019, abstraction slider)",
  render: () => {
    const [minNodeShare, setMinNodeShare] = useState(0.05);
    const [minEdgeShare, setMinEdgeShare] = useState(0.12);
    const [andGateways, setAndGateways] = useState(true);
    const [selection, setSelection] = useState<BpmnSelection>({ tasks: [], flows: [], lanes: [] });
    const [hovered, setHovered] = useState<string | null>(null);
    const lite = useMemo(() => liteFromGraph(globalScene, { abstraction: { minNodeShare, minEdgeShare, keepConnected: true }, andGateways }), [minNodeShare, minEdgeShare, andGateways]);
    const overlays = useMemo(() => overlaysFor(constraintItems("global"), { graph: lite }), [lite]);
    return (
      <div style={{ display: "grid", gridTemplateRows: "auto 1fr", height: "100vh", width: "100vw" }}>
        <div style={panel}>
          <strong>Log → BPMN-lite</strong>
          <Counts graph={lite} />
          <label>
            Activities ≥ {Math.round(minNodeShare * 100)} %{" "}
            <input type="range" min={0} max={0.5} step={0.01} value={minNodeShare} onChange={(e) => setMinNodeShare(Number(e.target.value))} />
          </label>
          <label>
            Paths ≥ {Math.round(minEdgeShare * 100)} %{" "}
            <input type="range" min={0} max={0.6} step={0.01} value={minEdgeShare} onChange={(e) => setMinEdgeShare(Number(e.target.value))} />
          </label>
          <label>
            <input type="checkbox" checked={andGateways} onChange={(e) => setAndGateways(e.target.checked)} /> AND gateways where concurrent
          </label>
          <SelectionReadout selection={selection} hovered={hovered} />
        </div>
        <div style={{ minHeight: 0 }}>
          <BpmnView graph={lite} layout={layout} overlays={overlays} selection={selection} onSelect={setSelection} onHover={setHovered} />
        </div>
      </div>
    );
  },
};

const DATASETS: Record<string, string | undefined> = { "All items": "global", "Vendor 0128": vendorSceneKey, None: undefined };

/**
 * A hand-written BPMN model (`fixtures/p2p_small.bpmn`) with the constraint
 * overlays of the fixture projected onto it. The mapping table pairs the
 * model's tasks with the log's activities by id and by label; the overlays are
 * keyed by activity id and follow the mapping. Switching the dataset replaces
 * the overlays while the diagram and its viewport stay fixed. The modeler mode
 * reports selected tasks, flows and lanes for constraint authoring.
 */
export const OverlaysOnModel: StoryObj = {
  name: "overlays on a model",
  render: () => {
    const [mode, setMode] = useState<"view" | "model">("view");
    const [dataset, setDataset] = useState<string>("All items");
    const [imported, setImported] = useState<BpmnImport | undefined>();
    const [selection, setSelection] = useState<BpmnSelection>({ tasks: [], flows: [], lanes: [] });
    const [hovered, setHovered] = useState<string | null>(null);
    const [viewbox, setViewbox] = useState<string>("");
    const ref = useRef<BpmnViewHandle>(null);
    useEffect(() => {
      importBpmn(smallXml, { activities }).then(setImported);
    }, []);
    const mappedGraph = useMemo(() => (imported ? applyMapping(imported.graph, imported.mapping) : undefined), [imported]);
    const overlays = useMemo<Overlay[]>(() => {
      const scene = DATASETS[dataset];
      if (!scene || !mappedGraph) return [];
      return overlaysFor(constraintItems(scene), { graph: mappedGraph });
    }, [dataset, mappedGraph]);
    const readViewbox = () => {
      const viewer = ref.current?.viewer() as { get(name: string): { viewbox(): { x: number; y: number; scale: number } } } | null;
      const vb = viewer?.get("canvas").viewbox();
      if (vb) setViewbox(`x ${Math.round(vb.x)} · y ${Math.round(vb.y)} · zoom ${vb.scale.toFixed(2)}`);
    };
    return (
      <div style={{ display: "grid", gridTemplateRows: "auto 1fr auto", height: "100vh", width: "100vw" }}>
        <div style={panel}>
          <strong>Overlays on a model</strong>
          <span>
            Dataset{" "}
            {Object.keys(DATASETS).map((k) => (
              <button
                key={k}
                type="button"
                className="wf-button"
                aria-pressed={dataset === k}
                onClick={() => {
                  setDataset(k);
                  window.setTimeout(readViewbox, 50);
                }}
              >
                {k}
              </button>
            ))}
          </span>
          <label>
            <input type="checkbox" checked={mode === "model"} onChange={(e) => setMode(e.target.checked ? "model" : "view")} /> modeler
          </label>
          <span data-testid="overlay-count">{overlays.length} overlays</span>
          <span data-testid="viewbox" style={{ color: "var(--wf-ink-muted)" }}>
            viewport {viewbox || "–"}
          </span>
          <SelectionReadout selection={selection} hovered={hovered} />
        </div>
        <div style={{ minHeight: 0 }}>
          <BpmnView ref={ref} xml={smallXml} mode={mode} overlays={overlays} mapping={imported?.mapping} selection={selection} onSelect={setSelection} onHover={setHovered} onImport={() => window.setTimeout(readViewbox, 100)} />
        </div>
        <div style={{ ...panel, borderTop: "1px solid var(--wf-line)", borderBottom: 0, maxHeight: 180, overflow: "auto" }}>
          <table className="wf-table" style={{ fontSize: 11 }} data-testid="mapping-table">
            <caption style={{ textAlign: "left", fontWeight: 700 }}>Task ↔ activity mapping</caption>
            <thead>
              <tr>
                <th>Task</th>
                <th>Label</th>
                <th>Type</th>
                <th>Lane</th>
                <th>Activity</th>
                <th>Matched by</th>
              </tr>
            </thead>
            <tbody>
              {(imported?.mapping ?? []).map((row) => (
                <tr key={row.taskId}>
                  <td>{row.taskId}</td>
                  <td>{row.label}</td>
                  <td>{row.type}</td>
                  <td>{row.lane}</td>
                  <td>{row.activityId ?? <em>unmapped</em>}</td>
                  <td>{row.matchedBy ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  },
};

interface RoundTrip {
  exported: BpmnExport;
  imported: BpmnImport;
  validation: BpmnValidation;
  reExported: BpmnExport;
}

/**
 * Export → import round trip: the stage model becomes BPMN 2.0 XML with DI,
 * the XML is parsed back into a FlowGraph, and the checks compare tasks,
 * gateways, events, flows, lanes, ids and positions. The diagram on the left
 * is bpmn-js reading the exported XML; the map on the right is the re-imported
 * graph on the native renderer.
 */
export const RoundTrip: StoryObj = {
  name: "export → import round trip",
  render: () => {
    const [result, setResult] = useState<RoundTrip | undefined>();
    const [showXml, setShowXml] = useState(false);
    const lite = useMemo(() => liteFromStages(withSceneMetrics(p2pStages, globalScene)), []);
    useEffect(() => {
      let live = true;
      (async () => {
        const exported = await exportBpmn(lite, { layout, name: "Purchase-to-pay" });
        const imported = await importBpmn(exported.xml);
        const validation = await validateBpmn(exported.xml);
        const reExported = await exportBpmn(imported.graph, { positions: imported.positions, name: "Purchase-to-pay" });
        if (live) setResult({ exported, imported, validation, reExported });
      })();
      return () => {
        live = false;
      };
    }, [lite]);
    const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort().join("|");
    const checks = result
      ? [
          ["parser warnings", result.validation.warnings.length === 0],
          ["DI for every element", result.validation.missingDi.length === 0],
          ["tasks", ids(result.imported.graph.nodes.filter((n) => n.kind === "activity")) === ids(lite.nodes.filter((n) => n.kind === "activity"))],
          ["gateways and events", ids(result.imported.graph.nodes.filter((n) => n.kind !== "activity")) === ids(lite.nodes.filter((n) => n.kind !== "activity"))],
          ["flows", ids(result.imported.graph.edges) === ids(lite.edges)],
          ["lanes", ids(result.imported.graph.groups?.filter((g) => g.kind !== "pool") ?? []) === ids(lite.groups ?? [])],
          ["positions", lite.nodes.every((n) => JSON.stringify(result.imported.positions?.nodes[n.id]) === JSON.stringify(result.exported.positions.nodes[n.id]))],
          ["re-export identical", result.reExported.xml === result.exported.xml],
        ]
      : [];
    const pass = checks.length > 0 && checks.every(([, ok]) => ok);
    return (
      <div style={{ display: "grid", gridTemplateRows: "auto 1fr", height: "100vh", width: "100vw" }}>
        <div style={panel}>
          <strong>Round trip</strong>
          <Counts graph={lite} />
          <span data-testid="roundtrip" data-pass={pass}>
            {checks.map(([label, ok]) => (
              <span key={String(label)} style={{ marginRight: 10, color: ok ? "var(--wf-pass)" : "var(--wf-fail)" }}>
                {ok ? "✓" : "✗"} {label}
              </span>
            ))}
          </span>
          {result ? (
            <button type="button" className="wf-button" onClick={() => setShowXml((s) => !s)}>
              {showXml ? "hide XML" : `show XML (${Math.round(result.exported.xml.length / 1024)} kB)`}
            </button>
          ) : (
            <span>…</span>
          )}
        </div>
        {showXml && result ? (
          <pre style={{ margin: 0, padding: 12, overflow: "auto", fontSize: 11, fontFamily: "var(--wf-font-mono)" }}>{result.exported.xml}</pre>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", minHeight: 0 }}>
            <div style={{ borderRight: "1px solid var(--wf-line)", minHeight: 0 }}>{result ? <BpmnView xml={result.exported.xml} /> : null}</div>
            <div style={{ minHeight: 0 }}>{result ? <ProcessMap graph={result.imported.graph} layout={layout} controls={false} /> : null}</div>
          </div>
        )}
      </div>
    );
  },
};
