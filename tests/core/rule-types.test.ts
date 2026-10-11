import { describe, expect, expectTypeOf, it } from "vitest";
import type { RuleMatch, RuleSet, RuleText, Theme, ThemeOverrides, ThemeRule } from "../../src/index";

/**
 * What a rule can set, checked by the compiler: `npm run typecheck` compiles
 * this file, and each `@ts-expect-error` fails it if the line below it
 * compiles, that is, if the type offered such a field.
 */
describe("the type of a rule", () => {
  it("offers the closed set of properties and nothing else", () => {
    expectTypeOf<keyof RuleSet>().toEqualTypeOf<"fill" | "fillOpacity" | "stroke" | "strokeWeight" | "dash" | "radius" | "opacity" | "text" | "cue">();
    expectTypeOf<keyof RuleText>().toEqualTypeOf<"size" | "weight" | "color">();
    expectTypeOf<NonNullable<RuleSet["strokeWeight"]>>().toEqualTypeOf<"thin" | "strong">();
    expectTypeOf<NonNullable<RuleSet["dash"]>>().toEqualTypeOf<"solid" | "unobserved">();
    expectTypeOf<NonNullable<RuleSet["radius"]>>().toEqualTypeOf<"s" | "m" | "full">();
    expectTypeOf<Theme["rules"]>().toEqualTypeOf<readonly ThemeRule[]>();
  });

  it("has no field for a shape, a pattern, an arrowhead, a shadow or a gradient", () => {
    const refused: RuleSet[] = [
      // @ts-expect-error A rule cannot change a shape.
      { shape: "circle" },
      // @ts-expect-error Nor a pattern twin.
      { pattern: "dots" },
      // @ts-expect-error Nor an arrowhead.
      { arrowhead: "none" },
      // @ts-expect-error Nor a shadow.
      { shadow: "0 1px 2px #000000" },
      // @ts-expect-error Nor a gradient.
      { gradient: ["#ffffff", "#000000"] },
      // @ts-expect-error Nor geometry.
      { width: 200 },
      // @ts-expect-error A stroke weight is named, not a width.
      { strokeWeight: 3 },
      // @ts-expect-error A text has no family.
      { text: { name: { font: "serif" } } },
    ];
    expect(refused).toHaveLength(8);
  });

  it("matches only the kinds and states of its part, and tags only on nodes and paths", () => {
    const refused: RuleMatch[] = [
      // @ts-expect-error A node is not of a path's kind.
      { part: "node", kind: "follows" },
      // @ts-expect-error A path is never out of scope.
      { part: "edge", state: "outOfScope" },
      // @ts-expect-error Groups carry no tags.
      { part: "group", tag: "manual" },
      // @ts-expect-error A mark is only hovered.
      { part: "mark", state: "selected" },
      // @ts-expect-error There is no part `lane`.
      { part: "lane" },
    ];
    expect(refused).toHaveLength(5);
    const theme: ThemeOverrides = { rules: [{ match: { part: "node", tag: "manual" }, set: { strokeWeight: "strong" } }] };
    expect(theme.rules).toHaveLength(1);
  });
});
