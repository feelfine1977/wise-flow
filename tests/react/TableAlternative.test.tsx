import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { constraintItems, vendorScene, vendorSceneKey } from "../../fixtures/bpic2019";
import { abstract, overlaysFor } from "../../src/index";
import { TableAlternative } from "../../src/react/index";

afterEach(cleanup);

describe("TableAlternative", () => {
  it("lists activities, paths and overlays with captions and numbers", () => {
    const graph = abstract(vendorScene, { minEdgeShare: 0.02 });
    const overlays = overlaysFor(constraintItems(vendorSceneKey), { graph });
    const onSelect = vi.fn();
    render(<TableAlternative graph={graph} overlays={overlays} onSelect={onSelect} />);
    const tables = screen.getAllByRole("table");
    expect(tables).toHaveLength(3);
    expect(screen.getByText("Activities of the process map with their metrics")).toBeTruthy();
    expect(screen.getByText("Paths of the process map with their metrics")).toBeTruthy();
    expect(screen.getByText("Constraint overlays with the numbers they encode")).toBeTruthy();
    const rows = screen.getAllByRole("row");
    expect(rows.length).toBeGreaterThan(graph.nodes.length + graph.edges.length);
    expect(screen.getAllByText("Clear Invoice").length).toBeGreaterThan(0);
    expect(screen.getByText("20 % missing")).toBeTruthy();
    fireEvent.click(screen.getAllByText("Clear Invoice")[0]);
    expect(onSelect).toHaveBeenCalledWith({ nodes: ["clear_invoice"], edges: [], groups: [] });
  });

  it("renders German headers and an empty state", () => {
    render(<TableAlternative graph={{ nodes: [], edges: [] }} locale="de" />);
    expect(screen.getByText("Aktivitäten der Prozesslandkarte mit ihren Kennzahlen")).toBeTruthy();
    expect(screen.getAllByText("Nichts anzuzeigen.").length).toBe(3);
  });
});
