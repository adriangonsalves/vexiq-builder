/**
 * The app's smart actions (Inspector, menus, shortcuts), shared by the dev bridge
 * (/api/assembly/action) and the browser's engine worker. Each returns the reply the app reads:
 * `{ ok, message?, state?, error?, ... }`. Nothing is saved or recorded here: when the action
 * changed the build, the result carries `record: true` (and `stepLabel` when the step has its own
 * wording), and the caller records `state` as one history step.
 */
import {
  auditAssembly,
  buildChain,
  buildMeshedGearTrain,
  checkCandidateCollision,
  computeMateTransform,
  findMatchingPinHoles,
  findPart,
  generateOrthographicViews,
  getCatalog,
  jointGraph,
  mirrorSubassembly
} from './core.js';
import { fitSet, fixAssembly } from './fixAssembly.js';

export const ACTIONS = ['auto_fasten', 'mate_parts', 'mesh_gear_train', 'build_chain', 'mirror_subassembly', 'joint_graph', 'audit_and_blueprint', 'fix_assembly', 'fit_set'];

export function runAction(action, state, params = {}) {
  const { catalogById } = getCatalog();

  if (action === 'auto_fasten') {
    const instA = state.instances.find((i) => i.instanceId === params.instanceIdA);
    if (!instA) return { ok: false, error: 'Selected part not found.' };

    // Support fastening against one specific part or ALL compatible touching parts
    const targetCandidates = params.instanceIdB && params.instanceIdB !== 'ALL'
      ? state.instances.filter((i) => i.instanceId === params.instanceIdB)
      : state.instances.filter((i) => {
          if (i.instanceId === instA.instanceId || i.visible === false) return false;
          const p = catalogById.get(i.partId);
          return p && p.category !== 'Pins & Standoffs';
        });

    const maxPins = Math.max(1, Number(params.maxPins) || 12);
    const placedPins = [];
    const nextInstances = [...state.instances];

    for (const instB of targetCandidates) {
      if (placedPins.length >= maxPins) break;
      const matches = findMatchingPinHoles(instA, instB);

      for (const m of matches) {
        if (placedPins.length >= maxPins) break;
        const pinPart =
          findPart(params.pinPartNumber || m.recommendedPinPartNumber) ||
          findPart('228-2500-060');
        if (!pinPart) continue;

        const baseRot = m.worldRotation;
        const flippedRot = [baseRot[0], (baseRot[1] + 180) % 360, baseRot[2]];
        let chosenCandidate = null;

        for (const rotCandidate of [baseRot, flippedRot]) {
          const candidate = {
            instanceId: `inst-pin-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            partId: pinPart.id,
            label: `Auto ${pinPart.name} (${instA.label} ↔ ${instB.label})`,
            position: m.worldPosition,
            rotation: rotCandidate,
            lastValidPosition: m.worldPosition,
            lastValidRotation: rotCandidate,
            isIntersecting: false,
            color: params.color || '#0284c7',
            visible: true,
            locked: false
          };
          const col = checkCandidateCollision(candidate, nextInstances);
          if (!col.isIntersecting) {
            chosenCandidate = candidate;
            break;
          }
        }

        if (chosenCandidate) {
          nextInstances.push(chosenCandidate);
          placedPins.push(chosenCandidate);
        }
      }
    }

    const nextState = {
      ...state,
      selectedId:
        placedPins.length > 0
          ? placedPins[placedPins.length - 1].instanceId
          : state.selectedId,
      instances: nextInstances,
      updatedAt: new Date().toISOString()
    };

    return {
      ok: true,
      pinsPlacedCount: placedPins.length,
      placedPins,
      state: nextState,
      record: placedPins.length > 0,
      message:
        placedPins.length > 0
          ? `Inserted ${placedPins.length} collision-verified connector pin(s).`
          : 'No unoccupied coaxial pin hole pairs found (or holes are already pinned).'
    };
  }

  if (action === 'mate_parts') {
    const targetInst = state.instances.find((i) => i.instanceId === params.targetInstanceId);
    const existingInst = state.instances.find((i) => i.instanceId === params.sourceInstanceId);
    if (!targetInst || !existingInst) return { ok: false, error: 'Source or target part instance not found.' };

    const sourcePart = catalogById.get(existingInst.partId);
    const mate = computeMateTransform(
      sourcePart,
      params.sourcePortId,
      targetInst,
      params.targetPortId,
      {
        flipAxis: Boolean(params.flipAxis),
        rollDeg: Number(params.rollDeg) || 0,
        axialOffsetMm: Number(params.axialOffsetMm) || 0
      }
    );
    if (mate.error) return { ok: false, error: mate.error };

    const updated = {
      ...existingInst,
      position: mate.position,
      rotation: mate.rotation
    };
    const col = checkCandidateCollision(updated, state.instances);
    updated.isIntersecting = col.isIntersecting;
    if (!col.isIntersecting) {
      updated.lastValidPosition = [...mate.position];
      updated.lastValidRotation = [...mate.rotation];
    }

    const nextInstances = state.instances.map((i) => (i.instanceId === updated.instanceId ? updated : i));
    const nextState = {
      ...state,
      selectedId: updated.instanceId,
      instances: nextInstances,
      updatedAt: new Date().toISOString()
    };

    return {
      ok: true,
      isIntersecting: col.isIntersecting,
      collidingWith: col.collidingWith,
      instance: updated,
      state: nextState,
      record: true,
      message: col.isIntersecting
        ? `Mated ${updated.label} to ${targetInst.label} (warning: intersects ${col.collidingWith.map((c) => c.label).join(', ')}; try flipping axis or adjusting offset).`
        : `Mated ${updated.label} (${mate.sourcePort.portId}) → ${targetInst.label} (${mate.targetPort.portId}) cleanly.`
    };
  }

  if (action === 'mesh_gear_train') {
    const gearRes = buildMeshedGearTrain(state, {
      supportBeamId: params.supportBeamId,
      outerSupportBeamId: params.outerSupportBeamId || null,
      startPortId: params.startPortId,
      gears: params.gears || ['228-2500-214', '228-2500-214', '228-2500-214'],
      shaftPartQuery: params.shaftPartQuery || null,
      axialOffsetMm:
        params.axialOffsetMm !== undefined && params.axialOffsetMm !== ''
          ? Number(params.axialOffsetMm)
          : null,
      reverseDirection: Boolean(params.reverseDirection)
    });
    if (gearRes.error) return { ok: false, error: gearRes.error };

    const nextState = {
      ...state,
      selectedId:
        gearRes.placedGears.length > 0
          ? gearRes.placedGears[gearRes.placedGears.length - 1].instance.instanceId
          : state.selectedId,
      instances: gearRes.workingInstances,
      updatedAt: new Date().toISOString()
    };

    return {
      ok: true,
      gearsPlacedCount: gearRes.placedGears.length,
      shaftsPlacedCount: gearRes.placedShafts.length,
      state: nextState,
      record: true,
      message: `Placed ${gearRes.placedGears.length} meshed gears and ${gearRes.placedShafts.length} shafts.`
    };
  }

  if (action === 'build_chain') {
    // Chain or track builder (openspec chain-track-builder): one step labeled with what was built
    const built = buildChain(state, {
      kind: params.kind,
      instanceIds: Array.isArray(params.instanceIds) ? params.instanceIds : null,
      route: params.route && typeof params.route === 'object' ? params.route : null,
      grippers: params.grippers !== false,
      attachment: params.attachment ?? null,
      attachmentEvery: params.attachmentEvery ?? 1,
      slack: params.slack === 'upper' ? 'upper' : 'lower',
      name: params.name || null
    });
    if (built.error) {
      return { ok: false, error: built.error, ...(built.needsRoute ? { needsRoute: built.needsRoute } : {}) };
    }
    const nextState = {
      ...state,
      instances: built.instances,
      selectedIds: built.newIds,
      selectedId: built.newIds.at(-1),
      updatedAt: new Date().toISOString()
    };
    return {
      ok: true,
      state: nextState,
      groupId: built.groupId,
      name: built.name,
      message: built.message,
      record: true,
      stepLabel: built.message.split('. ')[0]
    };
  }

  if (action === 'mirror_subassembly') {
    const mirRes = mirrorSubassembly(state, {
      instanceIds: Array.isArray(params.instanceIds) ? params.instanceIds : [],
      mirrorPlane: params.mirrorPlane || 'Z',
      planeOffsetMm: Number(params.planeOffsetMm) || 0
    });

    const nextState = {
      ...state,
      selectedId:
        mirRes.mirroredInstances.length > 0
          ? mirRes.mirroredInstances[mirRes.mirroredInstances.length - 1].instanceId
          : state.selectedId,
      instances: mirRes.workingInstances,
      updatedAt: new Date().toISOString()
    };

    return {
      ok: true,
      mirroredCount: mirRes.mirroredCount,
      state: nextState,
      record: mirRes.mirroredCount > 0,
      message: `Mirrored ${mirRes.mirroredCount} part(s) across ${params.mirrorPlane || 'Z'} = ${Number(params.planeOffsetMm) || 0}mm.`
    };
  }

  // The joints between parts, for Select Connected and expanding the selection (openspec outliner-part-groups)
  if (action === 'joint_graph') {
    return { ok: true, graph: jointGraph(state, { pinnedOnly: Boolean(params.pinnedOnly) }) };
  }

  // The audit and the blueprint picture (`ortho.svg`)
  if (action === 'fix_assembly') {
    return fixAssembly(state, { instanceId: params.instanceId || state.selectedId });
  }

  // A dragged set's release fit (openspec group-snapping): the fitted poses, nothing saved
  if (action === 'fit_set') {
    return fitSet(state, { ids: params.ids, poses: params.poses });
  }

  if (action === 'audit_and_blueprint') {
    return { ok: true, audit: auditAssembly(state), ortho: generateOrthographicViews(state) };
  }

  return { ok: false, error: `Unknown action: ${action}`, unknownAction: true };
}
