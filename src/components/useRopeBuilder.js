import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { spotByFeature, worldSpot } from '../utils/bandPath.js';
import { instanceMatrix } from '../utils/bandRoute.js';
import { ROPE_SPECS, endPlaces, spoolSpec, turnForSide } from '../utils/ropePath.js';
import { ropeSpotsNearPoint } from '../utils/ropeRoute.js';

const PREVIEW_COLOR = 0x2563eb;
const SHORT_COLOR = 0xdc2626;
const v3 = (a) => new THREE.Vector3(...a);
const sameSpot = (a, b) => Boolean(a && b && a.instanceId === b.instanceId && a.feature === b.feature);
const isEndKind = (k) => k === 'post' || k === 'pocket';

/**
 * The Rope builder (openspec rope-and-spool, design decision 7): tap where the first end goes, tap the
 * pulleys, posts and edges it passes, tap where the other end goes, Done. Built on the engine's
 * place_rope: every tap asks it for a dry run, which the see-through rope and the panel show.
 *
 * session: { size: partNumber | 'auto', picks: [{ instanceId, feature, kind, height?, turn?, side?, wraps }],
 *   (`side`: where a pulley or post was tapped, from its centre, world: the rope goes round that side)
 *   hover, turns: number | null (null: all the spare), winding: 1 | -1 }
 */
