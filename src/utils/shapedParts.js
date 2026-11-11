/**
 * Shaped parts (openspec shaped-parts-and-sheet-bending): a part copy can carry its own shape,
 * `instance.shape = { kind, ...settings }`. Each kind is defined once in SHAPE_KINDS; everything else
 * (the engine, the viewport, history, saving, the MCP server) goes through `shapedPart`, which turns
 * a catalog part and a shape into a derived part with its own id, holes and box. The derived part's
 * mesh comes from the kind's `shapeMesh` on the catalog model. Later kinds (wires, rubber bands,
 * ropes) only add an entry here.
 *
 * A kind: { verb, accepts(part), check(shape, part) -> error | null, shapeMesh(pos, norm, idx, shape,
 * part) -> { pos, norm, idx }, shapePorts(ports, shape, part), shapeBox(part, shape),
 * mirror(shape, localAxis, part), describe(shape) }.
 */
import { SHEET_BEND_KIND, sheetBendKind } from './sheetBend.js';
import { BAND_KIND, bandKind } from './bandShape.js';

export const SHAPE_KINDS = { [SHEET_BEND_KIND]: sheetBendKind, [BAND_KIND]: bandKind };

const roundDeep = (v) => {
  if (typeof v === 'number') return Number(v.toFixed(3)) + 0;
  if (Array.isArray(v)) return v.map(roundDeep);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, roundDeep(v[k])]));
  return v;
};

/** The shape with numbers rounded to 0.001 and keys in order: what is saved and compared. */
export function normalizeShape(shape) {
  return shape && typeof shape === 'object' && shape.kind ? roundDeep(shape) : null;
}

/** A short stable key for a shape (same settings to 0.001 -> same key). */
export function shapeKey(shape) {
  const text = JSON.stringify(normalizeShape(shape));
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${h.toString(36)}${text.length.toString(36)}`;
}

export function shapeKindOf(shape) {
  return shape?.kind ? SHAPE_KINDS[shape.kind] || null : null;
}

/** Why a shape can't go on a part, or null when it can. */
export function shapeError(part, shape) {
  const kind = shapeKindOf(shape);
  if (!kind) return `Unknown shape kind "${shape?.kind}".`;
  if (!kind.accepts(part)) return shape.kind === SHEET_BEND_KIND ? 'Only plastic sheets can be bent.' : shape.kind === BAND_KIND ? 'Only rubber bands and belts can be strung.' : `A ${part.name} can't take a ${shape.kind} shape.`;
  return kind.check(shape, part);
}

export function describeShape(shape) {
  return shapeKindOf(shape)?.describe(shape) || null;
}

/** The shape flipped by a mirror across the part's own plane perpendicular to `localAxis`. */
export function mirrorShape(shape, localAxis, part) {
  const kind = shapeKindOf(shape);
  return kind ? normalizeShape(kind.mirror(shape, localAxis, part)) : shape;
}

export const isDerivedPartId = (id) => String(id).includes('~');

const derivedCache = new Map(); // derived id -> derived part (least recently used dropped first)
const DERIVED_CACHE_MAX = 200;

/**
 * The part a copy is drawn and checked as: the catalog part itself without a shape (or with one it
 * can't take), otherwise a derived part `{ ...part, id: '<partId>~<key>', basePartId, shape,
 * flatPorts, ports, bbox }`. The same shape gives the same object, so caches keyed by it hold.
 */
export function shapedPart(part, shape) {
  if (!part || !shape) return part;
  const kind = shapeKindOf(shape);
  if (!kind || !kind.accepts(part)) return part;
  const id = `${part.id}~${shapeKey(shape)}`;
  const cached = derivedCache.get(id);
  if (cached) {
    derivedCache.delete(id);
    derivedCache.set(id, cached);
    return cached;
  }
  let derived;
  try {
    derived = { ...part, id, basePartId: part.id, shape: normalizeShape(shape), flatPorts: part.ports, baseBbox: part.bbox, ports: kind.shapePorts(part.ports, shape, part), bbox: kind.shapeBox(part, shape) };
  } catch {
    return part; // a shape that can't be made shows the plain part
  }
  if (derivedCache.size >= DERIVED_CACHE_MAX) derivedCache.delete(derivedCache.keys().next().value);
  derivedCache.set(id, derived);
  return derived;
}

/** A derived part made earlier, by its id (null once it has dropped out of the cache). */
export function derivedPartById(id) {
  return derivedCache.get(id) || null;
}

/** The catalog part a derived part was made from (its own id, flat holes and box). */
export function baseOf(part) {
  return part?.basePartId ? { ...part, id: part.basePartId, ports: part.flatPorts, bbox: part.baseBbox, shape: undefined } : part;
}

/** A catalog mesh ({ pos, norm, idx } flat arrays) in the derived part's shape. */
export function shapeMeshArrays(derived, pos, norm, idx) {
  const kind = shapeKindOf(derived?.shape);
  if (!kind) return { pos, norm, idx };
  return kind.shapeMesh(pos, norm, idx, derived.shape, baseOf(derived));
}
