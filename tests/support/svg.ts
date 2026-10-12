/** Readings of an exported SVG string that several tests share. */

/** The text of an attribute or element as written, with the four escapes of the export undone. */
export const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

/** The ids of the drawn edges, unescaped and sorted. */
export const svgEdges = (svg: string) => [...svg.matchAll(/<g class="wf-edge" data-id="([^"]*)"/g)].map((m) => unescape(m[1])).sort();

/** The text of the note on withheld edges, as written. */
export const svgNote = (svg: string) => /<text [^>]*class="wf-edge-note"[^>]*>([^<]*)<\/text>/.exec(svg)?.[1];
