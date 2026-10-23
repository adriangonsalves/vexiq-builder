#!/usr/bin/env node
import * as THREE from 'three';
import {
  VEX_PITCH_MM,
  auditAssembly,
  buildDefaultStarterState,
  buildMeshedGearTrain,
  buildWorldMatrix,
  checkCandidateCollision,
  computeMateTransform,
  findMatchingPinHoles,
  findPart,
  generateOrthographicViews,
  getCatalog,
  mirrorSubassembly,
  readAssemblyState,
  writeAssemblyState
} from './assembly-engine.mjs';

const TOOLS = [
  {
    name: 'search_parts',
    description:
      'Search the 467 VEX IQ CAD parts by name, part number (e.g. 228-2500-025), or category.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search keyword or VEX part number (e.g. "2x10 Beam", "Pin", "228-2500-086").'
        },
        category: {
          type: 'string',
          description:
            'Optional category filter (e.g. "Beams & Plates", "Pins & Standoffs", "Gears, Sprockets & Pulleys", "Shafts, Spacers & Collars", "Wheels & Treads", "Connectors & Brackets", "Electronics & Motion", "Specialty & Panels").'
        },
        limit: {
          type: 'number',
          default: 20,
          description: 'Maximum number of matching parts to return.'
        }
      }
    }
  },
  {
    name: 'get_part_details',
    description:
      'Get full CAD geometry metadata for a VEX IQ part, including bounding box (mm and VEX Pitch) and extracted cylindrical hole/pin axes.',
    inputSchema: {
      type: 'object',
      properties: {
        partQuery: {
          type: 'string',
          description: 'Part ID, part number (e.g. "228-2500-025"), or exact part name.'
        }
      },
      required: ['partQuery']
    }
  },
  {
    name: 'get_assembly',
    description:
      'Retrieve the current 3D assembly state, including all placed part instances, their millimeter and VEX Pitch coordinates, rotations, colors, and collision status.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'place_part',
    description:
      'Place a VEX IQ part into the 3D workspace. Checks exact concave MeshBVH collision (allowing pins/axles through holes while detecting solid overlaps).',
    inputSchema: {
      type: 'object',
      properties: {
        partQuery: {
          type: 'string',
          description: 'Part number (e.g. "228-2500-025"), part ID, or part name to place.'
        },
        position: {
          type: 'array',
          items: { type: 'number' },
          minItems: 3,
          maxItems: 3,
          description: 'World [x, y, z] position in millimeters (1 VEX Pitch = 12.7 mm).'
        },
        pitchPosition: {
          type: 'array',
          items: { type: 'number' },
          minItems: 3,
          maxItems: 3,
          description:
            'Optional world [px, py, pz] position in VEX Pitch units (automatically multiplied by 12.7 mm if position is omitted).'
        },
        rotation: {
          type: 'array',
          items: { type: 'number' },
          minItems: 3,
          maxItems: 3,
          default: [0, 0, 0],
          description: 'Euler [rx, ry, rz] rotation in degrees.'
        },
        color: {
          type: 'string',
          description: 'Optional hex color override (e.g. "#2563eb").'
        },
        label: {
          type: 'string',
          description: 'Optional custom display label in the Assembly Outliner.'
        },
        previewIfIntersecting: {
          type: 'boolean',
          default: true,
          description:
            'If true and the part intersects another part, shows it as transparent grey (unplaced preview) in the 3D viewport; if false, rejects placement without adding to the scene.'
        }
      },
      required: ['partQuery']
    }
  },
  {
    name: 'update_part',
    description:
      'Move, rotate, recolor, lock/unlock, or show/hide an existing part instance in the 3D assembly.',
    inputSchema: {
      type: 'object',
      properties: {
        instanceId: {
          type: 'string',
          description: 'The instanceId of the placed part to modify.'
        },
        position: {
          type: 'array',
          items: { type: 'number' },
          minItems: 3,
          maxItems: 3,
          description: 'New [x, y, z] position in millimeters.'
        },
        pitchPosition: {
          type: 'array',
          items: { type: 'number' },
          minItems: 3,
          maxItems: 3,
          description: 'Optional new [px, py, pz] position in VEX Pitch units (1P = 12.7 mm).'
        },
        rotation: {
          type: 'array',
          items: { type: 'number' },
          minItems: 3,
          maxItems: 3,
          description: 'New [rx, ry, rz] Euler rotation in degrees.'
        },
        color: {
          type: 'string',
          description: 'New hex color string.'
        },
        label: {
          type: 'string',
          description: 'New display label.'
        },
        visible: {
          type: 'boolean',
          description: 'Whether the part is visible in the 3D viewport.'
        },
        locked: {
          type: 'boolean',
          description: 'Whether the part is locked from gizmo dragging.'
        }
      },
      required: ['instanceId']
    }
  },
  {
    name: 'align_part_to_hole',
    description:
      'Place a new part or move an existing part so it aligns coaxially with a specific cylindrical hole/pin axis on a target placed part.',
    inputSchema: {
      type: 'object',
      properties: {
        targetInstanceId: {
          type: 'string',
          description: 'The instanceId of the existing part whose hole/axis to align to.'
        },
        holeIndex: {
          type: 'number',
          default: 0,
          description: 'Index of the cylindrical hole in target part cylinders array (0-based).'
        },
        axialOffsetMm: {
          type: 'number',
          default: 0,
          description: 'Offset in millimeters along the hole axis direction.'
        },
        partQuery: {
          type: 'string',
          description: 'If placing a new part, the part number or name (e.g. "0x2 Connector Pin").'
        },
        instanceId: {
          type: 'string',
          description: 'If moving an existing part instance, its instanceId.'
        },
        rotation: {
          type: 'array',
          items: { type: 'number' },
          minItems: 3,
          maxItems: 3,
          description: 'Optional [rx, ry, rz] rotation in degrees.'
        },
        color: {
          type: 'string',
          description: 'Optional hex color.'
        }
      },
      required: ['targetInstanceId']
    }
  },
  {
    name: 'remove_part',
    description: 'Remove a part instance from the 3D assembly by its instanceId.',
    inputSchema: {
      type: 'object',
      properties: {
        instanceId: {
          type: 'string',
          description: 'The instanceId to remove.'
        }
      },
      required: ['instanceId']
    }
  },
  {
    name: 'clear_assembly',
    description: 'Clear all parts from the 3D workspace or reset to the starter VEX IQ assembly.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['empty', 'starter'],
          default: 'empty',
          description: 'Use "empty" to remove all parts, or "starter" to load the sample starter assembly.'
        }
      }
    }
  },
  {
    name: 'configure_viewport',
    description:
      'Configure the 3D viewport controls, selection, VEX Pitch snap settings, hole-axis overlay, and camera focus.',
    inputSchema: {
      type: 'object',
      properties: {
        selectedId: {
          type: ['string', 'null'],
          description: 'Instance ID to select in the 3D viewport (or null to deselect).'
        },
        transformMode: {
          type: 'string',
          enum: ['translate', 'rotate'],
          description: 'Active gizmo mode.'
        },
        snapPitchFactor: {
          type: 'number',
          description: 'Pitch grid snap factor (1 = 12.7mm, 0.5 = 6.35mm, 0.25 = 3.175mm, 0 = Free).'
        },
        rotationSnapDeg: {
          type: 'number',
          description: 'Rotation snap angle in degrees (15, 45, 90, or 0 for free).'
        },
        showGrid: {
          type: 'boolean',
          description: 'Whether to display the VEX 12.7mm Pitch Grid.'
        },
        showConnectors: {
          type: 'boolean',
          description: 'Whether to display the analytic hole/pin axis markers on the selected part.'
        },
        explodeMode: {
          type: 'string',
          enum: ['off', 'x', 'y', 'z', 'all'],
          description: 'Explode assembly view along X, Y, Z, All axes, or off.'
        },
        focusCamera: {
          type: 'boolean',
          description: 'If true, triggers the 3D camera to frame the selected part or entire assembly.'
        }
      }
    }
  },
  {
    name: 'auto_fasten_joint',
    description:
      'Automatically finds all coaxial, adjacent pin_hole pairs between two placed part instances (instanceIdA and instanceIdB) using the 478-part semantic port metadata and inserts collision-verified 1x1 or 1x2 Connector Pins.',
    inputSchema: {
      type: 'object',
      properties: {
        instanceIdA: {
          type: 'string',
          description: 'First placed part instanceId.'
        },
        instanceIdB: {
          type: 'string',
          description: 'Second placed part instanceId.'
        },
        maxPins: {
          type: 'number',
          default: 8,
          description: 'Maximum number of connector pins to insert across matching hole pairs.'
        },
        color: {
          type: 'string',
          default: '#0284c7',
          description: 'Optional hex color for placed connector pins.'
        }
      },
      required: ['instanceIdA', 'instanceIdB']
    }
  },
  {
    name: 'audit_assembly',
    description:
      'Run a 6-stage mechanical & kinematic audit of the current 3D assembly: (1) MeshBVH solid intersections, (2) floating/unconnected fasteners, (3) unsecured parts, single-pin pivot warnings, and heavy component fastener counts, (4) full mechanical connectivity graph & disconnected island detection, (5) shaft protrusion/overhang check, and (6) kinematic power tracing from Smart Motors through shafts and meshing gears to wheels.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'mate_parts',
    description:
      'Declaratively mate a new part (by partQuery) or an existing placed instance (by sourceInstanceId) so that its semantic port (sourcePortId) is coaxial and aligned with targetPortId on targetInstanceId.',
    inputSchema: {
      type: 'object',
      properties: {
        partQuery: {
          type: 'string',
          description:
            'If placing a new part, the part number (e.g. "228-2560"), part ID, or part name.'
        },
        sourceInstanceId: {
          type: 'string',
          description: 'If moving an existing placed instance, its instanceId.'
        },
        sourcePortId: {
          type: 'string',
          description:
            'Optional semantic portId on the source part (e.g. "motor_drive_socket", "hole_1", "bore_1", "peg_1"). Defaults to the primary bore/socket/peg.'
        },
        targetInstanceId: {
          type: 'string',
          description: 'The instanceId of the target part already in the assembly.'
        },
        targetPortId: {
          type: 'string',
          description:
            'The semantic portId on the target part (e.g. "hole_12", "motor_drive_socket", "bore_1").'
        },
        flipAxis: {
          type: 'boolean',
          default: false,
          description:
            'If true, flips the source port axis 180 degrees relative to the target port axis.'
        },
        rollDeg: {
          type: 'number',
          default: 0,
          description: 'Rotation angle in degrees around the mated port axis.'
        },
        axialOffsetMm: {
          type: 'number',
          default: 0,
          description: 'Offset in millimeters along the target port axis.'
        },
        label: {
          type: 'string',
          description: 'Optional custom label if placing a new part.'
        },
        color: {
          type: 'string',
          description: 'Optional hex color if placing or updating a part.'
        }
      },
      required: ['targetInstanceId', 'targetPortId']
    }
  },
  {
    name: 'mesh_gear_train',
    description:
      'Declaratively build a meshed gear train along a supporting beam (supportBeamId) starting at startPortId. Automatically spaces gears by their exact pitch radii (N1+N2)/24 * 12.7mm, alternates tooth-phase angles (phaseOffsetDeg) so gear teeth never collide, and optionally inserts flush shafts through each gear.',
    inputSchema: {
      type: 'object',
      properties: {
        supportBeamId: {
          type: 'string',
          description: 'The instanceId of the beam supporting the gear train.'
        },
        outerSupportBeamId: {
          type: 'string',
          description:
            'Optional instanceId of a parallel outer beam to center the gears between and seat capped shafts flush against.'
        },
        startPortId: {
          type: 'string',
          description: 'The starting pin_hole portId on supportBeamId for the first gear.'
        },
        gears: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          description:
            'Ordered list of gear part numbers or names to mesh in sequence (e.g. ["228-2500-214", "228-2500-214", "228-2500-214"] for three 36T gears).'
        },
        shaftPartQuery: {
          type: 'string',
          description:
            'Optional shaft part number or name to insert coaxially through each gear (e.g. "228-2500-2221" for 3x Pitch Capped Shaft).'
        },
        axialOffsetMm: {
          type: 'number',
          description:
            'Optional explicit axial offset in mm from supportBeamId port origin to gear center plane.'
        },
        reverseDirection: {
          type: 'boolean',
          default: false,
          description: 'If true, steps along the beam in the opposite direction from startPortId.'
        }
      },
      required: ['supportBeamId', 'startPortId', 'gears']
    }
  },
  {
    name: 'mirror_subassembly',
    description:
      'Mirror a list of placed part instances across the X, Y, or Z symmetry plane. Automatically compensates for asymmetric VEX IQ parts (Capped Shafts, Standoffs, 1x2 Pins, Smart Motors) and verifies each mirrored instance with MeshBVH.',
    inputSchema: {
      type: 'object',
      properties: {
        instanceIds: {
          type: 'array',
          items: { type: 'string' },
          description:
            'List of instanceIds to mirror. If omitted or empty, mirrors all instances on one side of the mirror plane.'
        },
        mirrorPlane: {
          type: 'string',
          enum: ['X', 'Y', 'Z'],
          default: 'Z',
          description: 'Symmetry plane axis ("Z" for Left/Right, "X" for Front/Rear, "Y" for Top/Bottom).'
        },
        planeOffsetMm: {
          type: 'number',
          default: 0,
          description: 'Coordinate of the symmetry plane in millimeters (default 0).'
        }
      }
    }
  },
  {
    name: 'capture_viewport_views',
    description:
      'Generate a 3-view Orthographic Engineering Blueprint SVG (Top XZ, Side XY, Front ZY) at public/assembly-blueprint.svg and return overall envelope dimensions, ground clearance, left/right symmetry verification, and 6-stage mechanical audit telemetry.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  }
];

