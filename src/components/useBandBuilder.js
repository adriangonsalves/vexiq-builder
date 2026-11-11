import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { BAND_SPECS, bandSpec, partSpots, spotByFeature, suggestBand, worldSpot } from '../utils/bandPath.js';
import { instanceMatrix, isRoutedBand, stringBand } from '../utils/bandRoute.js';
import { STRETCH_COLORS } from '../sim/bandStrength.js';
import { shapedPart } from '../utils/shapedParts.js';

const DEFAULT_SIZE = '228-2500-470'; // #117B, what Swish's catapult and intake use
const v3 = (a) => new THREE.Vector3(...a);
const HOOK_KINDS = new Set(['post', 'groove', 'rim', 'gap', 'gaphook', 'hook']);
/** A band there and back (a fold): two hooks with only edges between, unless `back` forces it (as the engine's placeBand). */
const isFoldRoute = (route, back, kindOf) => {
  if (back === 'same') return route.length >= 2;
  if (back === 'straight') return false;
  return route.length >= 2 && route.filter((s, i) => i === 0 || i === route.length - 1 || HOOK_KINDS.has(kindOf(s))).length === 2;
};
const foldOf = (route) => [...route, ...route.slice(1, -1).reverse()];
const sameSpot = (a, b) => Boolean(a && b && a.instanceId === b.instanceId && a.feature === b.feature);

/**
 * The Band builder (openspec rubber-bands): picking spots in the 3D view, the see-through band, the
 * panel's route list, Other way round, the ring close-up, and editing a placed band by its handles.
 *
 * session: { size: partNumber | 'auto', route: [entry], hover, pointer, pending: { side, wraps },
 *   alternative: 0..3 (Other way round), editId, inWay: { id: 'over'|'under' },
 *   needsRoute: [{ instanceId, label }], drag: { index, spot } }
 */
