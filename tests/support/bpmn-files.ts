/**
 * Broken BPMN files for the importer: seeded mutations of the text of a valid
 * BPMN 2.0 file, as other tools, hand edits and transfers produce them. A
 * mutation works on the XML as text (start tags, attributes, elements), so it
 * can make anything, including files that are not XML at all. `mutate` says
 * which kinds it applied, for the failure message.
 */
import type { Random } from "./random";

export const MUTATION_KINDS = [
  "remove-attribute",
  "duplicate-id",
  "dangling-reference",
  "unknown-element",
  "unknown-namespace",
  "missing-di",
  "huge-coordinate",
  "non-numeric-coordinate",
  "empty-process",
  "nested-subprocesses",
  "large-file",
  "truncated",
  "garbage",
  "wrong-type",
  "moved-element",
  "wise-extension",
  "entities",
] as const;

export type MutationKind = (typeof MUTATION_KINDS)[number];

interface Tag {
  /** Offset of `<` and of the character after `>`. */
  start: number;
  end: number;
  name: string;
  selfClosing: boolean;
  attrs: { name: string; value: string; start: number; end: number }[];
}

/** Start tags of the text, with their attributes; not a parser, but enough for files written by tools. */
export function startTags(xml: string): Tag[] {
  const tags: Tag[] = [];
  for (const m of xml.matchAll(/<([A-Za-z_][\w.:-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g)) {
    const attrs: Tag["attrs"] = [];
    const offset = m.index + 1 + m[1].length;
    for (const a of m[2].matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs.push({ name: a[1], value: a[2] ?? a[3], start: offset + a.index, end: offset + a.index + a[0].length });
    tags.push({ start: m.index, end: m.index + m[0].length, name: m[1], selfClosing: m[3] === "/", attrs });
  }
  return tags;
}

/** Offset after the end tag that closes the element starting with `tag` (or after a self-closing tag). */
export function elementEnd(xml: string, tag: Tag): number {
  if (tag.selfClosing) return tag.end;
  let depth = 1;
  const pattern = new RegExp(`<(/?)${tag.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[\\s/>])[^>]*?(/?)>`, "g");
  pattern.lastIndex = tag.end;
  for (let m = pattern.exec(xml); m; m = pattern.exec(xml)) {
    if (m[1]) depth--;
    else if (!m[2]) depth++;
    if (depth === 0) return m.index + m[0].length;
  }
  return xml.length;
}

const splice = (s: string, start: number, end: number, insert = "") => s.slice(0, start) + insert + s.slice(end);
const local = (name: string) => name.slice(name.indexOf(":") + 1);

const REFERENCES = ["sourceRef", "targetRef", "bpmnElement", "processRef", "default", "attachedToRef"];
const COORDINATES = ["x", "y", "width", "height"];
const HUGE = ["1e308", "-1e308", "1e400", "-1e400", "9007199254740993", "-0", "123456789012345678901234567890"];
const NOT_NUMBERS = ["abc", "", "NaN", "Infinity", "-Infinity", "1,5", "0x10", "  12  ", "12px", "1e", "∞"];

/** One mutation of the kind; returns the text unchanged where the file has nothing to mutate. */
export function mutateOnce(xml: string, kind: MutationKind, rng: Random): string {
  const tags = startTags(xml);
  const pick = (test: (t: Tag) => boolean) => {
    const found = tags.filter(test);
    return found.length ? rng.pick(found) : undefined;
  };
  switch (kind) {
    case "remove-attribute": {
      const tag = pick((t) => t.attrs.length > 0);
      if (!tag) return xml;
      const a = rng.pick(tag.attrs);
      return splice(xml, a.start, a.end);
    }
    case "duplicate-id": {
      const withId = tags.filter((t) => t.attrs.some((a) => a.name === "id"));
      if (withId.length < 2) return xml;
      const [from, to] = rng.sample(withId, 2);
      const id = from.attrs.find((a) => a.name === "id")!.value;
      const target = to.attrs.find((a) => a.name === "id")!;
      return splice(xml, target.start, target.end, `id="${id}"`);
    }
    case "dangling-reference": {
      const refs = tags.flatMap((t) => t.attrs.filter((a) => REFERENCES.includes(a.name)));
      const texts = [...xml.matchAll(/<(bpmn:)?(flowNodeRef|incoming|outgoing)>([^<]*)</g)];
      if (texts.length && (!refs.length || rng.chance(0.3))) {
        const m = rng.pick(texts);
        const at = m.index + m[0].length - 1 - m[3].length;
        return splice(xml, at, at + m[3].length, `missing_${rng.int(1, 99)}`);
      }
      if (!refs.length) return xml;
      const a = rng.pick(refs);
      return splice(xml, a.start, a.end, `${a.name}="${rng.pick(["missing", "", "a b", "Definitions_1"])}"`);
    }
    case "unknown-element": {
      const tag = pick((t) => !t.selfClosing);
      if (!tag) return xml;
      const element = rng.pick([
        '<foo:widget xmlns:foo="urn:example:unknown" a="1"><foo:part>text</foo:part></foo:widget>',
        '<bpmn:notAThing id="unknown_1" />',
        "<task id=\"unprefixed_1\" />",
        '<bpmn:task id="task_in_odd_place" name="Odd" />',
        "<!-- a comment --><?processing instruction?>",
        "<![CDATA[ <bpmn:task id=\"cdata\"/> ]]>",
      ]);
      return splice(xml, tag.end, tag.end, element);
    }
    case "unknown-namespace": {
      const choice = rng.int(0, 3);
      if (choice === 0) return xml.replace(/xmlns:bpmn="[^"]*"/, 'xmlns:bpmn="urn:example:not-bpmn"');
      if (choice === 1) return xml.replace(/xmlns:(bpmndi|dc|di|wise)="[^"]*"/, 'xmlns:$1="urn:example:moved"');
      const tag = pick((t) => t.name.includes(":"));
      if (!tag) return xml;
      if (choice === 2) return splice(xml, tag.start + 1 + tag.name.length, tag.start + 1 + tag.name.length, ' zz:extra="1" other:thing="2"');
      // An element under a prefix nobody declared; its end tag follows it.
      const end = elementEnd(xml, tag);
      const body = xml.slice(tag.start, end).replace(new RegExp(`(</?)${tag.name}(?=[\\s/>])`, "g"), `$1zz:${local(tag.name)}`);
      return splice(xml, tag.start, end, body);
    }
    case "missing-di": {
      const choice = rng.int(0, 3);
      const name = ["bpmndi:BPMNDiagram", "bpmndi:BPMNShape", "bpmndi:BPMNEdge", "dc:Bounds"][choice];
      const tag = pick((t) => t.name === name) ?? pick((t) => t.name.endsWith(name.split(":")[1]));
      if (!tag) return xml;
      return splice(xml, tag.start, elementEnd(xml, tag));
    }
    case "huge-coordinate":
    case "non-numeric-coordinate": {
      const coords = tags.flatMap((t) => t.attrs.filter((a) => COORDINATES.includes(a.name)));
      if (!coords.length) return xml;
      const a = rng.pick(coords);
      return splice(xml, a.start, a.end, `${a.name}="${rng.pick(kind === "huge-coordinate" ? HUGE : NOT_NUMBERS)}"`);
    }
    case "empty-process": {
      const tag = pick((t) => local(t.name) === "process" && !t.selfClosing);
      if (!tag) return xml;
      const end = elementEnd(xml, tag);
      const close = xml.lastIndexOf("</", end - 1);
      return rng.chance(0.5) ? splice(xml, tag.end, close) : splice(xml, tag.start, end, `<${tag.name}${xml.slice(tag.start + 1 + tag.name.length, tag.end - 1)}/>`);
    }
    case "nested-subprocesses": {
      const tag = pick((t) => /task$/i.test(local(t.name)));
      if (!tag) return xml;
      const depth = rng.pick([2, 5, 20, 100, 500]);
      const prefix = tag.name.includes(":") ? `${tag.name.split(":")[0]}:` : "";
      const end = elementEnd(xml, tag);
      let body = xml.slice(tag.start, end);
      for (let i = depth; i > 0; i--) body = `<${prefix}subProcess id="nested_${i}_${rng.int(0, 999)}" name="Level ${i}">${body}</${prefix}subProcess>`;
      return splice(xml, tag.start, end, body);
    }
    case "large-file": {
      const tag = pick((t) => /task$/i.test(local(t.name)));
      if (!tag) return xml;
      const end = elementEnd(xml, tag);
      const copy = xml.slice(tag.start, end);
      const count = rng.pick([50, 200, 500]);
      const copies = Array.from({ length: count }, (_, i) => copy.replace(/\bid="([^"]*)"/, `id="$1_copy${i}"`)).join("");
      return splice(xml, end, end, copies);
    }
    case "truncated":
      return xml.slice(0, rng.int(0, Math.max(0, xml.length - 1)));
    case "garbage": {
      const choice = rng.int(0, 5);
      if (choice === 0) return "";
      if (choice === 1) return rng.pick(["not xml at all", "<", "<?xml version=\"1.0\"?>", "{\"nodes\": []}", "<definitions/>", "<bpmn:definitions xmlns:bpmn=\"http://www.omg.org/spec/BPMN/20100524/MODEL\"/>"]);
      if (choice === 2) return `﻿${xml}`;
      const at = rng.int(0, Math.max(0, xml.length - 1));
      const noise = Array.from({ length: rng.int(1, 40) }, () => String.fromCharCode(rng.pick([0, 1, 7, 0x3c, 0x3e, 0x26, 0x22, 0xfffe, 0xd800, rng.int(32, 0x2fff)]))).join("");
      return choice === 3 ? splice(xml, at, at + noise.length, noise) : choice === 4 ? splice(xml, at, at, noise) : xml.replace(/<\//, "</ ");
    }
    case "wrong-type": {
      const tag = pick((t) => t.name.includes(":") && !/^(bpmn:)?definitions$/.test(t.name));
      if (!tag) return xml;
      const prefix = tag.name.split(":")[0];
      const to = `${prefix}:${rng.pick(["task", "lane", "sequenceFlow", "process", "laneSet", "subProcess", "participant", "textAnnotation", "startEvent", "parallelGateway", "BPMNShape", "Bounds"])}`;
      const end = elementEnd(xml, tag);
      const body = xml.slice(tag.start, end).replace(new RegExp(`(</?)${tag.name}(?=[\\s/>])`, "g"), `$1${to}`);
      return splice(xml, tag.start, end, body);
    }
    case "moved-element": {
      const from = pick((t) => /^(bpmn:)?(sequenceFlow|task|userTask|serviceTask|lane|exclusiveGateway|startEvent|endEvent)$/.test(t.name));
      const into = pick((t) => !t.selfClosing);
      if (!from || !into || (into.start >= from.start && into.start < elementEnd(xml, from))) return xml;
      const end = elementEnd(xml, from);
      const element = xml.slice(from.start, end);
      const removed = splice(xml, from.start, end);
      const at = into.end > from.start ? into.end - element.length : into.end;
      return splice(removed, at, at, element);
    }
    case "wise-extension": {
      const tag = pick((t) => t.attrs.some((a) => a.name === "id"));
      if (!tag) return xml;
      const others = tags.flatMap((t) => t.attrs.filter((a) => a.name === "id" || a.name === "wise:flowId").map((a) => a.value));
      const attr = rng.pick([
        `wise:flowId="${rng.pick(others)}"`,
        'wise:flowId=""',
        'wise:kind="bogus"',
        `wise:kind="${rng.pick(["activity", "stage", "gateway", "event", "note", "lane", "pool", "flow", "constraint", "follows"])}"`,
        'wise:tags="  and  xor split  "',
        'wise:tags=""',
      ]);
      const declared = xml.includes("xmlns:wise=") ? "" : ' xmlns:wise="http://wise-workbench.org/schema/flow"';
      const at = tag.start + 1 + tag.name.length;
      const cleaned = splice(xml, at, at, ` ${attr}${declared}`);
      // A tag that had the attribute already now has it twice: keep only the new one.
      return cleaned.replace(new RegExp(`(<${tag.name}\\s+${attr.split("=")[0]}="[^"]*"[^>]*?)\\s${attr.split("=")[0]}="[^"]*"`), "$1");
    }
    case "entities": {
      const decl = rng.pick([
        '<!DOCTYPE d [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;"><!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;"><!ENTITY d "&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;">]>',
        '<!DOCTYPE d [<!ENTITY ext SYSTEM "file:///etc/passwd">]>',
        "<!DOCTYPE definitions>",
      ]);
      const named = xml.replace(/ name="([^"]*)"/, ' name="$1 &d; &ext; &unknown; &#0; &#xD800;"');
      return named.startsWith("<?xml") ? named.replace(/\?>/, `?>${decl}`) : decl + named;
    }
  }
}

/** One to three mutations drawn from the kinds (or the given kind first), and the kinds applied. */
export function mutate(xml: string, rng: Random, first?: MutationKind): { xml: string; kinds: MutationKind[] } {
  const kinds: MutationKind[] = [first ?? rng.pick(MUTATION_KINDS)];
  while (kinds.length < 3 && rng.chance(0.3)) kinds.push(rng.pick(MUTATION_KINDS.filter((k) => k !== "large-file")));
  let out = xml;
  for (const kind of kinds) out = mutateOnce(out, kind, rng);
  return { xml: out, kinds };
}