async function executeTool(name, args = {}) {
  const { catalog, catalogById } = getCatalog();

  if (name === 'search_parts') {
    const q = (args.query || '').trim().toLowerCase();
    const catFilter = (args.category || '').trim().toLowerCase();
    const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);

    const matches = catalog.filter((p) => {
      if (catFilter && p.category.toLowerCase() !== catFilter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.partNumber.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      );
    });

    return {
      totalMatches: matches.length,
      parts: matches.slice(0, limit).map((p) => ({
        id: p.id,
        name: p.name,
        partNumber: p.partNumber,
        category: p.category,
        defaultColor: p.defaultColor,
        sizeMm: p.bbox.size,
        pitchSize: p.pitchSize || p.bbox.size.map((d) => Number((d / VEX_PITCH_MM).toFixed(2))),
        originType: p.originType || 'centered',
        portCounts: p.portCounts || { total: p.connectorCount },
        gearSpecs: p.gearSpecs || null,
        fastenerSpecs: p.fastenerSpecs || null,
        mountingRules: p.mountingRules || null
      }))
    };
  }

  if (name === 'get_part_details') {
    const part = findPart(args.partQuery);
    if (!part) {
      return { isError: true, error: `Part not found for query: "${args.partQuery}"` };
    }
    return {
      id: part.id,
      name: part.name,
      partNumber: part.partNumber,
      category: part.category,
      defaultColor: part.defaultColor,
      bbox: part.bbox,
      pitchSize: part.pitchSize || part.bbox.size.map((d) => Number((d / VEX_PITCH_MM).toFixed(2))),
      originType: part.originType || 'centered',
      gearSpecs: part.gearSpecs || null,
      fastenerSpecs: part.fastenerSpecs || null,
      mountingRules: part.mountingRules || null,
      portCounts: part.portCounts || { total: part.ports?.length || 0 },
      ports: part.ports || [],
      vertexCount: part.vertexCount,
      triangleCount: part.triangleCount,
      connectorCount: part.connectorCount,
      cylinders: part.cylinders
    };
  }

  if (name === 'get_assembly') {
    const state = readAssemblyState();
    return {
      updatedAt: state.updatedAt,
      selectedId: state.selectedId,
      viewport: state.viewport,
      instanceCount: state.instances.length,
      instances: state.instances.map((inst) => {
        const part = catalogById.get(inst.partId);
        return {
          ...inst,
          partName: part?.name || inst.partId,
          partNumber: part?.partNumber || 'UNKNOWN',
          pitchPosition: inst.position.map((c) => Number((c / VEX_PITCH_MM).toFixed(2)))
        };
      })
    };
  }

  if (name === 'place_part') {
    const part = findPart(args.partQuery);
    if (!part) {
      return { isError: true, error: `Part not found for query: "${args.partQuery}"` };
    }

    const state = readAssemblyState();
    let position = [0, VEX_PITCH_MM, 0];
    if (Array.isArray(args.position) && args.position.length === 3) {
      position = args.position.map((n) => Number(Number(n).toFixed(3)));
    } else if (Array.isArray(args.pitchPosition) && args.pitchPosition.length === 3) {
      position = args.pitchPosition.map((p) => Number((Number(p) * VEX_PITCH_MM).toFixed(3)));
    }

    const rotation =
      Array.isArray(args.rotation) && args.rotation.length === 3
        ? args.rotation.map((r) => Number(Number(r).toFixed(2)))
        : [0, 0, 0];

    const sameCount = state.instances.filter((i) => i.partId === part.id).length;
    const instanceId = `inst-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const candidate = {
      instanceId,
      partId: part.id,
      label: args.label || `${part.name} #${sameCount + 1}`,
      position,
      rotation,
      color: args.color || part.defaultColor,
      visible: true,
      locked: false
    };

    const { isIntersecting, collidingWith } = checkCandidateCollision(candidate, state.instances);
    candidate.isIntersecting = isIntersecting;
    candidate.lastValidPosition = isIntersecting ? null : [...position];
    candidate.lastValidRotation = isIntersecting ? null : [...rotation];

    if (isIntersecting && args.previewIfIntersecting === false) {
      return {
        ok: false,
        placed: false,
        isIntersecting: true,
        collidingWith,
        message:
          'Part intersects existing solid geometry and was not placed. Adjust coordinates or thread through an open hole.'
      };
    }

    const nextState = await writeAssemblyState({
      ...state,
      selectedId: instanceId,
      instances: [...state.instances, candidate]
    });

    return {
      ok: !isIntersecting,
      placed: !isIntersecting,
      status: isIntersecting ? 'intersecting_transparent_grey_preview' : 'placed_solid',
      isIntersecting,
      collidingWith,
      instance: candidate,
      totalInstances: nextState.instances.length,
      message: isIntersecting
        ? 'Part intersects solid geometry and is shown as transparent grey (unplaced preview) in the 3D viewport. Move it to clear space or through a hole to place it.'
        : `Successfully placed ${candidate.label} (${part.partNumber}) at [${position.join(', ')}] mm.`
    };
  }

  if (name === 'update_part') {
    const state = readAssemblyState();
    const target = state.instances.find((i) => i.instanceId === args.instanceId);
    if (!target) {
      return { isError: true, error: `Instance "${args.instanceId}" not found in assembly.` };
    }

    let position = [...target.position];
    if (Array.isArray(args.position) && args.position.length === 3) {
      position = args.position.map((n) => Number(Number(n).toFixed(3)));
    } else if (Array.isArray(args.pitchPosition) && args.pitchPosition.length === 3) {
      position = args.pitchPosition.map((p) => Number((Number(p) * VEX_PITCH_MM).toFixed(3)));
    }

    const rotation =
      Array.isArray(args.rotation) && args.rotation.length === 3
        ? args.rotation.map((r) => Number(Number(r).toFixed(2)))
        : [...target.rotation];

    const updated = {
      ...target,
      position,
      rotation,
      color: args.color !== undefined ? args.color : target.color,
      label: args.label !== undefined ? args.label : target.label,
      visible: args.visible !== undefined ? Boolean(args.visible) : target.visible,
      locked: args.locked !== undefined ? Boolean(args.locked) : target.locked
    };

    const { isIntersecting, collidingWith } = checkCandidateCollision(updated, state.instances);
    updated.isIntersecting = isIntersecting;
    if (!isIntersecting) {
      updated.lastValidPosition = [...position];
      updated.lastValidRotation = [...rotation];
    }

    const nextInstances = state.instances.map((i) =>
      i.instanceId === updated.instanceId ? updated : i
    );
    await writeAssemblyState({
      ...state,
      selectedId: updated.instanceId,
      instances: nextInstances
    });

    return {
      ok: !isIntersecting,
      status: isIntersecting ? 'intersecting_transparent_grey_preview' : 'placed_solid',
      isIntersecting,
      collidingWith,
      instance: updated
    };
  }

  if (name === 'align_part_to_hole') {
    const state = readAssemblyState();
    const targetInst = state.instances.find((i) => i.instanceId === args.targetInstanceId);
    if (!targetInst) {
      return {
        isError: true,
        error: `Target instance "${args.targetInstanceId}" not found in assembly.`
      };
    }
    const targetPart = catalogById.get(targetInst.partId);
    if (!targetPart || !targetPart.cylinders?.length) {
      return {
        isError: true,
        error: `Target part "${targetPart?.name || targetInst.partId}" has no extracted cylindrical holes.`
      };
    }

    const holeIdx = Math.min(
      Math.max(Number(args.holeIndex) || 0, 0),
      targetPart.cylinders.length - 1
    );
    const hole = targetPart.cylinders[holeIdx];
    const targetMatrix = buildWorldMatrix(targetInst.position, targetInst.rotation);
    const rotMatrix = new THREE.Matrix4().extractRotation(targetMatrix);

    const worldOrigin = new THREE.Vector3(...hole.origin).applyMatrix4(targetMatrix);
    const worldAxis = new THREE.Vector3(...hole.axis).applyMatrix4(rotMatrix).normalize();
    const offsetMm = Number(args.axialOffsetMm) || 0;
    worldOrigin.addScaledVector(worldAxis, offsetMm);

    const alignedPosition = [
      Number(worldOrigin.x.toFixed(3)),
      Number(worldOrigin.y.toFixed(3)),
      Number(worldOrigin.z.toFixed(3))
    ];
    const alignedRotation =
      Array.isArray(args.rotation) && args.rotation.length === 3
        ? args.rotation
        : [...targetInst.rotation];

    if (args.instanceId) {
      return await executeTool('update_part', {
        instanceId: args.instanceId,
        position: alignedPosition,
        rotation: alignedRotation,
        color: args.color
      });
    } else if (args.partQuery) {
      return await executeTool('place_part', {
        partQuery: args.partQuery,
        position: alignedPosition,
        rotation: alignedRotation,
        color: args.color
      });
    } else {
      return {
        isError: true,
        error: 'Provide either partQuery (to place a new part) or instanceId (to move an existing part).'
      };
    }
  }

  if (name === 'remove_part') {
    const state = readAssemblyState();
    const exists = state.instances.some((i) => i.instanceId === args.instanceId);
    if (!exists) {
      return { isError: true, error: `Instance "${args.instanceId}" not found.` };
    }
    const nextInstances = state.instances.filter((i) => i.instanceId !== args.instanceId);
    const nextSelected = state.selectedId === args.instanceId ? null : state.selectedId;
    await writeAssemblyState({
      ...state,
      selectedId: nextSelected,
      instances: nextInstances
    });
    return {
      ok: true,
      removedInstanceId: args.instanceId,
      remainingInstances: nextInstances.length
    };
  }

  if (name === 'clear_assembly') {
    const mode = args.mode || 'empty';
    if (mode === 'starter') {
      const starterState = buildDefaultStarterState();
      await writeAssemblyState(starterState);
      return {
        ok: true,
        mode: 'starter',
        instanceCount: starterState.instances.length,
        instances: starterState.instances
      };
    } else {
      const state = readAssemblyState();
      const emptyState = await writeAssemblyState({
        ...state,
        selectedId: null,
        instances: []
      });
      return {
        ok: true,
        mode: 'empty',
        instanceCount: emptyState.instances.length
      };
    }
  }

  if (name === 'configure_viewport') {
    const state = readAssemblyState();
    const prevVp = state.viewport || {};
    const nextViewport = {
      transformMode: args.transformMode ?? prevVp.transformMode ?? 'translate',
      snapPitchFactor:
        args.snapPitchFactor !== undefined ? Number(args.snapPitchFactor) : prevVp.snapPitchFactor ?? 0.5,
      rotationSnapDeg:
        args.rotationSnapDeg !== undefined ? Number(args.rotationSnapDeg) : prevVp.rotationSnapDeg ?? 15,
      showGrid: args.showGrid !== undefined ? Boolean(args.showGrid) : prevVp.showGrid ?? true,
      showConnectors:
        args.showConnectors !== undefined ? Boolean(args.showConnectors) : prevVp.showConnectors ?? true,
      explodeMode: args.explodeMode ?? prevVp.explodeMode ?? 'off',
      focusTrigger: args.focusCamera ? (prevVp.focusTrigger || 0) + 1 : prevVp.focusTrigger || 0
    };

    const nextSelectedId =
      args.selectedId !== undefined ? args.selectedId : state.selectedId;

    const updated = await writeAssemblyState({
      ...state,
      selectedId: nextSelectedId,
      viewport: nextViewport
    });

    return {
      ok: true,
      selectedId: updated.selectedId,
      viewport: updated.viewport
    };
  }

  if (name === 'auto_fasten_joint') {
    const state = readAssemblyState();
    const instA = state.instances.find((i) => i.instanceId === args.instanceIdA);
    const instB = state.instances.find((i) => i.instanceId === args.instanceIdB);
    if (!instA || !instB) {
      return {
        isError: true,
        error: `Could not find both instances: "${args.instanceIdA}" and "${args.instanceIdB}".`
      };
    }

    const matches = findMatchingPinHoles(instA, instB);
    const maxPins = Math.max(1, Number(args.maxPins) || 8);
    const placedPins = [];
    const nextInstances = [...state.instances];

    for (const m of matches) {
      if (placedPins.length >= maxPins) break;
      const pinPart = findPart(m.recommendedPinPartNumber) || findPart('228-2500-060');
      if (!pinPart) continue;

      // Try both forward and 180-flipped orientation (important for asymmetric 1x2 pins)
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
          color: args.color || '#0284c7',
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

    if (placedPins.length > 0) {
      await writeAssemblyState({
        ...state,
        selectedId: placedPins[placedPins.length - 1].instanceId,
        instances: nextInstances
      });
    }

    return {
      ok: true,
      matchedHolePairs: matches.length,
      pinsPlacedCount: placedPins.length,
      placedPins
    };
  }

  if (name === 'audit_assembly') {
    const state = readAssemblyState();
    return auditAssembly(state);
  }

  if (name === 'mate_parts') {
    const state = readAssemblyState();
    const targetInst = state.instances.find((i) => i.instanceId === args.targetInstanceId);
    if (!targetInst) {
      return {
        isError: true,
        error: `Target instance "${args.targetInstanceId}" not found in assembly.`
      };
    }

    let sourcePart = null;
    let existingInst = null;
    if (args.sourceInstanceId) {
      existingInst = state.instances.find((i) => i.instanceId === args.sourceInstanceId);
      if (!existingInst) {
        return {
          isError: true,
          error: `Source instance "${args.sourceInstanceId}" not found in assembly.`
        };
      }
      sourcePart = catalogById.get(existingInst.partId);
    } else if (args.partQuery) {
      sourcePart = findPart(args.partQuery);
      if (!sourcePart) {
        return {
          isError: true,
          error: `Could not find VEX IQ part matching "${args.partQuery}".`
        };
      }
    } else {
      return {
        isError: true,
        error: 'Provide either "partQuery" (for a new part) or "sourceInstanceId" (for an existing part).'
      };
    }

    const mate = computeMateTransform(
      sourcePart,
      args.sourcePortId,
      targetInst,
      args.targetPortId,
      {
        flipAxis: Boolean(args.flipAxis),
        rollDeg: Number(args.rollDeg) || 0,
        axialOffsetMm: Number(args.axialOffsetMm) || 0
      }
    );

    if (mate.error) {
      return { isError: true, error: mate.error };
    }

    if (existingInst) {
      const updated = {
        ...existingInst,
        position: mate.position,
        rotation: mate.rotation,
        color: args.color || existingInst.color,
        label: args.label || existingInst.label
      };
      const { isIntersecting, collidingWith } = checkCandidateCollision(updated, state.instances);
      updated.isIntersecting = isIntersecting;
      if (!isIntersecting) {
        updated.lastValidPosition = [...mate.position];
        updated.lastValidRotation = [...mate.rotation];
      }

      const nextInstances = state.instances.map((i) =>
        i.instanceId === updated.instanceId ? updated : i
      );
      await writeAssemblyState({
        ...state,
        selectedId: updated.instanceId,
        instances: nextInstances
      });

      return {
        ok: !isIntersecting,
        status: isIntersecting ? 'intersecting_transparent_grey_preview' : 'mated_solid',
        isIntersecting,
        collidingWith,
        matedPorts: {
          sourcePortId: mate.sourcePort.portId,
          targetPortId: mate.targetPort.portId
        },
        instance: updated
      };
    } else {
      const countOfType = state.instances.filter((i) => i.partId === sourcePart.id).length + 1;
      const newInst = {
        instanceId: `inst-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        partId: sourcePart.id,
        label: args.label || `${sourcePart.name} #${countOfType}`,
        position: mate.position,
        rotation: mate.rotation,
        lastValidPosition: mate.position,
        lastValidRotation: mate.rotation,
        isIntersecting: false,
        color: args.color || sourcePart.defaultColor,
        visible: true,
        locked: false
      };

      const { isIntersecting, collidingWith } = checkCandidateCollision(newInst, state.instances);
      newInst.isIntersecting = isIntersecting;

      const nextInstances = [...state.instances, newInst];
      await writeAssemblyState({
        ...state,
        selectedId: newInst.instanceId,
        instances: nextInstances
      });

      return {
        ok: !isIntersecting,
        status: isIntersecting ? 'intersecting_transparent_grey_preview' : 'mated_solid',
        isIntersecting,
        collidingWith,
        matedPorts: {
          sourcePortId: mate.sourcePort.portId,
          targetPortId: mate.targetPort.portId
        },
        instance: newInst
      };
    }
  }

  if (name === 'mesh_gear_train') {
    const state = readAssemblyState();
    const res = buildMeshedGearTrain(state, {
      supportBeamId: args.supportBeamId,
      outerSupportBeamId: args.outerSupportBeamId || null,
      startPortId: args.startPortId,
      gears: args.gears || [],
      shaftPartQuery: args.shaftPartQuery || null,
      axialOffsetMm: args.axialOffsetMm !== undefined ? Number(args.axialOffsetMm) : null,
      reverseDirection: Boolean(args.reverseDirection)
    });

    if (res.error) {
      return { isError: true, error: res.error };
    }

    const lastPlaced =
      res.placedGears.length > 0
        ? res.placedGears[res.placedGears.length - 1].instance.instanceId
        : state.selectedId;

    await writeAssemblyState({
      ...state,
      selectedId: lastPlaced,
      instances: res.workingInstances
    });

    return {
      ok: true,
      gearsPlacedCount: res.placedGears.length,
      shaftsPlacedCount: res.placedShafts.length,
      placedGears: res.placedGears,
      placedShafts: res.placedShafts
    };
  }

  if (name === 'mirror_subassembly') {
    const state = readAssemblyState();
    const res = mirrorSubassembly(state, {
      instanceIds: Array.isArray(args.instanceIds) ? args.instanceIds : [],
      mirrorPlane: args.mirrorPlane || 'Z',
      planeOffsetMm: Number(args.planeOffsetMm) || 0
    });

    if (res.mirroredCount > 0) {
      await writeAssemblyState({
        ...state,
        selectedId: res.mirroredInstances[res.mirroredInstances.length - 1].instanceId,
        instances: res.workingInstances
      });
    }

    return {
      ok: true,
      mirroredCount: res.mirroredCount,
      mirroredInstances: res.mirroredInstances
    };
  }

  if (name === 'capture_viewport_views') {
    const state = readAssemblyState();
    return generateOrthographicViews(state);
  }

  return { isError: true, error: `Unknown tool: ${name}` };
}