export function useBandBuilder({ instances, catalog, catalogMap, selectedIds, runAction, previewPlace, setFeedback, locked }) {
  const [session, setSession] = useState(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  // The part a copy is drawn as (a bent sheet as bent; bands' own spots don't matter)
  const shapedPartOf = useCallback((inst) => shapedPart(catalogMap.get(inst?.partId), inst?.shape) || null, [catalogMap]);

  const sizes = useMemo(() => catalog.filter((p) => BAND_SPECS[p.partNumber] && p.partNumber !== '228-2500-474'), [catalog]);
  const partByNumber = useCallback((pn) => catalog.find((p) => p.partNumber === pn) || null, [catalog]);

  // --- Opening ----------------------------------------------------------------------------------
  const open = useCallback((route = [], extra = {}) => {
    setSession({ size: extra.size || 'auto', route, back: extra.back || 'auto', hover: null, pointer: null, pending: { side: 'out', wraps: 1 }, alternative: 0, editId: extra.editId || null, inWay: {}, needsRoute: null, drag: null });
  }, []);
  const close = useCallback(() => setSession(null), []);

  /** A band placed earlier: edit its route by its handles. */
  const editBand = useCallback((band) => {
    if (!isRoutedBand(band)) return;
    // From the user's own clicks when the band has them; an older band's whole route goes back as it is
    const list = band.shape.picks || band.shape.route;
    open(list.map(({ instanceId, feature, side, wraps, cross, height, wrap, line, auto }) => ({ instanceId, feature, side, wraps, ...(cross ? { cross } : {}), ...(height !== undefined ? { height } : {}), ...(wrap ? { wrap } : {}), ...(line ? { line, auto } : {}) })), {
      editId: band.instanceId,
      size: catalogMap.get(band.partId)?.partNumber || DEFAULT_SIZE,
      back: band.shape.picks ? band.shape.back || 'auto' : 'straight'
    });
  }, [open, catalogMap]);

  const byId = useMemo(() => new Map(instances.map((i) => [i.instanceId, i])), [instances]);
  const kindOf = useCallback((s) => {
    const inst = byId.get(s.instanceId);
    return inst ? spotByFeature(catalogMap.get(inst.partId), s.feature)?.kind : null;
  }, [byId, catalogMap]);
  const selected = useMemo(() => selectedIds.map((id) => byId.get(id)).filter((i) => i && i.visible !== false), [selectedIds, byId]);

  /** Band between these: two selected parts, the spots of each nearest the other. */
  const betweenCheck = useMemo(() => {
    if (selected.length !== 2) return { ok: false, error: 'Select two parts the band goes between.' };
    const spotsOf = (inst) => partSpots(catalogMap.get(inst.partId)).filter((s) => s.kind !== 'gaphook' && s.kind !== 'gap' && !s.hidden);
    if (selected.some((i) => !spotsOf(i).length)) return { ok: false, error: `${selected.find((i) => !spotsOf(i).length).label} has nothing a band can go round.` };
    const pick = (inst, other) => {
      const m = instanceMatrix(inst);
      const to = v3(other.position);
      return spotsOf(inst)
        .map((s) => ({ s, d: worldSpot(s, m).center.distanceTo(to) }))
        .sort((a, b) => a.d - b.d)[0].s;
    };
    const [a, b] = selected;
    return { ok: true, route: [{ instanceId: a.instanceId, feature: pick(a, b).feature, side: 'out', wraps: 1 }, { instanceId: b.instanceId, feature: pick(b, a).feature, side: 'out', wraps: 1 }] };
  }, [selected, catalogMap]);

  /** Belt round these: two or more pulleys, hubs or sprockets on parallel axles, round the outside. */
  const beltCheck = useMemo(() => {
    const round = selected
      .map((inst) => {
        const spot = partSpots(catalogMap.get(inst.partId)).find((s) => s.kind === 'groove' || s.kind === 'rim');
        return spot ? { inst, spot: worldSpot(spot, instanceMatrix(inst)), feature: spot.feature } : null;
      })
      .filter(Boolean);
    if (round.length < 2 || round.length !== selected.length) return { ok: false, error: 'Select two or more pulleys, hubs or sprockets.' };
    const axis = round[0].spot.axis;
    if (round.some((r) => Math.abs(r.spot.axis.dot(axis)) < Math.cos(THREE.MathUtils.degToRad(2)))) return { ok: false, error: 'The pulleys’ axles aren’t parallel.' };
    // Round the outside: in order of angle about their middle, seen along the axle
    const mid = round.reduce((s, r) => s.add(r.spot.center), new THREE.Vector3()).divideScalar(round.length);
    const u = new THREE.Vector3().crossVectors(axis, Math.abs(axis.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize();
    const w = new THREE.Vector3().crossVectors(axis, u);
    const ang = (r) => {
      const d = r.spot.center.clone().sub(mid);
      return Math.atan2(d.dot(w), d.dot(u));
    };
    round.sort((a, b) => ang(a) - ang(b));
    return { ok: true, route: round.map((r) => ({ instanceId: r.inst.instanceId, feature: r.feature, side: 'out', wraps: 1 })) };
  }, [selected, catalogMap]);

  // --- The see-through band -----------------------------------------------------------------------
  const sizePart = session ? partByNumber(session.size === 'auto' ? DEFAULT_SIZE : session.size) : null;
  const shownRoute = useMemo(() => {
    if (!session) return [];
    let route = session.route;
    if (session.drag) {
      const { index, spot, insertAt } = session.drag;
      if (insertAt !== undefined) route = spot ? [...route.slice(0, insertAt), { ...spot, side: 'out', wraps: 1 }, ...route.slice(insertAt)] : route;
      else route = spot ? route.map((s, i) => (i === index ? { ...s, instanceId: spot.instanceId, feature: spot.feature, height: spot.height } : s)) : route.filter((_, i) => i !== index);
    }
    // The see-through band shows only the spots clicked (and a handle being dragged), never the spot
    // under the pointer: it stays put while you aim
    return isFoldRoute(route, session.back, kindOf) ? foldOf(route) : route;
  }, [session, kindOf]);

  const strung = useMemo(() => {
    if (!session || !sizePart || shownRoute.length < 2) return null;
    const band = (session.editId && byId.get(session.editId)) || { instanceId: '__band-preview__', partId: sizePart.id, position: [0, 0, 0], rotation: [0, 0, 0], visible: true };
    const res = stringBand({ ...band, partId: sizePart.id }, shownRoute, instances.filter((i) => i.instanceId !== session.editId), shapedPartOf);
    return res.error ? null : res;
  }, [session, sizePart, shownRoute, instances, byId, shapedPartOf]);

  // The engine's own try of the route (after each click, and as a handle is dragged): the band round
  // the parts in its way, as Done will place it, or why it can't be
  // For Choose for me: the size whose stretch on this route is closest to 1.5× (the length hardly
  // depends on the size, so the see-through band's length picks it)
  const autoSize = useMemo(() => (strung ? suggestBand(strung.lengthMm)?.[0] || DEFAULT_SIZE : DEFAULT_SIZE), [strung]);
  const finalSize = session?.size === 'auto' ? autoSize : session?.size;
  // The engine routes what's shown: the spots clicked, or with the handle being dragged where it is now
  const routeKey = session ? JSON.stringify([finalSize, shownRoute, session.inWay, session.back, session.alternative || 0]) : null;
  const [enginePreview, setEnginePreview] = useState(null); // { key, points, stretch, state, pullN, lengthMm, added, error }
  useEffect(() => {
    if (!previewPlace || !routeKey || !session || shownRoute.length < 2 || !sizePart) return undefined;
    let live = true;
    const s = session;
    const spots = shownRoute;
    const previewPart = partByNumber(finalSize) || sizePart;
    // While a handle is dragged, ask once the pointer settles on a spot (not for every spot it passes)
    const ask = () => previewPlace({ ...(s.editId ? { instanceId: s.editId } : {}), bandPartId: previewPart.id, spots, inWay: s.inWay, back: s.back, alternative: s.drag ? 0 : s.alternative || 0, dryRun: true })
      .then((data) => {
        if (!live) return;
        setEnginePreview(data?.ok ? { key: routeKey, points: data.points, stretch: data.stretch, state: data.stretchState, pullN: data.pullN, lengthMm: data.lengthMm, added: data.addedInWay || [], route: data.route, fold: data.fold, alternatives: data.alternatives || 1, alternative: data.alternative || 0, suggestion: data.slack || data.stretchState === 'too far' ? data.suggestion : null } : { key: routeKey, error: data?.error || 'No route', needsRoute: data?.needsRoute || null });
      })
      .catch(() => {});
    const timer = setTimeout(ask, s.drag ? 120 : 0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [routeKey]);
  // The engine's band for what's shown; while a handle is dragged, its last band until the new one comes
  const engineShown = enginePreview && (enginePreview.key === routeKey || (session?.drag && enginePreview.points)) ? enginePreview : null;

  const finalStretch = strung ? strung.lengthMm / (BAND_SPECS[finalSize]?.freeMm || strung.freeMm) : null;
  const finalState = finalStretch === null ? null : finalStretch < 1 ? 'slack' : finalStretch <= 2 ? 'snug' : finalStretch <= 3 ? 'tight' : 'too far';

  // A handle on each spot clicked, then one on the band between each two spots (and, for a loop,
  // between the last and the first): drag a spot's handle to another spot, or a band handle onto any
  // spot (a beam's edge, a post, a gear's rim) to make the band go round it there
  const handles = useMemo(() => {
    if (!session) return [];
    const route = session.route;
    const out = [];
    const centres = route.map((s) => {
      const inst = byId.get(s.instanceId);
      const local = inst ? spotByFeature(catalogMap.get(inst.partId), s.feature) : null;
      return local ? worldSpot(local, instanceMatrix(inst)) : null;
    });
    route.forEach((s, i) => {
      out.push(centres[i] ? { spot: centres[i], height: Number.isFinite(s.height) ? s.height : 0, hot: session.drag?.index === i } : { point: [0, 0, -1e6] });
    });
    // The band as drawn: the engine's route when it has one, else the straight try
    const pts = engineShown?.points || (strung ? strung.shape.path.points.map((p) => p.map((c, k) => c + strung.position[k])) : null);
    if (pts && !session.drag && route.length >= 2) {
      const fold = engineShown ? engineShown.fold : false;
      const runs = route.length - 1 + (fold ? 0 : 1);
      for (let i = 0; i < runs; i++) {
        const a = centres[i];
        const b = centres[(i + 1) % route.length];
        if (!a || !b) {
          out.push({ point: [0, 0, -1e6] });
          continue;
        }
        // The point of the band nearest halfway between the two spots
        const mid = a.center.clone().add(b.center).multiplyScalar(0.5);
        let best = null;
        for (const p of pts) {
          const d = mid.distanceToSquared(v3(p));
          if (!best || d < best.d) best = { p, d };
        }
        out.push({ point: best.p, small: true });
      }
    }
    return out;
  }, [session, byId, catalogMap, strung, engineShown]);

  const viewportBand = useMemo(() => {
    if (!session) return null;
    let preview = {};
    if (engineShown?.points) {
      preview = { points: engineShown.points, color: STRETCH_COLORS[engineShown.state] ?? 0x2fa84f, closed: true };
    } else if (strung && !session.drag) {
      preview = { points: strung.shape.path.points.map((p) => p.map((c, k) => c + strung.position[k])), color: STRETCH_COLORS[finalState] ?? 0x2fa84f, closed: true };
    }
    return { preview, handles };
  }, [session, strung, finalState, handles, byId, catalogMap, engineShown]);

  // --- Picking ------------------------------------------------------------------------------------
  const onHover = useCallback((hover, pointer) => {
    setSession((s) => (s && (!sameSpot(s.hover, hover) || s.hover?.height !== hover?.height || (s.route.length === 1 && pointer)) ? { ...s, hover, pointer } : s));
  }, []);

  const finish = useCallback(async (inWayAnswers = null) => {
    const s = sessionRef.current;
    if (!s) return;
    const route = s.route;
    if (route.length < 2) {
      setFeedback({ message: 'A band needs two or more spots.', isError: true });
      return;
    }
    const sizePn = s.size === 'auto' ? autoSize : s.size;
    const part = partByNumber(sizePn);
    const inWay = { ...(s.inWay || {}), ...(inWayAnswers || {}) };
    const data = await runAction('place_band', { ...(s.editId ? { instanceId: s.editId } : {}), bandPartId: part?.id, spots: route, inWay, back: s.back, alternative: s.alternative || 0 });
    if (data?.needsRoute) {
      setSession((cur) => (cur ? { ...cur, needsRoute: data.needsRoute, inWay } : cur));
      return;
    }
    if (data?.ok) setSession(null);
  }, [autoSize, partByNumber, runAction, setFeedback]);

  /**
   * Where a new spot goes in a route: between the two neighbouring spots it adds least length to (and,
   * for a loop, between the last and the first). Returns the index to insert at.
   */
  const centreOf = useCallback((x) => {
    const inst = byId.get(x.instanceId);
    const local = inst ? spotByFeature(catalogMap.get(inst.partId), x.feature) : null;
    return local ? worldSpot(local, instanceMatrix(inst)).center : null;
  }, [byId, catalogMap]);
  const nearestRun = useCallback((route, spot, fold) => {
    const p = centreOf(spot);
    if (!p) return route.length - 1;
    let best = { at: route.length - 1, cost: Infinity };
    const runs = route.length - 1 + (fold ? 0 : 1);
    for (let i = 0; i < runs; i++) {
      const a = centreOf(route[i]);
      const b = centreOf(route[(i + 1) % route.length]);
      if (!a || !b) continue;
      const cost = a.distanceTo(p) + p.distanceTo(b) - a.distanceTo(b);
      if (cost < best.cost) best = { at: i + 1, cost };
    }
    return best.at;
  }, [centreOf]);

  const onPick = useCallback((spot) => {
    const s = sessionRef.current;
    if (!s || locked) return;
    if (s.route.length >= 2 && sameSpot(spot, s.route[0])) {
      finish();
      return;
    }
    if (sameSpot(spot, s.route.at(-1))) return;
    const entry = { instanceId: spot.instanceId, feature: spot.feature, side: s.pending.side, wraps: s.pending.wraps, ...(Number.isFinite(spot.height) ? { height: spot.height } : {}) };
    // Editing a band: a clicked spot goes into the stretch of band nearest it (not on the end, where it
    // would become the band's far hook)
    if (s.editId && s.route.length >= 2) {
      if (s.route.some((x) => sameSpot(x, spot))) return;
      const at = nearestRun(s.route, spot, enginePreviewRef.current?.fold ?? isFoldRoute(s.route, s.back, kindOf));
      setSession({ ...s, route: [...s.route.slice(0, at), entry, ...s.route.slice(at)], alternative: 0, needsRoute: null, pending: { side: 'out', wraps: 1 } });
      return;
    }
    setSession({ ...s, route: [...s.route, entry], alternative: 0, needsRoute: null, pending: { side: 'out', wraps: 1 } });
  }, [finish, locked, kindOf, nearestRun]);


  /** Dragging a handle: index < route length moves that spot; past it, the run after spot (index - n) takes a new spot. */
  const onHandle = useCallback((index, spot, { done }) => {
    const s = sessionRef.current;
    if (!s) return;
    const n = s.route.length;
    const drag = index < n ? { index, spot } : { insertAt: index - n + 1, spot };
    if (!done) {
      setSession({ ...s, drag });
      return;
    }
    let route = s.route;
    // A band keeps at least two anchors
    if (!spot && drag.insertAt === undefined && n <= 2) {
      setFeedback({ message: 'A band needs two anchors: move this one to another spot instead.', isError: true });
      setSession({ ...s, drag: null });
      return;
    }
    if (drag.insertAt !== undefined) {
      if (spot) route = [...route.slice(0, drag.insertAt), { instanceId: spot.instanceId, feature: spot.feature, side: 'out', wraps: 1 }, ...route.slice(drag.insertAt)];
    } else if (spot) route = route.map((x, i) => (i === index ? { ...x, instanceId: spot.instanceId, feature: spot.feature, height: spot.height } : x));
    else route = route.filter((_, i) => i !== index);
    const next = { ...s, route, drag: null, alternative: 0 };
    setSession(next);
    sessionRef.current = next;
    if (s.editId && route.length >= 2) finish();
  }, [finish, setFeedback]);

  // --- The panel's controls -------------------------------------------------------------------------
  const setEntry = useCallback((i, patch) => setSession((s) => (s ? { ...s, route: s.route.map((x, k) => (k === i ? { ...x, ...patch } : x)), alternative: 0 } : s)), []);
  const removeEntry = useCallback((i) => setSession((s) => {
    if (!s) return s;
    if (s.editId && s.route.length <= 2) {
      queueMicrotask(() => setFeedback({ message: 'A band needs two anchors: move this one to another spot instead.', isError: true }));
      return s;
    }
    return { ...s, route: s.route.filter((_, k) => k !== i), alternative: 0 };
  }), [setFeedback]);
  const setPending = useCallback((patch) => setSession((s) => (s ? { ...s, pending: { ...s.pending, ...patch } } : s)), []);
  const setSize = useCallback((size) => setSession((s) => (s ? { ...s, size } : s)), []);
  const setBack = useCallback((back) => setSession((s) => (s ? { ...s, back, alternative: 0 } : s)), []);
  const undoSpot = useCallback(() => setSession((s) => (s && s.route.length ? { ...s, route: s.route.slice(0, -1), alternative: 0 } : s)), []);

  // Other way round: the next of the ways the engine found (over the parts, or under them)
  const enginePreviewRef = useRef(null);
  enginePreviewRef.current = enginePreview;
  const otherWay = useCallback((dir = 1) => {
    const count = enginePreviewRef.current?.alternatives || 1;
    if (count < 2) return;
    setSession((s) => (s ? { ...s, alternative: ((s.alternative || 0) + dir + count) % count } : s));
  }, []);

  /** A gap of a gear clicked in the ring close-up: in the route (next to that gear's other spots) or out. */
  const toggleGap = useCallback((instanceId, feature) => {
    setSession((s) => {
      if (!s) return s;
      const at = s.route.findIndex((x) => x.instanceId === instanceId && x.feature === feature);
      if (at >= 0) return { ...s, route: s.route.filter((_, k) => k !== at), alternative: 0 };
      const lastOnPart = s.route.map((x, k) => (x.instanceId === instanceId ? k : -1)).filter((k) => k >= 0).at(-1);
      const entry = { instanceId, feature, side: 'out', wraps: 1 };
      const route = lastOnPart === undefined ? [...s.route, entry] : [...s.route.slice(0, lastOnPart + 1), entry, ...s.route.slice(lastOnPart + 1)];
      return { ...s, route, alternative: 0 };
    });
  }, []);

  // Keys: Enter finishes (or keeps the shown route), Backspace takes off the last spot, Esc cancels;
  // with no spot lit, R / Shift+R step to the other ways round
  useEffect(() => {
    if (!session) return undefined;
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        setSession(null);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        finish();
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        e.stopImmediatePropagation();
        undoSpot();
      } else if ((e.key === 'r' || e.key === 'R') && !sessionRef.current?.hover && (enginePreviewRef.current?.alternatives || 1) > 1) {
        e.preventDefault();
        otherWay(e.shiftKey ? -1 : 1);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [Boolean(session), finish, undoSpot, otherWay]);

  // Labels for the panel
  const entryLabel = useCallback((s) => {
    const inst = byId.get(s.instanceId);
    const spot = inst ? spotByFeature(catalogMap.get(inst.partId), s.feature) : null;
    return { part: inst?.label || s.instanceId, spot: spot?.label || s.feature, round: spot?.shape === 'circle' };
  }, [byId, catalogMap]);

  // Gears, sprockets and pulleys on the route or under the pointer, for the ring close-up
  const ringParts = useMemo(() => {
    if (!session) return [];
    const ids = [...new Set([...session.route.map((s) => s.instanceId), session.hover?.instanceId].filter(Boolean))];
    return ids
      .map((id) => byId.get(id))
      .filter((inst) => {
        const g = catalogMap.get(inst?.partId)?.gearSpecs;
        return g && (g.gearType === 'pulley' || (g.teeth && g.tipRadiusMm));
      })
      .map((inst) => {
        const part = catalogMap.get(inst.partId);
        const m = instanceMatrix(inst);
        const rim = partSpots(part).find((s) => s.kind === 'rim' || s.kind === 'groove');
        const w = rim ? worldSpot(rim, m) : null;
        // Posts held on the gear: spots of other parts whose centre lies on its face, within its rim
        const posts = [];
        if (w) {
          const [u, vv] = (() => {
            const a = w.axis;
            const uu = new THREE.Vector3().crossVectors(a, Math.abs(a.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize();
            return [uu, new THREE.Vector3().crossVectors(a, uu)];
          })();
          for (const other of instances) {
            if (other.instanceId === inst.instanceId || other.visible === false || isRoutedBand(other)) continue;
            if (v3(other.position).distanceTo(w.center) > (rim.radius || 30) + 20) continue;
            for (const s of partSpots(catalogMap.get(other.partId))) {
              if (s.kind !== 'post') continue;
              const ws = worldSpot(s, instanceMatrix(other));
              if (Math.abs(ws.axis.dot(w.axis)) < 0.99) continue;
              const d = ws.center.clone().sub(w.center);
              const along = d.dot(w.axis);
              if (Math.abs(along) > 20) continue;
              d.addScaledVector(w.axis, -along);
              if (d.length() > (rim.radius || 30)) continue;
              posts.push({ instanceId: other.instanceId, feature: s.feature, x: d.dot(u), y: d.dot(vv), r: s.radius, label: other.label });
            }
          }
          const gaps = partSpots(part)
            .filter((s) => s.kind === 'gap')
            .map((s) => {
              const ws = worldSpot(s, m);
              return { feature: s.feature, gap: s.gap, x: ws.radial.dot(u), y: ws.radial.dot(vv) };
            });
          return { instanceId: inst.instanceId, label: inst.label, name: part.name, radius: rim.radius, root: part.gearSpecs.rootRadiusMm || rim.radius, gaps, posts, u, v: vv, centre: w.center };
        }
        return null;
      })
      .filter(Boolean);
  }, [session, byId, catalogMap, instances]);

  return {
    session,
    open,
    close,
    editBand,
    betweenCheck,
    beltCheck,
    sizes,
    viewportBand,
    onHover,
    onPick,
    onHandle,
    finish,
    setEntry,
    removeEntry,
    setPending,
    setSize,
    setBack,
    undoSpot,
    otherWay,
    ways: engineShown ? { count: engineShown.alternatives || 1, index: engineShown.alternative || 0 } : null,
    toggleGap,
    entryLabel,
    ringParts,
    engine: engineShown,
    // What the band will do: there and back, or a loop (the engine's answer once it has one)
    fold: engineShown && typeof engineShown.fold === 'boolean' ? engineShown.fold : session ? isFoldRoute(session.route, session.back, kindOf) : false,
    readout: engineShown?.points
      ? {
          lengthMm: engineShown.lengthMm,
          freeMm: BAND_SPECS[finalSize]?.freeMm,
          stretch: engineShown.stretch,
          state: engineShown.state,
          pullN: engineShown.pullN,
          size: BAND_SPECS[finalSize]?.name,
          added: engineShown.added,
          suggestion: engineShown.suggestion || null
        }
      : strung
      ? {
          lengthMm: strung.lengthMm,
          freeMm: BAND_SPECS[finalSize]?.freeMm || strung.freeMm,
          stretch: finalStretch,
          state: finalState,
          pullN: strung.pullN,
          size: BAND_SPECS[finalSize]?.name,
          suggestion: (finalState === 'slack' || finalState === 'too far') && suggestBand(strung.lengthMm)?.[0] !== finalSize ? { partNumber: suggestBand(strung.lengthMm)[0], name: suggestBand(strung.lengthMm)[1].name, stretch: suggestBand(strung.lengthMm)[2] } : null
        }
      : null,
    shownRoute
  };
}

export { bandSpec };
