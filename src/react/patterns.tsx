import type { PatternId } from "../core/index.js";

/** Small SVG that fills its parent with the pattern twin of a categorical colour. */
export function PatternSwatch({ pattern, ink = "currentColor" }: { pattern: PatternId; ink?: string }) {
  if (pattern === "solid") return null;
  const s = 6;
  const stroke = { stroke: ink, strokeWidth: 1, strokeOpacity: 0.6 };
  let body: React.ReactNode = null;
  switch (pattern) {
    case "diagonal":
      body = <path d={`M0 ${s}L${s} 0`} {...stroke} />;
      break;
    case "diagonal-reverse":
      body = <path d={`M0 0L${s} ${s}`} {...stroke} />;
      break;
    case "dots":
      body = <circle cx={s / 2} cy={s / 2} r={1} fill={ink} fillOpacity={0.7} />;
      break;
    case "crosshatch":
      body = <path d={`M0 ${s}L${s} 0M0 0L${s} ${s}`} {...stroke} />;
      break;
    case "horizontal":
      body = <path d={`M0 ${s / 2}H${s}`} {...stroke} />;
      break;
    case "vertical":
      body = <path d={`M${s / 2} 0V${s}`} {...stroke} />;
      break;
    case "grid":
      body = <path d={`M0 ${s / 2}H${s}M${s / 2} 0V${s}`} {...stroke} />;
      break;
  }
  const id = `wf-pat-${pattern}`;
  return (
    <svg aria-hidden="true" focusable="false">
      <defs>
        <pattern id={id} width={s} height={s} patternUnits="userSpaceOnUse">
          {body}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}