/**
 * Stdio JSON-RPC 2.0 Server loop (supports both newline-delimited JSON-RPC and
 * Content-Length header framing).
 */
let useContentLengthFraming = false;

function sendResponse(msg) {
  const json = JSON.stringify(msg);
  if (useContentLengthFraming) {
    const byteLen = Buffer.byteLength(json, 'utf8');
    process.stdout.write(`Content-Length: ${byteLen}\r\n\r\n${json}`);
  } else {
    process.stdout.write(`${json}\n`);
  }
}

async function handleJsonRpcMessage(req) {
  if (!req || typeof req !== 'object') return;
  const { id, method, params } = req;

  try {
    if (method === 'initialize') {
      sendResponse({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: params?.protocolVersion || '2024-11-05',
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: 'vexiq-builder-mcp',
            version: '1.0.0'
          }
        }
      });
      return;
    }

    if (method === 'notifications/initialized') {
      return;
    }

    if (method === 'ping') {
      sendResponse({ jsonrpc: '2.0', id, result: {} });
      return;
    }

    if (method === 'tools/list') {
      sendResponse({
        jsonrpc: '2.0',
        id,
        result: {
          tools: TOOLS
        }
      });
      return;
    }

    if (method === 'tools/call') {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};
      const output = await executeTool(toolName, toolArgs);
      sendResponse({
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(output, null, 2)
            }
          ],
          isError: Boolean(output?.isError)
        }
      });
      return;
    }

    if (id !== undefined) {
      sendResponse({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32601,
          message: `Method not found: ${method}`
        }
      });
    }
  } catch (err) {
    if (id !== undefined) {
      sendResponse({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: err?.message || String(err)
        }
      });
    }
  }
}

