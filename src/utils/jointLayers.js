/**
 * Walking the assembly's joint graph (openspec outliner-part-groups), for Select Connected and for
 * expanding the selection one layer at a time. The graph comes from `jointGraph` in
 * mcp/assembly-engine.mjs: `{ nodes: [instanceId], edges: [[a, b]] }`, fasteners as nodes of their own.
 * `collapse` (from partGroups.js `groupCollapse`) maps a grouped part to its group id, so a group is one
 * node: reaching any member brings in all of them in the same step. Pure, shared by the app and the MCP server.
 */

function unitsOf(graph, collapse = new Map()) {
  const unitOf = (id) => collapse.get(id) ?? id;
  const members = new Map();
  const add = (id) => {
    const unit = unitOf(id);
    if (!members.has(unit)) members.set(unit, []);
    if (!members.get(unit).includes(id)) members.get(unit).push(id);
  };
  graph.nodes.forEach(add);
  // Grouped parts that aren't graph nodes (hidden) still come along with their group
  for (const [id] of collapse) add(id);
  const next = new Map([...members.keys()].map((unit) => [unit, new Set()]));
  for (const [a, b] of graph.edges) {
    const ua = unitOf(a);
    const ub = unitOf(b);
    if (ua === ub) continue;
    next.get(ua)?.add(ub);
    next.get(ub)?.add(ua);
  }
  return { unitOf, members, next };
}

/**
 * The selection as layers: `[[seed ids], [layer 1 ids], ...]`, each layer the parts directly joined to
 * the ones before it. Stops at the first layer that adds nothing, so the last layer is never empty.
 */
export function layersFrom(graph, ids, { collapse } = {}) {
  const { unitOf, members, next } = unitsOf(graph, collapse);
  const seen = new Set();
  let frontier = [];
  for (const id of ids) {
    const unit = unitOf(id);
    if (seen.has(unit)) continue;
    seen.add(unit);
    frontier.push(unit);
  }
  const idsOf = (units) => units.flatMap((u) => members.get(u) || [u]);
  const layers = [idsOf(frontier)];
  for (;;) {
    const layer = [];
    for (const unit of frontier) {
      for (const n of next.get(unit) || []) {
        if (seen.has(n)) continue;
        seen.add(n);
        layer.push(n);
      }
    }
    if (layer.length === 0) break;
    layers.push(idsOf(layer));
    frontier = layer;
  }
  return layers;
}

/** Every part joined to any of `ids`, directly or through other parts, including `ids` themselves. */
export function connectedFrom(graph, ids, options = {}) {
  return layersFrom(graph, ids, options).flat();
}