export function useRopeBuilder({ instances, catalog, catalogMap, selectedIds, runAction, previewPlace, setFeedback, locked }) {
  const [session, setSession] = useState(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const sizes = useMemo(() => catalog.filter((p) => ROPE_SPECS[p.partNumber]).sort((a, b) => ROPE_SPECS[a.partNumber].lengthMm - ROPE_SPECS[b.partNumber].lengthMm), [catalog]);
  const byId = useMemo(() => new Map(instances.map((i) => [i.instanceId, i])), [instances]);

  const open = useCallback((picks = []) => setSession({ size: 'auto', picks, hover: null, turns: null, winding: 1 }), []);
  /**
   * A rope placed earlier: its ends and spots get handles to drag to other places (openspec
   * rope-and-spool "Editing"). Each drop routes the rope again as one history step.
   */
  const editRope = useCallback((inst) => {
    const shape = inst?.shape;
    if (!shape?.ends?.[0]) return;
    const kindOf = (ref) => {
      if (ref.feature === 'pocket') return 'pocket';
      const other = byId.get(ref.instanceId);
      return spotByFeature(other ? catalogMap.get(other.partId) : null, ref.feature)?.kind || 'post';
    };
    const end = (e) => ({ instanceId: e.instanceId, feature: e.feature, kind: kindOf(e), wraps: 1, ...(Number.isFinite(e.at) ? { height: e.at } : {}) });
    const picks = [end(shape.ends[0]), ...(shape.via || []).filter((v) => !v.auto && v.feature !== 'wrap').map((v) => ({ instanceId: v.instanceId, feature: v.feature, kind: kindOf(v), wraps: v.wraps || 1, ...(v.turn ? { turn: v.turn } : {}) })), ...(shape.ends[1] ? [end(shape.ends[1])] : [])];
    setSession({ size: catalogMap.get(inst.partId)?.partNumber || 'auto', picks, hover: null, turns: shape.spool ? shape.spool.turns : null, winding: shape.spool?.winding === -1 ? -1 : 1, editId: inst.instanceId, freeEnd: !shape.ends[1] });
  }, [byId, catalogMap]);
  const close = useCallback(() => setSession(null), []);

  /** A pick's place in the world: { center, axis } (a spool's pocket: its centre). */
  const placeOf = useCallback((p) => {
    const inst = byId.get(p.instanceId);
    const part = inst ? catalogMap.get(inst.partId) : null;
    if (!part) return null;
    const m = instanceMatrix(inst);
    if (p.feature === 'pocket') return { center: v3(spoolSpec(part).pocket.center).applyMatrix4(m), axis: new THREE.Vector3(0, 0, 1) };
    const local = spotByFeature(part, p.feature);
    return local ? worldSpot(local, m) : null;
  }, [byId, catalogMap]);

  /** The route place_rope takes from the picks (and the lit spot, while picking). */
  const routeOf = useCallback((picks, s) => {
    if (!picks.length) return null;
    const asEnd = (p) => ({ instanceId: p.instanceId, feature: p.feature, ...(p.kind === 'post' && Number.isFinite(p.height) ? { at: p.height } : {}) });
    // A pulley or post takes the side it was tapped on, until Flip side says otherwise
    const turnOf = (p, i) => {
      if (p.turn) return p.turn;
      if (!p.side) return null;
      const [here, before] = [placeOf(p), placeOf(picks[i - 1])];
      if (!here || !before) return null;
      // (past the last tap the rope hangs straight down)
      const after = i + 1 < picks.length ? placeOf(picks[i + 1])?.center : here.center.clone().add(new THREE.Vector3(0, -100, 0));
      return after ? turnForSide(before.center, here, after, p.side) : null;
    };
    const asVia = (p, k) => {
      const turn = turnOf(p, k + 1);
      return { instanceId: p.instanceId, feature: p.feature, wraps: p.wraps || 1, ...(turn ? { turn } : {}) };
    };
    const last = picks.at(-1);
    const toEnd = picks.length >= 2 && isEndKind(last.kind) && !s.freeEnd;
    const params = {
      ...(s.editId ? { instanceId: s.editId } : {}),
      from: asEnd(picks[0]),
      ...(toEnd ? { to: asEnd(last) } : {}),
      via: (toEnd ? picks.slice(1, -1) : picks.slice(1)).map(asVia),
      ...(s.size !== 'auto' ? { ropePartId: catalog.find((p) => p.partNumber === s.size)?.id } : {}),
      ...(s.turns !== null ? { turns: s.turns } : {}),
      winding: s.winding === -1 ? 'under' : 'over'
    };
    return params;
  }, [catalog, placeOf]);

  // The engine's dry run for what's picked (and the lit spot as the next tap)
  const shownPicks = useMemo(() => {
    if (!session) return [];
    const h = session.hover;
    if (h && !session.editId && session.picks.length && !session.picks.some((p) => sameSpot(p, h))) return [...session.picks, { ...h, wraps: 1 }];
    return session.picks;
  }, [session]);
  const params = useMemo(() => (session ? routeOf(shownPicks, session) : null), [session, shownPicks, routeOf]);
  const key = params ? JSON.stringify(params) : null;
  const [engine, setEngine] = useState(null);
  useEffect(() => {
    if (!previewPlace || !key || !session) return undefined;
    let live = true;
    const timer = setTimeout(() => {
      previewPlace({ ...params, dryRun: true, allowShort: true })
        .then((data) => live && setEngine({ key, ...(data?.ok ? data : { error: data?.error || 'No route' }) }))
        .catch(() => {});
    }, 60);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key]);
  const shown = engine && engine.key === key ? engine : null;

  const handles = useMemo(() => {
    if (!session) return [];
    return session.picks.map((p) => {
      const inst = byId.get(p.instanceId);
      const part = inst ? catalogMap.get(inst.partId) : null;
      if (!part) return { point: [0, 0, -1e6] };
      const m = instanceMatrix(inst);
      if (p.feature === 'pocket') {
        const sp = spoolSpec(part);
        return { point: v3(sp.pocket.center).applyMatrix4(m).toArray() };
      }
      const local = spotByFeature(part, p.feature);
      return local ? { spot: worldSpot(local, m), height: Number.isFinite(p.height) ? p.height : 0 } : { point: [0, 0, -1e6] };
    });
  }, [session, byId, catalogMap]);

  const viewportRope = useMemo(() => {
    if (!session) return null;
    const preview = shown?.points ? { points: shown.points, color: shown.short ? SHORT_COLOR : PREVIEW_COLOR, closed: false } : {};
    // Handles only while editing a placed rope: there a press near one drags it (handleSlop); while
    // building, a tap near a picked spot must stay a tap
    return { preview, handles, spotsAt: ropeSpotsNearPoint, handleSlop: Boolean(session.editId) };
  }, [session, shown, handles]);

  const finish = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    if (!s.picks.length) {
      setFeedback({ message: 'Tap where the rope’s first end goes.', isError: true });
      return;
    }
    const p = routeOf(s.picks, s);
    const data = await runAction('place_rope', p);
    if (data?.ok) setSession(null);
    else if (data?.error) setFeedback({ message: data.error, isError: true });
  }, [routeOf, runAction, setFeedback]);

  const onHover = useCallback((hover) => {
    setSession((s) => (s && !sameSpot(s.hover, hover) ? { ...s, hover } : s));
  }, []);

  const onPick = useCallback((spot) => {
    const s = sessionRef.current;
    if (!s || locked) return;
    const inst = byId.get(spot.instanceId);
    const part = inst ? catalogMap.get(inst.partId) : null;
    if (!s.picks.length && !endPlaces(part).some((e) => e.feature === spot.feature)) {
      setFeedback({ message: 'A rope’s end goes on a pin, a standoff, a shaft or in a spool. Tap one of those first.', isError: true });
      return;
    }
    if (sameSpot(spot, s.picks.at(-1))) return;
    // Where a pulley or post was tapped, from its centre: the side the rope takes round it
    let side = null;
    if (s.picks.length && Array.isArray(spot.point) && (spot.kind === 'groove' || spot.kind === 'post')) {
      const place = placeOf(spot);
      if (place) {
        const out = v3(spot.point).sub(place.center);
        out.addScaledVector(place.axis, -out.dot(place.axis));
        // (a tap near its middle says nothing about the side: the tight side is used)
        if (out.length() > 0.4 * (place.radius || 3)) side = out.normalize().toArray().map((x) => Number(x.toFixed(4)));
      }
    }
    const entry = { instanceId: spot.instanceId, feature: spot.feature, kind: spot.kind, wraps: 1, ...(Number.isFinite(spot.height) ? { height: spot.height } : {}), ...(side ? { side } : {}) };
    // Editing a placed rope: a tapped spot goes in just before the far end; with the far end hanging
    // free, a tapped post or spool becomes that end
    const hasFar = s.editId && s.picks.length >= 2 && isEndKind(s.picks.at(-1).kind) && !s.freeEnd;
    if (s.editId && s.picks.some((p) => sameSpot(p, spot))) return;
    const picks = hasFar ? [...s.picks.slice(0, -1), entry, s.picks.at(-1)] : [...s.picks, entry];
    const next = { ...s, picks, hover: null, freeEnd: hasFar ? false : s.editId ? !isEndKind(spot.kind) : false };
    if (s.editId) {
      setSession(next);
      sessionRef.current = next;
      finish();
      return;
    }
    setSession(next);
    sessionRef.current = next;
    // A spool tapped after the first end: its pocket is the second end, and the rope is done
    if (s.picks.length >= 1 && spot.kind === 'pocket') finish();
  }, [byId, catalogMap, finish, locked, placeOf, setFeedback]);

  /**
   * A handle dragged (the view calls this on the drop): onto another place, that end or spot moves
   * there; off into the open, a spot comes off the route and an end comes off its post and hangs free.
   * While editing a placed rope, the drop routes it again.
   */
  const onHandle = useCallback((index, spot, { done }) => {
    const s = sessionRef.current;
    if (!s || locked || !done || index >= s.picks.length) return;
    const n = s.picks.length;
    const farEnd = n >= 2 && index === n - 1 && isEndKind(s.picks[index].kind) && !s.freeEnd;
    const isEnd = index === 0 || farEnd;
    let picks = s.picks;
    let freeEnd = Boolean(s.freeEnd);
    if (spot) {
      const inst = byId.get(spot.instanceId);
      const part = inst ? catalogMap.get(inst.partId) : null;
      const kind = spot.kind || (spot.feature === 'pocket' ? 'pocket' : spotByFeature(part, spot.feature)?.kind);
      if (sameSpot(spot, s.picks[index])) return;
      if (isEnd && !endPlaces(part).some((e) => e.feature === spot.feature)) {
        setFeedback({ message: 'A rope’s end goes on a pin, a standoff, a shaft or in a spool.', isError: true });
        return;
      }
      if (!isEnd && kind === 'pocket') {
        setFeedback({ message: 'Only a rope’s end goes in a spool’s pocket.', isError: true });
        return;
      }
      picks = picks.map((p, k) => (k === index ? { instanceId: spot.instanceId, feature: spot.feature, kind, wraps: isEnd ? 1 : p.wraps || 1, ...(Number.isFinite(spot.height) ? { height: spot.height } : {}) } : p));
    } else if (!isEnd) {
      picks = picks.filter((_, k) => k !== index);
    } else if (farEnd) {
      picks = picks.slice(0, -1);
      freeEnd = true;
    } else if (n >= 2 && isEndKind(s.picks[n - 1].kind) && !s.freeEnd) {
      // The first end comes off: the rope now starts at its other end, and this end hangs free
      picks = picks.slice(1).reverse().map((p) => (p.turn ? { ...p, turn: -p.turn } : p));
      freeEnd = true;
    } else {
      setFeedback({ message: 'A rope needs one end held: move this end to another post or spool instead.', isError: true });
      return;
    }
    const next = { ...s, picks, freeEnd, hover: null };
    setSession(next);
    sessionRef.current = next;
    if (s.editId) finish();
  }, [byId, catalogMap, finish, locked, setFeedback]);

  // The panel's controls
  const undoLast = useCallback(() => setSession((s) => (s && s.picks.length ? { ...s, picks: s.picks.slice(0, -1) } : s)), []);
  const setSize = useCallback((size) => setSession((s) => (s ? { ...s, size, turns: null } : s)), []);
  const flipSide = useCallback((i) => {
    setSession((s) => {
      if (!s) return s;
      // The engine's turn for that spot (the side a tight rope presses on), the other way
      const viaIndex = s.picks.length >= 2 && isEndKind(s.picks.at(-1).kind) ? i - 1 : i - 1;
      const now = shown?.via?.[viaIndex]?.turn || s.picks[i].turn || 1;
      return { ...s, picks: s.picks.map((p, k) => (k === i ? { ...p, turn: -now } : p)) };
    });
  }, [shown]);
  const setWraps = useCallback((i, wraps) => setSession((s) => (s ? { ...s, picks: s.picks.map((p, k) => (k === i ? { ...p, wraps } : p)) } : s)), []);
  const stepTurns = useCallback((d) => {
    setSession((s) => {
      if (!s) return s;
      const now = s.turns ?? shown?.turns ?? 0;
      const max = shown?.turnsMax ?? now;
      return { ...s, turns: Math.max(0, Math.min(max, Math.round((now + d) * 4) / 4)) };
    });
  }, [shown]);
  const flipWinding = useCallback(() => setSession((s) => (s ? { ...s, winding: -s.winding } : s)), []);
  /** Next / Back: the next spot near the lit one, as R and Shift+R do (for touch). */
  const stepLit = useCallback((dir) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', shiftKey: dir < 0, bubbles: true }));
  }, []);

  // Keys: Enter finishes, Backspace takes off the last, Esc cancels
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
        undoLast();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [Boolean(session), finish, undoLast]);

  const pickLabel = useCallback((p) => {
    const inst = byId.get(p.instanceId);
    const kindName = p.kind === 'pocket' ? 'spool pocket' : p.kind === 'groove' ? 'pulley' : p.kind === 'edge' ? 'edge' : p.kind === 'post' ? 'post' : p.kind;
    return { part: inst?.label || p.instanceId, spot: kindName };
  }, [byId]);

  /** Rope between these: two selected parts, at least one able to hold an end. */
  const selected = useMemo(() => selectedIds.map((id) => byId.get(id)).filter((i) => i && i.visible !== false), [selectedIds, byId]);
  const betweenCheck = useMemo(() => {
    if (selected.length !== 2) return { ok: false, error: 'Select the two parts the rope goes between.' };
    const placesOf = (inst) => endPlaces(catalogMap.get(inst.partId));
    if (!selected.some((i) => placesOf(i).length)) return { ok: false, error: 'Neither part can hold a rope’s end.' };
    const pick = (inst, other) => {
      const places = placesOf(inst);
      if (!places.length) return null;
      const pocket = places.find((p) => p.kind === 'pocket');
      if (pocket) return pocket;
      const m = instanceMatrix(inst);
      const to = v3(other.position);
      return places.map((p) => ({ p, d: v3(p.center).applyMatrix4(m).distanceTo(to) })).sort((a, b) => a.d - b.d)[0].p;
    };
    const [a, b] = selected;
    const pa = pick(a, b);
    const pb = pick(b, a);
    if (!pa || !pb) return { ok: false, error: 'Both parts need a pin, standoff, shaft or spool for the rope’s ends.' };
    return { ok: true, from: { instanceId: a.instanceId, feature: pa.feature }, to: { instanceId: b.instanceId, feature: pb.feature } };
  }, [selected, catalogMap]);
  const placeBetween = useCallback(async () => {
    if (!betweenCheck.ok) return setFeedback({ message: betweenCheck.error, isError: true });
    const pocketSecond = betweenCheck.to.feature === 'pocket' && betweenCheck.from.feature !== 'pocket';
    const [from, to] = pocketSecond ? [betweenCheck.to, betweenCheck.from] : [betweenCheck.from, betweenCheck.to];
    const data = await runAction('place_rope', { from, to });
    if (!data?.ok && data?.error) setFeedback({ message: data.error, isError: true });
    return data;
  }, [betweenCheck, runAction, setFeedback]);

  const hasSpool = Boolean(session && (session.picks[0]?.kind === 'pocket' || (session.picks.length >= 2 && session.picks.at(-1).kind === 'pocket')));
  return {
    session,
    open,
    close,
    sizes,
    viewportRope,
    onHover,
    onPick,
    onHandle,
    editRope,
    finish,
    undoLast,
    setSize,
    flipSide,
    setWraps,
    stepTurns,
    flipWinding,
    stepLit,
    pickLabel,
    hasSpool,
    betweenCheck,
    placeBetween,
    engine: shown
  };
}