let inputBuffer = Buffer.alloc(0);

process.stdin.on('data', (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);

  while (inputBuffer.length > 0) {
    const strPreview = inputBuffer.toString('utf8', 0, Math.min(inputBuffer.length, 64));
    if (strPreview.startsWith('Content-Length:')) {
      useContentLengthFraming = true;
      const headerEnd = inputBuffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;
      const headerStr = inputBuffer.toString('utf8', 0, headerEnd);
      const match = headerStr.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        inputBuffer = inputBuffer.subarray(headerEnd + 4);
        continue;
      }
      const contentLen = parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;
      if (inputBuffer.length < bodyStart + contentLen) break;
      const bodyStr = inputBuffer.toString('utf8', bodyStart, bodyStart + contentLen);
      inputBuffer = inputBuffer.subarray(bodyStart + contentLen);
      try {
        handleJsonRpcMessage(JSON.parse(bodyStr));
      } catch (e) {
        process.stderr.write(`Parse error: ${e.message}\n`);
      }
    } else {
      const nlIdx = inputBuffer.indexOf('\n');
      if (nlIdx === -1) break;
      const line = inputBuffer.toString('utf8', 0, nlIdx).trim();
      inputBuffer = inputBuffer.subarray(nlIdx + 1);
      if (!line) continue;
      try {
        handleJsonRpcMessage(JSON.parse(line));
      } catch (e) {
        process.stderr.write(`Line parse error: ${e.message}\n`);
      }
    }
  }
});
