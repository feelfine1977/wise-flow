#!/usr/bin/env python3
"""Build the BPIC 2019 process-map fixture used by the stories and tests.

Reads the BPI Challenge 2019 event log (CSV export, one row per event) and
writes ``fixtures/bpic2019_p2p.json`` with

* two ``FlowGraph`` scenes in the workbench contract
  (``#/components/schemas/FlowGraph``): the whole log and one vendor slice;
  activity nodes carry event and case counts, follows edges carry counts
  and median lags; stage groups follow a simple purchase-to-pay stage model;
* constraint descriptions with per-scene statistics (presence, singularity,
  exclusion, lag, precedence, balance, applicability) that the library's
  ``constraintOverlays`` turns into overlays.

The CSV is never stored in the repository. Run:

    python3 fixtures/build_bpic2019_fixture.py [path/to/BPI_Challenge_2019.csv]

Requires pandas. The script is deterministic for a given input file.
"""

from __future__ import annotations

import json
import re
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

CSV = Path(
    sys.argv[1]
    if len(sys.argv) > 1
    else "/Users/ula/code/PhD/WISE/WISE/Untitled/data/BPI_Challenge_2019.csv"
)
OUT = Path(__file__).resolve().parent / "bpic2019_p2p.json"

CASE = "case concept:name"
ACT = "event concept:name"
TS = "event time:timestamp"
VENDOR = "case Vendor"
CATEGORY = "case Item Category"
RESOURCE = "event org:resource"

PREFERRED_VENDOR = "vendorID_0128"

FLOW_TYPES = {
    "3-way match, invoice after GR": "DF1",
    "3-way match, invoice before GR": "DF2",
    "2-way match": "2-way",
    "Consignment": "Consignment",
}

STAGES = [
    ("requisition", "Requisition"),
    ("order", "Purchase order"),
    ("receipt", "Goods receipt"),
    ("invoice", "Invoice"),
    ("payment", "Payment"),
    ("other", "Other"),
]

STAGE_RULES = [
    (re.compile(r"^SRM:"), "requisition"),
    (re.compile(r"Purchase Requisition"), "requisition"),
    (re.compile(r"^Clear Invoice"), "payment"),
    (re.compile(r"Goods Receipt|Service Entry Sheet"), "receipt"),
    (
        re.compile(
            r"Invoice|debit memo|credit memo|Payment Block|Subsequent Invoice",
            re.IGNORECASE,
        ),
        "invoice",
    ),
    (
        re.compile(
            r"Purchase Order|^Change |^Block|^Release|^Reactivate|^Delete|Order Confirmation"
        ),
        "order",
    ),
]

HUMAN_RESOURCE = re.compile(r"(?i)^(?!(?:batch|none|nan|null|\s*$)).")


