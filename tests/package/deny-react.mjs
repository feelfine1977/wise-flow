// Prove headless imports do not evaluate React, even though npm installs its peers.
export async function resolve(specifier, context, nextResolve) {
  if (/^(react|react-dom|@xyflow\/react)(\/|$)/.test(specifier)) throw new Error(`Headless core loaded ${specifier}`);
  return nextResolve(specifier, context);
}