def slug(label: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")
    return s or "activity"


def stage_of(label: str) -> str:
    for rule, stage in STAGE_RULES:
        if rule.search(label):
            return stage
    return "other"


def r4(x: float) -> float:
    if x is None or (isinstance(x, float) and np.isnan(x)):
        return None
    return float(round(float(x), 4))


def load() -> pd.DataFrame:
    usecols = [CASE, ACT, TS, VENDOR, CATEGORY, RESOURCE]
    df = pd.read_csv(CSV, usecols=usecols, dtype=str, encoding="cp1252", encoding_errors="replace")
    df["ts"] = pd.to_datetime(df[TS], format="%d-%m-%Y %H:%M:%S.%f", errors="coerce")
    df = df.dropna(subset=["ts", CASE, ACT])
    df["flow"] = df[CATEGORY].map(FLOW_TYPES).fillna("other")
    df["human"] = df[RESOURCE].fillna("").str.match(HUMAN_RESOURCE)
    df["node"] = df[ACT].map(slug)
    df = df.sort_values([CASE, "ts"], kind="mergesort").reset_index(drop=True)
    return df


def case_frame(df: pd.DataFrame) -> pd.DataFrame:
    """One row per case with flow type, vendor and per-activity counts."""
    g = df.groupby(CASE, sort=True)
    cases = pd.DataFrame(
        {
            "flow": g["flow"].first(),
            "vendor": g[VENDOR].first(),
            "events": g.size(),
            "human": g["human"].sum(),
        }
    )
    return cases


def first_times(df: pd.DataFrame, nodes: list[str]) -> pd.Series:
    sub = df[df["node"].isin(nodes)]
    return sub.groupby(CASE)["ts"].min()


def counts(df: pd.DataFrame, nodes: list[str]) -> pd.Series:
    sub = df[df["node"].isin(nodes)]
    return sub.groupby(CASE).size()


def constraint_descriptions() -> list[dict]:
    gr = ["record_goods_receipt", "record_service_entry_sheet"]
    ir = ["record_invoice_receipt", "vendor_creates_invoice"]
    return [
        {
            "id": "c_l1_clear_invoice_present",
            "type": "presence",
            "layer": "L1_closure_completeness",
            "label": "Clear Invoice present",
            "activities": ["clear_invoice"],
            "params": {"m": 1},
            "scope": {"flowType": ["DF1", "DF2", "2-way"]},
            "description": "Invoice-bearing flows should eventually be cleared.",
        },
        {
            "id": "c_l4_repeated_invoice_receipt",
            "type": "singularity",
            "layer": "L4_rework_instability",
            "label": "Invoice receipt at most once",
            "activities": ["record_invoice_receipt"],
            "params": {"k": 1},
            "scope": {"flowType": ["DF1", "DF2", "2-way"]},
            "description": "Repeated invoice receipt indicates rework.",
        },
        {
            "id": "c_l5_cancel_invoice_receipt",
            "type": "exclusion",
            "layer": "L5_exceptions_corrections",
            "label": "No cancelled invoice receipt",
            "activities": ["cancel_invoice_receipt"],
            "params": {},
            "scope": {"flowType": ["DF1", "DF2", "2-way"]},
            "description": "Cancelling an invoice receipt is a correction.",
        },
        {
            "id": "c_l3_df1_goods_to_invoice_days",
            "type": "lag",
            "layer": "L3_timeliness_ageing",
            "label": "Goods receipt to invoice within 10 days",
            "a": gr,
            "b": ir,
            "params": {"delta": 10.0, "width": 20.0, "unit": "D"},
            "scope": {"flowType": ["DF1"]},
            "description": "Invoices should follow goods receipt within ten days.",
        },
        {
            "id": "c_l2_df1_invoice_after_goods",
            "type": "precedence",
            "layer": "L2_flow_discipline",
            "label": "Goods receipt before invoice",
            "a": gr,
            "b": ir,
            "params": {},
            "scope": {"flowType": ["DF1"]},
            "description": "In invoice-after-goods flows the goods receipt comes first.",
        },
        {
            "id": "c_l7_manual_touches",
            "type": "balance",
            "layer": "L7_effort_automation",
            "label": "Manual touches per item",
            "params": {"attribute": "manual_touch_count", "threshold": 4.0, "width": 6.0, "direction": "high"},
            "scope": {},
            "description": "More than four manual touches per item is effort friction.",
        },
        {
            "id": "c_l7_manual_touches_order_stage",
            "type": "balance",
            "layer": "L7_effort_automation",
            "label": "Manual touches in the order stage",
            "group": "order",
            "params": {"attribute": "manual_touch_count_order", "threshold": 2.0, "width": 4.0, "direction": "high"},
            "scope": {},
            "description": "Manual changes to the purchase order after creation.",
        },
        {
            "id": "scope_df1",
            "type": "applicability",
            "label": "Applies to 3-way match, invoice after goods receipt",
            "scope": {"flowType": ["DF1"]},
            "description": "Lag and precedence constraints of the norm apply to DF1 flows.",
        },
        {
            "id": "scope_consignment",
            "type": "applicability",
            "label": "Applies to consignment flows",
            "scope": {"flowType": ["Consignment"]},
            "description": "Consignment items carry no invoice; scope of the exclusion constraint.",
        },
    ]


def evaluate_constraints(df: pd.DataFrame, cases: pd.DataFrame, node_stage: dict[str, str]):
    """Return (stats per constraint id, per-case violation flag)."""
    idx = cases.index
    violated = pd.Series(False, index=idx)
    stats: dict[str, dict] = {}
    descs = constraint_descriptions()

    def in_scope(scope: dict) -> pd.Series:
        flows = scope.get("flowType")
        if not flows:
            return pd.Series(True, index=idx)
        return cases["flow"].isin(flows)

    for d in descs:
        scope = in_scope(d.get("scope", {}))
        n_scope = int(scope.sum())
        if d["type"] == "presence":
            c = counts(df, d["activities"]).reindex(idx).fillna(0)
            viol = scope & (c < d["params"]["m"])
            stats[d["id"]] = {
                "cases": n_scope,
                "evaluated": n_scope,
                "violations": int(viol.sum()),
                "violationShare": r4(viol.sum() / n_scope) if n_scope else 0.0,
                "meanCount": r4(c[scope].mean()),
            }
        elif d["type"] == "singularity":
            c = counts(df, d["activities"]).reindex(idx).fillna(0)
            viol = scope & (c > d["params"]["k"])
            with_repeat = scope & (c > 1)
            stats[d["id"]] = {
                "cases": n_scope,
                "evaluated": n_scope,
                "violations": int(viol.sum()),
                "violationShare": r4(viol.sum() / n_scope) if n_scope else 0.0,
                "repeatShare": r4(with_repeat.sum() / n_scope) if n_scope else 0.0,
                "meanCount": r4(c[scope].mean()),
                "maxCount": int(c[scope].max()) if n_scope else 0,
            }
        elif d["type"] == "exclusion":
            c = counts(df, d["activities"]).reindex(idx).fillna(0)
            viol = scope & (c >= 1)
            stats[d["id"]] = {
                "cases": n_scope,
                "evaluated": n_scope,
                "violations": int(viol.sum()),
                "violationShare": r4(viol.sum() / n_scope) if n_scope else 0.0,
                "meanCount": r4(c[scope].mean()),
            }
        elif d["type"] in ("lag", "precedence"):
            fa = first_times(df, d["a"]).reindex(idx)
            fb = first_times(df, d["b"]).reindex(idx)
            both = scope & fa.notna() & fb.notna()
            days = (fb - fa).dt.total_seconds() / 86400.0
            n_eval = int(both.sum())
            if d["type"] == "lag":
                viol = both & (days > d["params"]["delta"])
                vals = days[both]
                stats[d["id"]] = {
                    "cases": n_scope,
                    "evaluated": n_eval,
                    "coverage": r4(n_eval / n_scope) if n_scope else 0.0,
                    "violations": int(viol.sum()),
                    "violationShare": r4(viol.sum() / n_eval) if n_eval else 0.0,
                    "medianDays": r4(vals.median()) if n_eval else None,
                    "p90Days": r4(vals.quantile(0.9)) if n_eval else None,
                    "unit": "D",
                }
            else:
                viol = both & (days < 0)
                stats[d["id"]] = {
                    "cases": n_scope,
                    "evaluated": n_eval,
                    "coverage": r4(n_eval / n_scope) if n_scope else 0.0,
                    "violations": int(viol.sum()),
                    "violationShare": r4(viol.sum() / n_eval) if n_eval else 0.0,
                    "reverseShare": r4(viol.sum() / n_eval) if n_eval else 0.0,
                }
        elif d["type"] == "balance":
            group = d.get("group")
            if group:
                sub = df[df["human"] & (df["node"].map(node_stage) == group)]
            else:
                sub = df[df["human"]]
            value = sub.groupby(CASE).size().reindex(idx).fillna(0)
            thr = d["params"]["threshold"]
            viol = scope & (value > thr)
            vals = value[scope]
            stats[d["id"]] = {
                "cases": n_scope,
                "evaluated": n_scope,
                "violations": int(viol.sum()),
                "violationShare": r4(viol.sum() / n_scope) if n_scope else 0.0,
                "mean": r4(vals.mean()) if n_scope else None,
                "median": r4(vals.median()) if n_scope else None,
                "p90": r4(vals.quantile(0.9)) if n_scope else None,
                "threshold": thr,
                "width": d["params"]["width"],
            }
        elif d["type"] == "applicability":
            in_scope_events = df[df[CASE].isin(idx[scope])]
            per_node_total = df.groupby("node").size()
            per_node_scope = in_scope_events.groupby("node").size().reindex(per_node_total.index).fillna(0)
            share = (per_node_scope / per_node_total).sort_index()
            stats[d["id"]] = {
                "cases": int(len(idx)),
                "casesInScope": n_scope,
                "inScopeShare": r4(n_scope / len(idx)) if len(idx) else 0.0,
                "nodeShareInScope": {k: r4(v) for k, v in share.items()},
            }
            continue
        else:
            continue
        violated = violated | viol.fillna(False)
    return stats, violated


def scene(df: pd.DataFrame, cases: pd.DataFrame, meta: dict, node_stage: dict[str, str]) -> tuple[dict, dict]:
    n_cases = int(len(cases))
    stats, violated = evaluate_constraints(df, cases, node_stage)
    df = df.copy()
    df["case_viol"] = df[CASE].map(violated).fillna(False)

    # Node metrics
    g = df.groupby("node", sort=True)
    node_events = g.size()
    node_cases = g[CASE].nunique()
    node_viol = g["case_viol"].mean()
    first = df.groupby(CASE).head(1)
    last = df.groupby(CASE).tail(1)
    starts = first.groupby("node").size()
    ends = last.groupby("node").size()

    # Directly-follows pairs within a case
    same = df[CASE].eq(df[CASE].shift(-1))
    src = df.loc[same, ["node", CASE, "ts", "case_viol"]].reset_index(drop=True)
    dst = df.shift(-1).loc[same, ["node", "ts"]].reset_index(drop=True)
    pairs = pd.DataFrame(
        {
            "source": src["node"].values,
            "target": dst["node"].values,
            "case": src[CASE].values,
            "hours": (pd.to_datetime(dst["ts"].values) - pd.to_datetime(src["ts"].values))
            / np.timedelta64(1, "h"),
            "viol": src["case_viol"].values,
        }
    )
    total_transitions = int(len(pairs))
    pg = pairs.groupby(["source", "target"], sort=True)
    edge_count = pg.size()
    edge_cases = pg["case"].nunique()
    edge_median = pg["hours"].median()
    edge_p90 = pg["hours"].quantile(0.9)
    edge_viol = pg["viol"].mean()

    # Next-event sojourn per node
    sojourn = pairs.groupby("source")["hours"].median()

    labels = df.drop_duplicates("node").set_index("node")[ACT]

    nodes = []
    for node_id in sorted(node_events.index):
        label = labels[node_id]
        nodes.append(
            {
                "id": node_id,
                "kind": "activity",
                "label": label,
                "group": node_stage[node_id],
                "metrics": {
                    "events": int(node_events[node_id]),
                    "cases": int(node_cases[node_id]),
                    "share": r4(node_cases[node_id] / n_cases),
                    "starts": int(starts.get(node_id, 0)),
                    "ends": int(ends.get(node_id, 0)),
                    "medianNextHours": r4(sojourn.get(node_id, np.nan)),
                    "violationShare": r4(node_viol[node_id]),
                },
                "tags": [node_stage[node_id]],
            }
        )
    nodes.append(
        {
            "id": "__start",
            "kind": "event",
            "label": "Start",
            "metrics": {"cases": n_cases, "share": 1.0},
            "tags": ["start"],
        }
    )
    nodes.append(
        {
            "id": "__end",
            "kind": "event",
            "label": "End",
            "metrics": {"cases": n_cases, "share": 1.0},
            "tags": ["end"],
        }
    )

    edges = []
    for (s, t) in edge_count.index:
        edges.append(
            {
                "id": f"{s}->{t}",
                "kind": "follows",
                "source": s,
                "target": t,
                "metrics": {
                    "count": int(edge_count[(s, t)]),
                    "cases": int(edge_cases[(s, t)]),
                    "share": r4(edge_count[(s, t)] / total_transitions),
                    "medianLagHours": r4(edge_median[(s, t)]),
                    "p90LagHours": r4(edge_p90[(s, t)]),
                    "violationShare": r4(edge_viol[(s, t)]),
                },
            }
        )
    for node_id in sorted(starts.index):
        edges.append(
            {
                "id": f"__start->{node_id}",
                "kind": "follows",
                "source": "__start",
                "target": node_id,
                "metrics": {
                    "count": int(starts[node_id]),
                    "cases": int(starts[node_id]),
                    "share": r4(starts[node_id] / n_cases),
                },
            }
        )
    for node_id in sorted(ends.index):
        edges.append(
            {
                "id": f"{node_id}->__end",
                "kind": "follows",
                "source": node_id,
                "target": "__end",
                "metrics": {
                    "count": int(ends[node_id]),
                    "cases": int(ends[node_id]),
                    "share": r4(ends[node_id] / n_cases),
                },
            }
        )

    groups = [{"id": sid, "kind": "stage", "label": label} for sid, label in STAGES]
    used = {n.get("group") for n in nodes}
    groups = [gr for gr in groups if gr["id"] in used]

    flow_mix = cases["flow"].value_counts().to_dict()
    graph = {
        "nodes": nodes,
        "edges": edges,
        "groups": groups,
        "overlays": [],
        "meta": {
            **meta,
            "cases": n_cases,
            "events": int(len(df)),
            "transitions": total_transitions,
            "flowTypes": {k: int(v) for k, v in sorted(flow_mix.items())},
            "period": [str(df["ts"].min().date()), str(df["ts"].max().date())],
        },
    }
    return graph, stats


def main() -> None:
    df = load()
    node_stage = {n: stage_of(l) for n, l in df.drop_duplicates("node").set_index("node")[ACT].items()}
    cases = case_frame(df)

    if PREFERRED_VENDOR in set(cases["vendor"]):
        vendor = PREFERRED_VENDOR
    else:
        vendor = cases["vendor"].value_counts().idxmax()
    vendor_cases = cases[cases["vendor"] == vendor]
    vendor_df = df[df[CASE].isin(vendor_cases.index)]

    global_graph, global_stats = scene(
        df, cases, {"scene": "global", "label": "All purchase order items"}, node_stage
    )
    vendor_key = "vendor_" + re.sub(r"[^0-9a-z]+", "", vendor.lower().replace("vendorid", ""))
    vendor_graph, vendor_stats = scene(
        vendor_df,
        vendor_cases,
        {"scene": vendor_key, "label": f"Vendor {vendor}", "slice": {VENDOR: vendor}},
        node_stage,
    )

    constraints = []
    for d in constraint_descriptions():
        constraints.append(
            {
                "description": d,
                "stats": {"global": global_stats[d["id"]], vendor_key: vendor_stats[d["id"]]},
            }
        )

    out = {
        "meta": {
            "source": "BPI Challenge 2019",
            "doi": "10.4121/uuid:d06aff4b-79f0-45e6-8ec8-e19730c248f1",
            "caseNotion": "purchase order item",
            "built": str(date.today()),
            "script": "fixtures/build_bpic2019_fixture.py",
            "events": int(len(df)),
            "cases": int(len(cases)),
            "activities": int(df["node"].nunique()),
            "vendorScene": vendor_key,
            "notes": [
                "Timestamps outside 2018-2019 are kept as in the source (known outliers).",
                "Lags are measured between consecutive events of the same purchase order item.",
                "violationShare on nodes and edges is the share of cases through the element that violate at least one fixture constraint.",
            ],
        },
        "stages": [{"id": sid, "label": label, "order": i} for i, (sid, label) in enumerate(STAGES)],
        "scenes": {"global": global_graph, vendor_key: vendor_graph},
        "constraints": constraints,
    }
    OUT.write_text(json.dumps(out, indent=1, sort_keys=False) + "\n")
    print(
        f"wrote {OUT} — {len(global_graph['nodes'])} nodes, {len(global_graph['edges'])} edges (global); "
        f"{len(vendor_graph['nodes'])} nodes, {len(vendor_graph['edges'])} edges ({vendor_key}, {len(vendor_cases)} cases)"
    )


if __name__ == "__main__":
    main()
