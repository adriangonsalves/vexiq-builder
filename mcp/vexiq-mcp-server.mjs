#!/usr/bin/env node
import fs from 'node:fs';
import * as THREE from 'three';
import {
  VEX_PITCH_MM,
  appSyncContext,
  appUrl,
  auditAssembly,
  buildDefaultStarterState,
  buildMeshedGearTrain,
  buildWorldMatrix,
  checkCandidateCollision,
  computeMateTransform,
  describePartConnections,
  findMatchingPinHoles,
  findPart,
  generateOrthographicViews,
  getCatalog,
  jointGraph,
  mirrorSubassembly,
  summarizeAudit,
  applyPosePatches,
  placeParts,
  readAppSettings,
  settlePlacedInstance,
  readAssemblyState,
  writeAssemblyState
} from './assembly-engine.mjs';
import { MCP_OFF_MESSAGE } from '../src/utils/appSettings.js';
import {
  applyPatches,
  applySetTransform,
  axisTurn,
  expandToGroups,
  groupCollapse,
  groupParts,
  groupsOf,
  renameGroup,
  setPivot,
  setWorldBoxes,
  ungroupParts,
  wholeGroupOf
} from '../src/utils/partGroups.js';
import { connectedFrom, layersFrom } from '../src/utils/jointLayers.js';
import {
  branchesAt,
  currentLine,
  diffParts,
  headPosition,
  redo as redoHistory,
  stepById,
  undo as undoHistory
} from '../src/utils/buildHistory.js';

// capture_screenshot's named views (src/components/Viewport3D.jsx frames them)
const SCREENSHOT_VIEWS = ['current', 'iso', 'iso-front-left', 'iso-back-right', 'iso-back-left', 'front', 'back', 'side', 'right', 'left', 'top', 'bottom'];

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
      'Get a VEX IQ part\'s size and connection points in its own frame: every pin hole, shaft bore, socket, collar hole, pin/peg and shaft with its position, axis, usable span along the axis (t = dot(point, axis), mm), real depth measured on the 3D model, whether it goes through, and which ends of each peg stick out. Pass verbose for the raw catalog record (cylinders, ports, mesh counts).',
    inputSchema: {
      type: 'object',
      properties: {
        partQuery: {
          type: 'string',
          description: 'Part ID, part number (e.g. "228-2500-025"), or exact part name.'
        },
        verbose: {
          type: 'boolean',
          default: false,
          description: 'Also return the full catalog record: raw ports, cylinders, vertex/triangle/connector counts.'
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
      'Place a VEX IQ part into the 3D workspace. Checks exact concave MeshBVH collision (allowing pins/axles through holes while detecting solid overlaps). A spur gear in mesh range of other gears or racks is turned to mesh (with its whole axle group when it sits on a square axle), a square axle or square-bored part is turned to fit, and a Smart Motor hub turns to an axle in its socket; the reply lists these in notes.',
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
    description: 'Remove a part instance from the 3D assembly by its instanceId, or every part of a group by its groupId (one undo step). Give one of the two.',
    inputSchema: {
      type: 'object',
      properties: {
        instanceId: {
          type: 'string',
          description: 'The instanceId to remove.'
        },
        groupId: {
          type: 'string',
          description: 'Remove every part of this group (see get_assembly groups).'
        }
      }
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
      'Configure the 3D viewport controls, selection, VEX Pitch snap settings, hole-axis overlay, camera focus, and view options: soft shadows, ambient occlusion, perspective/orthographic projection, the layout (single view, four-view with front/top/side views, side-by-side stereo), stereo cross-eyed and depth, and a one-shot camera turn along an axis.',
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
          enum: ['off', 'all'],
          description:
            "Explode panel: 'off' closes it (parts back together); 'all' opens it. Parts slide out every way they come apart, in a real order with no parts passing through each other."
        },
        explodeAmount: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: 'Explode slider value from 0 (built) to 1 (fully apart). Goes straight there (no play). Defaults to 1 when only explodeMode is given.'
        },
        focusCamera: {
          type: 'boolean',
          description: 'If true, triggers the 3D camera to frame the selected part or entire assembly.'
        },
        projection: {
          type: 'string',
          enum: ['perspective', 'orthographic'],
          description: "Main view projection. Stereo always draws in perspective and keeps this for later."
        },
        viewLayout: {
          type: 'string',
          enum: ['single', 'four', 'stereo'],
          description: "'four': the working view plus view-only front (X), top (Y) and side (Z) views. 'stereo': side-by-side stereo pair (view only, no editing)."
        },
        stereoCrossEyed: {
          type: 'boolean',
          description: 'Swap the stereo pictures for cross-eyed viewing (false: parallel viewing / phone VR viewers).'
        },
        stereoDepth: {
          type: 'number',
          minimum: 0.25,
          maximum: 3,
          description: 'Stereo depth: scales the eye separation (distance to target / 30). 1 by default.'
        },
        ambientOcclusion: {
          type: 'boolean',
          description: 'Ambient occlusion: darkens creases and inside corners where faces meet; separate from shadows (off by default).'
        },
        shadows: {
          type: 'boolean',
          description: 'Soft shadows from the main light: parts shade each other and the build casts a faint ground shadow (off by default).'
        },
        environmentReflections: {
          type: 'boolean',
          description: 'Studio environment reflections on metal shafts and surfaces (on by default).'
        },
        reflectionIntensity: {
          type: 'number',
          minimum: 0,
          maximum: 2,
          description: 'Brightness/intensity of environment reflections (0 to 2, default 0.75).'
        },
        viewAlong: {
          type: 'string',
          enum: ['+x', '-x', '+y', '-y', '+z', '-z'],
          description: "Turn the user's camera once to look from that side ('+x' front, '+y' top with +X up, '+z' side), like the 1/2/3 keys."
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
      'Declaratively build a meshed gear train along a supporting beam (supportBeamId) starting at startPortId. Spaces gears by their measured pitch radii, turns each gear to its measured meshing turn against the previous one so the teeth fall into each other\'s gaps, and optionally inserts flush shafts through each gear, turned to fit its square bore.',
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
  },
  {
    name: 'place_parts',
    description:
      'Place a list of parts in one call and get one short reply: per part its ref, instanceId, label and status (placed / overlapping), then one combined audit summary (overlaps, floating and half-seated fasteners, unsecured parts, disconnected groups, driven wheels). Each item gives either an absolute position/rotation, or an insert: put one of the item\'s pins/pegs/shafts/openings into an opening of a placed part (instanceId) or of an earlier item (ref), and push it straight in until it touches something (like double-click mating). Use dryRun to check a layout without saving, and mirror to also place every item\'s mirror image (e.g. build the left half, get the right half). World: Y up, mm, Euler XYZ degrees.',
    inputSchema: {
      type: 'object',
      properties: {
        parts: {
          type: 'array',
          minItems: 1,
          description: 'Items, processed in order.',
          items: {
            type: 'object',
            properties: {
              partQuery: { type: 'string', description: 'Part number, part ID, or part name.' },
              ref: { type: 'string', description: 'Name later items in this call can use in insert.into.ref.' },
              label: { type: 'string' },
              color: { type: 'string' },
              position: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: 'World [x, y, z] mm (absolute placement).' },
              rotation: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: 'Euler [rx, ry, rz] degrees (absolute placement).' },
              insert: {
                type: 'object',
                description: 'Place by inserting into an opening instead of position/rotation.',
                properties: {
                  sourcePort: { type: 'string', description: "This part's pin/peg/shaft/opening (port id from get_part_details). Defaults to its shaft, peg, or bore." },
                  into: {
                    type: 'object',
                    properties: {
                      instanceId: { type: 'string' },
                      ref: { type: 'string' },
                      port: { type: 'string', description: "The target's opening (or pin/shaft when the source is an opening), port id from get_part_details." }
                    },
                    required: ['port']
                  },
                  flip: {
                    type: 'boolean',
                    description: 'Lead with the other end of the pin, shaft or opening (turns the part end for end). The reply lists other fits (otherFits) when a part goes in more than one way.'
                  },
                  rollDeg: {
                    type: 'number',
                    default: 0,
                    description:
                      'Turn around the shared axis. Replaced by the fitting turn for a square axle in a square hole, and by the meshing turn for a spur gear in mesh range (the reply says rollReplaced).'
                  },
                  fromSide: { type: 'string', enum: ['+', '-'], description: "Side of the target port's axis to come in from. Defaults to the open side of a blind opening, else '+'." }
                },
                required: ['into']
              }
            },
            required: ['partQuery']
          }
        },
        dryRun: { type: 'boolean', default: false, description: 'Check only: same reply (with poses), nothing saved.' },
        rejectIntersecting: { type: 'boolean', default: false, description: 'Save nothing if any item overlaps another part.' },
        mirror: {
          type: 'object',
          description: 'Also place every item mirrored across this plane.',
          properties: {
            plane: { type: 'string', enum: ['X', 'Y', 'Z'] },
            offsetMm: { type: 'number', default: 0 }
          },
          required: ['plane']
        },
        verbose: { type: 'boolean', default: false, description: 'Include each part\'s position and rotation.' }
      },
      required: ['parts']
    }
  },
  {
    name: 'capture_screenshot',
    description:
      "Return a PNG picture of the app's 3D view, rendered by the browser that has the app open. view 'current' uses the user's camera; the other views (or a direction) use a separate camera framed on the whole assembly (or focusInstanceId) and leave the user's camera alone. Gizmos, hole highlights and the selection tint are left out. Every open tab is asked and the most complete picture is returned; the reply has a warning when even that tab is still loading parts or shows a different build than the saved one. Fails with a hint when the app isn't running or no browser has it open.",
    inputSchema: {
      type: 'object',
      properties: {
        view: {
          type: 'string',
          enum: SCREENSHOT_VIEWS,
          default: 'iso',
          description: "Camera: +X is the robot's front and +Z its right. 'iso' looks from front-right-above; 'iso-front-left', 'iso-back-right', 'iso-back-left' from the other corners; 'front', 'back', 'left', 'right' (= 'side'), 'top', 'bottom' straight on. 'current' is the user's camera."
        },
        direction: {
          type: 'array',
          items: { type: 'number' },
          minItems: 3,
          maxItems: 3,
          description: 'Look from this direction instead of a named view: [x, y, z] from the assembly toward the camera, e.g. [1, 0.5, -1].'
        },
        focusInstanceId: { type: 'string', description: 'Frame this part instead of the whole assembly (standard views only).' },
        width: { type: 'number', default: 1024, description: '320 to 1920 px.' },
        height: { type: 'number', default: 768, description: '320 to 1920 px.' }
      }
    }
  },
  {
    name: 'select_parts',
    description:
      "Change the app's selection (no undo step). mode: replace (default), add, remove, all (every visible part), none or invert; instanceIds for replace/add/remove. connected: true then selects every part joined to them through seated pins, pegs and shafts (as the app's Select Connected). expandLayers: n instead adds n layers of directly joined parts (beam -> its pins -> the parts they go into). A grouped part brings its whole group unless expandGroups is false. Replies with the selected parts, the primary (last) part and their groups.",
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['replace', 'add', 'remove', 'all', 'none', 'invert'] },
        instanceIds: { type: 'array', items: { type: 'string' } },
        connected: { type: 'boolean' },
        expandLayers: { type: 'integer', minimum: 0 },
        expandGroups: { type: 'boolean', description: 'Default true.' }
      }
    }
  },
  {
    name: 'group_parts',
    description:
      'Make the given parts (or the current selection) one named group, shown as a folder in the app. Needs two or more parts; parts leave their old group, and a group left with one part is dissolved. Moves nothing. One undo step; the group is selected.',
    inputSchema: {
      type: 'object',
      properties: {
        instanceIds: { type: 'array', items: { type: 'string' }, description: 'Default: the current selection.' },
        name: { type: 'string', description: 'Default "Group N".' }
      }
    }
  },
  {
    name: 'ungroup_parts',
    description: 'Dissolve a group (groupId), or every group the given parts are in (instanceIds). The parts stay where they are. One undo step.',
    inputSchema: {
      type: 'object',
      properties: {
        groupId: { type: 'string' },
        instanceIds: { type: 'array', items: { type: 'string' } }
      }
    }
  },
  {
    name: 'update_group',
    description:
      "Change a group (groupId) or a set of parts (instanceIds) as one undo step: rename it, hide/show, lock/unlock, move it by a distance, move its centre (the parts' combined bounding box centre) to a point, or turn it about that centre. The parts keep their places relative to one another. Refused for a move or turn when a part is locked. Replies with the new centre and the same short check summary as place_parts.",
    inputSchema: {
      type: 'object',
      properties: {
        groupId: { type: 'string' },
        instanceIds: { type: 'array', items: { type: 'string' } },
        name: { type: 'string', description: 'Groups only; not empty.' },
        visible: { type: 'boolean' },
        locked: { type: 'boolean' },
        moveBy: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: '[x, y, z] mm' },
        moveCentreTo: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: '[x, y, z] mm' },
        turn: {
          type: 'object',
          properties: { axis: { type: 'string', enum: ['X', 'Y', 'Z'] }, deg: { type: 'number' } },
          required: ['axis', 'deg']
        }
      }
    }
  },
  {
    name: 'get_history',
    description:
      "List the build history: the steps on the current line (number, label, source app/mcp/assistant/action, time, parts added/removed/changed), which step is current, and where other branches split off. Every change to the parts is a step; each MCP call that changes parts is one step.",
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', default: 50, description: 'Return only the last N steps of the line (the current step is always included).' }
      }
    }
  },
  {
    name: 'undo',
    description:
      'Undo the last step(s) of the build history, e.g. to back out an MCP call that placed parts wrongly. Undone steps are kept: redo brings them back, and a new change starts a branch instead of deleting them.',
    inputSchema: {
      type: 'object',
      properties: {
        steps: { type: 'number', default: 1, description: 'How many steps to undo.' }
      }
    }
  },
  {
    name: 'redo',
    description: 'Redo step(s) that were undone, along the current line of the build history.',
    inputSchema: {
      type: 'object',
      properties: {
        steps: { type: 'number', default: 1, description: 'How many steps to redo.' }
      }
    }
  }
];

// How real pieces go together (motor shaft rings, collars, connectors...), from AGENTS.md
function partUsageNotes() {
  try {
    const text = fs.readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8');
    const notes = /<!-- part-usage:start -->([\s\S]*?)<!-- part-usage:end -->/.exec(text)?.[1].trim();
    return notes ? `How VEX IQ pieces are used:\n${notes}` : undefined;
  } catch {
    return undefined;
  }
}

// get_assembly's groups: id, name, part ids and the centre of their combined bounding box
function groupList(instances, catalogById) {
  return [...groupsOf(instances).values()].map((g) => ({
    id: g.id,
    name: g.name,
    instanceIds: g.ids,
    centre: setPivot(instances, g.ids, setWorldBoxes(instances, g.ids, (i) => catalogById.get(i.partId)?.bbox)).map((v) => Number(v.toFixed(3)))
  }));
}

// select_parts' reply: what is selected, the primary part and the groups they belong to
function selectionReply(instances, ids) {
  const byId = new Map(instances.map((i) => [i.instanceId, i]));
  const groups = groupsOf(instances);
  const touched = [...new Set(ids.map((id) => byId.get(id)?.groupId).filter((g) => groups.has(g)))];
  return {
    ok: true,
    count: ids.length,
    primaryId: ids.at(-1) ?? null,
    selected: ids.map((id) => ({ instanceId: id, label: byId.get(id)?.label })),
    groups: touched.map((g) => ({ groupId: g, name: groups.get(g).name, whole: groups.get(g).ids.every((id) => ids.includes(id)) }))
  };
}

// Tools that only read: they still answer with the assistant turned off in the app's Settings
const READ_ONLY_TOOLS = new Set(['search_parts', 'get_part_details', 'get_assembly', 'get_history', 'audit_assembly', 'capture_viewport_views']);

async function executeTool(name, args = {}) {
  // The app's Settings can turn the assistant off: then nothing it does changes the build
  if (!READ_ONLY_TOOLS.has(name) && readAppSettings().mcpEnabled === false) {
    return { isError: true, ok: false, error: MCP_OFF_MESSAGE };
  }
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
    const compact = {
      id: part.id,
      name: part.name,
      partNumber: part.partNumber,
      category: part.category,
      sizeMm: part.bbox.size,
      bbox: { min: part.bbox.min, max: part.bbox.max },
      originType: part.originType || 'centered',
      gearSpecs: part.gearSpecs || null,
      ...(part.rackSpecs ? { rackSpecs: part.rackSpecs } : {}),
      fastenerSpecs: part.fastenerSpecs || null,
      ...(part.hubSpecs ? { hubSpecs: part.hubSpecs } : {}),
      connections: describePartConnections(part)
    };
    if (!args.verbose) return compact;
    return {
      ...compact,
      defaultColor: part.defaultColor,
      bbox: part.bbox,
      pitchSize: part.pitchSize || part.bbox.size.map((d) => Number((d / VEX_PITCH_MM).toFixed(2))),
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
      selectedIds: state.selectedIds || (state.selectedId ? [state.selectedId] : []),
      viewport: state.viewport,
      // Only where the build is in its history; get_history lists the steps
      history: headPosition(state.history),
      instanceCount: state.instances.length,
      groups: groupList(state.instances, catalogById),
      instances: state.instances.map((inst) => {
        const part = catalogById.get(inst.partId);
        return {
          ...inst,
          partName: part?.name || inst.partId,
          partNumber: part?.partNumber || 'UNKNOWN',
          pitchPosition: inst.position.map((c) => Number((c / VEX_PITCH_MM).toFixed(2))),
          // A Smart Motor's drive hub angle (missing in older saves means 0)
          ...(part?.hubSpecs ? { socketAngleDeg: Number(inst.socketAngleDeg) || 0 } : {})
        };
      })
    };
  }

  if (name === 'select_parts') {
    const state = readAssemblyState();
    const { instances } = state;
    const mode = args.mode || 'replace';
    const known = new Set(instances.map((i) => i.instanceId));
    const given = Array.isArray(args.instanceIds) ? args.instanceIds : [];
    const unknown = given.filter((id) => !known.has(id));
    if (unknown.length) return { isError: true, error: `Not in the build: ${unknown.join(', ')}` };
    if (args.connected && args.expandLayers !== undefined) return { isError: true, error: 'Give connected or expandLayers, not both.' };
    if ((mode === 'add' || mode === 'remove') && !Array.isArray(args.instanceIds)) {
      return { isError: true, error: `mode "${mode}" needs instanceIds.` };
    }
    const expandGroups = args.expandGroups !== false;
    const ids = expandGroups ? expandToGroups(given, instances) : given;
    const current = state.selectedIds || (state.selectedId ? [state.selectedId] : []);
    const visible = instances.filter((i) => i.visible !== false).map((i) => i.instanceId);
    let next;
    if (mode === 'all') next = visible;
    else if (mode === 'none') next = [];
    else if (mode === 'invert') next = visible.filter((id) => !current.includes(id));
    else if (mode === 'add') next = [...current.filter((id) => !ids.includes(id)), ...ids];
    else if (mode === 'remove') next = current.filter((id) => !ids.includes(id));
    else next = ids;
    if (args.connected || args.expandLayers !== undefined) {
      const graph = jointGraph(state);
      const options = expandGroups ? { collapse: groupCollapse(instances) } : {};
      next = args.connected
        ? connectedFrom(graph, next, options)
        : layersFrom(graph, next, options).slice(0, Math.max(0, Math.floor(args.expandLayers)) + 1).flat();
    }
    await writeAssemblyState({ ...state, selectedIds: next, selectedId: next.at(-1) ?? null });
    return selectionReply(instances, next);
  }

  if (name === 'group_parts') {
    const state = readAssemblyState();
    const ids = Array.isArray(args.instanceIds) ? args.instanceIds : state.selectedIds || (state.selectedId ? [state.selectedId] : []);
    const known = new Set(state.instances.map((i) => i.instanceId));
    const unknown = ids.filter((id) => !known.has(id));
    if (unknown.length) return { isError: true, error: `Not in the build: ${unknown.join(', ')}` };
    let made;
    try {
      made = groupParts(state.instances, ids, args.name);
    } catch (err) {
      return { isError: true, error: err.message };
    }
    const instances = applyPatches(state.instances, made.patches);
    const members = instances.filter((i) => i.groupId === made.groupId).map((i) => i.instanceId);
    await writeAssemblyState(
      { ...state, instances, selectedIds: members, selectedId: members.at(-1) ?? null },
      { stepLabel: `Group ${members.length} parts as ${made.name}` }
    );
    return { ok: true, groupId: made.groupId, name: made.name, instanceIds: members };
  }

  if (name === 'ungroup_parts') {
    const state = readAssemblyState();
    let ids = Array.isArray(args.instanceIds) ? args.instanceIds : [];
    if (args.groupId !== undefined) {
      const group = groupsOf(state.instances).get(args.groupId);
      if (!group) return { isError: true, error: `Group "${args.groupId}" not found.` };
      ids = [...ids, ...group.ids];
    }
    if (ids.length === 0) return { isError: true, error: 'Give a groupId or instanceIds.' };
    const groups = groupsOf(state.instances);
    const { groupIds, patches } = ungroupParts(state.instances, ids);
    if (groupIds.length === 0) return { isError: true, error: 'None of those parts are in a group.' };
    const names = groupIds.map((g) => groups.get(g).name);
    await writeAssemblyState(
      { ...state, instances: applyPatches(state.instances, patches) },
      { stepLabel: names.length === 1 ? `Ungroup ${names[0]}` : `Ungroup ${names.length} groups` }
    );
    return { ok: true, ungrouped: groupIds.map((g, i) => ({ groupId: g, name: names[i], instanceIds: groups.get(g).ids })) };
  }

  if (name === 'update_group') {
    const state = readAssemblyState();
    const groups = groupsOf(state.instances);
    let ids;
    let group = null;
    if (args.groupId !== undefined) {
      group = groups.get(args.groupId);
      if (!group) return { isError: true, error: `Group "${args.groupId}" not found.` };
      ids = group.ids;
    } else if (Array.isArray(args.instanceIds) && args.instanceIds.length > 0) {
      const known = new Set(state.instances.map((i) => i.instanceId));
      const unknown = args.instanceIds.filter((id) => !known.has(id));
      if (unknown.length) return { isError: true, error: `Not in the build: ${unknown.join(', ')}` };
      ids = [...new Set(args.instanceIds)];
      group = wholeGroupOf(state.instances, ids, groups);
    } else {
      return { isError: true, error: 'Give a groupId or instanceIds.' };
    }
    const vec = (v) => Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(Number(n)));
    if (args.moveBy !== undefined && !vec(args.moveBy)) return { isError: true, error: 'moveBy must be [x, y, z] in mm.' };
    if (args.moveCentreTo !== undefined && !vec(args.moveCentreTo)) return { isError: true, error: 'moveCentreTo must be [x, y, z] in mm.' };
    if (args.turn !== undefined && (!['X', 'Y', 'Z'].includes(String(args.turn.axis).toUpperCase()) || !Number.isFinite(Number(args.turn.deg)))) {
      return { isError: true, error: 'turn must be { axis: X | Y | Z, deg }.' };
    }

    let instances = state.instances;
    let label = group ? group.name : `${ids.length} parts`;
    const changes = [];
    if (args.name !== undefined) {
      if (!group) return { isError: true, error: 'name needs a whole group (groupId).' };
      let renamed;
      try {
        renamed = renameGroup(instances, group.id, args.name);
      } catch (err) {
        return { isError: true, error: err.message };
      }
      instances = applyPatches(instances, renamed.patches);
      changes.push(`Rename ${renamed.oldName} to ${renamed.name}`);
      label = renamed.name;
    }
    const wanted = new Set(ids);
    const setFlag = (field, value) => {
      instances = instances.map((i) => (wanted.has(i.instanceId) ? { ...i, [field]: value } : i));
    };
    if (args.visible !== undefined) {
      setFlag('visible', Boolean(args.visible));
      changes.push(`${args.visible ? 'Show' : 'Hide'} ${label}`);
    }
    if (args.locked !== undefined) {
      setFlag('locked', Boolean(args.locked));
      changes.push(`${args.locked ? 'Lock' : 'Unlock'} ${label}`);
    }

    const moves = args.moveBy !== undefined || args.moveCentreTo !== undefined || args.turn !== undefined;
    const boxesOf = (list) => setWorldBoxes(list, ids, (i) => catalogById.get(i.partId)?.bbox);
    if (moves) {
      if (instances.some((i) => wanted.has(i.instanceId) && i.locked)) return { isError: true, error: 'Part is locked' };
      if (args.turn !== undefined) {
        const centre = setPivot(instances, ids, boxesOf(instances));
        instances = applyPatches(instances, applySetTransform(instances, ids, centre, { deltaQuat: axisTurn(String(args.turn.axis).toUpperCase(), Number(args.turn.deg)) }));
        changes.push(`Turn ${label}`);
      }
      if (args.moveBy !== undefined || args.moveCentreTo !== undefined) {
        const delta = args.moveBy !== undefined ? args.moveBy.map(Number) : [0, 0, 0];
        if (args.moveCentreTo !== undefined) {
          const centre = setPivot(instances, ids, boxesOf(instances));
          args.moveCentreTo.forEach((v, k) => (delta[k] += Number(v) - centre[k]));
        }
        instances = applyPatches(instances, applySetTransform(instances, ids, [0, 0, 0], { deltaPos: delta }));
        changes.push(`Move ${label}`);
      }
      // Overlaps against parts outside the set only
      const outside = instances.filter((i) => !wanted.has(i.instanceId));
      instances = instances.map((i) => (wanted.has(i.instanceId) ? { ...i, isIntersecting: checkCandidateCollision(i, outside).isIntersecting } : i));
    }
    if (changes.length === 0) return { isError: true, error: 'Nothing to change: give name, visible, locked, moveBy, moveCentreTo or turn.' };

    await writeAssemblyState(
      { ...state, instances, selectedIds: ids, selectedId: ids.at(-1) },
      { stepLabel: changes.length === 1 ? changes[0] : `${changes.map((c) => c.split(' ')[0]).join(', ')} ${label}` }
    );
    const saved = readAssemblyState();
    return {
      ok: true,
      ...(group ? { groupId: group.id, name: groupsOf(saved.instances).get(group.id)?.name } : {}),
      instanceIds: ids,
      centre: setPivot(saved.instances, ids, boxesOf(saved.instances)).map((v) => Number(v.toFixed(3))),
      changed: changes,
      audit: summarizeAudit(auditAssembly(saved))
    };
  }

  if (name === 'get_history') {
    const { history } = readAssemblyState();
    const line = currentLine(history);
    const { currentStep, totalSteps } = headPosition(history);
    const limit = Math.max(1, Math.floor(Number(args.limit) || 50));
    const from = Math.max(0, Math.min(totalSteps - limit, currentStep - 1));
    const count = (step, op) => step.ops.filter((o) => o.op === op).length;
    return {
      currentStep,
      totalSteps,
      steps: line.slice(from, from + limit).map((step, i) => ({
        step: from + i + 1,
        label: step.label,
        source: step.source,
        at: new Date(step.at).toISOString(),
        added: count(step, 'add'),
        removed: count(step, 'remove'),
        changed: count(step, 'update'),
        current: step.id === history.headId
      })),
      // Steps (0 = the start) where more than one branch continues
      branchPoints: [null, ...line.map((s) => s.id)]
        .map((id, i) => ({ afterStep: i, branches: branchesAt(history, id) }))
        .filter((p) => p.branches.length > 1)
        .map((p) => ({
          afterStep: p.afterStep,
          branches: p.branches.map((b) => ({ firstLabel: b.label, steps: b.length, onCurrentLine: b.active }))
        }))
    };
  }

  if (name === 'undo' || name === 'redo') {
    const state = readAssemblyState();
    const count = Math.max(1, Math.floor(Number(args.steps) || 1));
    const moved = (name === 'undo' ? undoHistory : redoHistory)(state.history, state.instances, count);
    if (!moved) {
      return { ok: false, message: name === 'undo' ? 'Nothing to undo: the build is at the start of its history.' : 'Nothing to redo: the build is at the end of the current line.' };
    }
    const labelOf = (id) => stepById(state.history, id)?.label;
    const changes = diffParts(state.instances, moved.parts);
    const keepSelection = moved.parts.some((p) => p.instanceId === state.selectedId);
    await writeAssemblyState(
      { ...state, selectedId: keepSelection ? state.selectedId : null, instances: moved.parts, history: moved.history },
      { recordHistory: false }
    );
    return {
      ok: true,
      [name === 'undo' ? 'undone' : 'redone']: (name === 'undo' ? moved.undone : moved.redone).map(labelOf),
      ...headPosition(moved.history),
      currentLabel: labelOf(moved.history.headId) || '(start)',
      partsAdded: changes.filter((o) => o.op === 'add').length,
      partsRemoved: changes.filter((o) => o.op === 'remove').length,
      partsChanged: changes.filter((o) => o.op === 'update').length,
      instanceCount: moved.parts.length
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

    // The placement step: square fit, mesh, shaft-group turns and motor hubs (openspec gear-meshing)
    const settled = settlePlacedInstance(candidate, [...state.instances, candidate]);
    const ownPatch = settled.patches.find((p) => p.instanceId === instanceId);
    if (ownPatch) Object.assign(candidate, ownPatch);
    const otherPatches = settled.patches.filter((p) => p.instanceId !== instanceId);
    const settledInstances = applyPosePatches(state.instances, otherPatches);

    const { isIntersecting, collidingWith } = checkCandidateCollision(candidate, settledInstances);
    candidate.isIntersecting = isIntersecting;
    candidate.lastValidPosition = isIntersecting ? null : [...candidate.position];
    candidate.lastValidRotation = isIntersecting ? null : [...candidate.rotation];

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
      instances: [...settledInstances, candidate]
    });

    return {
      ok: !isIntersecting,
      placed: !isIntersecting,
      status: isIntersecting ? 'intersecting_transparent_grey_preview' : 'placed_solid',
      isIntersecting,
      collidingWith,
      instance: candidate,
      ...(settled.messages.length ? { notes: settled.messages } : {}),
      ...(ownPatch?.rotation ? { rotationReplaced: 'The given rotation was turned to fit a square hole or to mesh.' } : {}),
      ...(otherPatches.length
        ? { turnedOthers: otherPatches.map((p) => state.instances.find((i) => i.instanceId === p.instanceId)?.label || p.instanceId) }
        : {}),
      totalInstances: nextState.instances.length,
      message: isIntersecting
        ? 'Part intersects solid geometry and is shown as transparent grey (unplaced preview) in the 3D viewport. Move it to clear space or through a hole to place it.'
        : `Successfully placed ${candidate.label} (${part.partNumber}) at [${candidate.position.join(', ')}] mm.`
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

  if (name === 'remove_part' && args.groupId !== undefined) {
    if (args.instanceId !== undefined) return { isError: true, error: 'Give instanceId or groupId, not both.' };
    const state = readAssemblyState();
    const group = groupsOf(state.instances).get(args.groupId);
    if (!group) return { isError: true, error: `Group "${args.groupId}" not found.` };
    const doomed = new Set(group.ids);
    const nextInstances = state.instances.filter((i) => !doomed.has(i.instanceId));
    await writeAssemblyState({ ...state, instances: nextInstances }, { stepLabel: `Delete ${group.name}` });
    return { ok: true, removedGroupId: group.id, removedInstanceIds: group.ids, remainingInstances: nextInstances.length };
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
    const allowed = {
      projection: ['perspective', 'orthographic'],
      viewLayout: ['single', 'four', 'stereo'],
      viewAlong: ['+x', '-x', '+y', '-y', '+z', '-z']
    };
    for (const [key, values] of Object.entries(allowed)) {
      if (args[key] !== undefined && !values.includes(args[key])) {
        return { isError: true, error: `${key} must be one of: ${values.join(', ')} (got ${JSON.stringify(args[key])}).` };
      }
    }
    if (args.stereoDepth !== undefined && !(Number(args.stereoDepth) >= 0.25 && Number(args.stereoDepth) <= 3)) {
      return { isError: true, error: `stereoDepth must be a number from 0.25 to 3 (got ${JSON.stringify(args.stereoDepth)}).` };
    }
    if (args.ambientOcclusion !== undefined && typeof args.ambientOcclusion !== 'boolean') {
      return { isError: true, error: `ambientOcclusion must be true or false (got ${JSON.stringify(args.ambientOcclusion)}).` };
    }
    if (args.shadows !== undefined && typeof args.shadows !== 'boolean') {
      return { isError: true, error: `shadows must be true or false (got ${JSON.stringify(args.shadows)}).` };
    }
    if (args.environmentReflections !== undefined && typeof args.environmentReflections !== 'boolean') {
      return { isError: true, error: `environmentReflections must be true or false (got ${JSON.stringify(args.environmentReflections)}).` };
    }
    if (args.reflectionIntensity !== undefined && !(Number(args.reflectionIntensity) >= 0 && Number(args.reflectionIntensity) <= 2)) {
      return { isError: true, error: `reflectionIntensity must be a number from 0 to 2 (got ${JSON.stringify(args.reflectionIntensity)}).` };
    }
    if (args.explodeAmount !== undefined && !(typeof args.explodeAmount === 'number' && args.explodeAmount >= 0 && args.explodeAmount <= 1)) {
      return { isError: true, error: `explodeAmount must be a number from 0 to 1 (got ${JSON.stringify(args.explodeAmount)}).` };
    }
    if (args.stereoCrossEyed !== undefined && typeof args.stereoCrossEyed !== 'boolean') {
      return { isError: true, error: `stereoCrossEyed must be true or false (got ${JSON.stringify(args.stereoCrossEyed)}).` };
    }
    const state = readAssemblyState();
    const prevVp = state.viewport || {};
    const prevAlong = prevVp.viewAlongTrigger || { dir: null, n: 0 };
    const nextViewport = {
      transformMode: args.transformMode ?? prevVp.transformMode ?? 'translate',
      snapPitchFactor:
        args.snapPitchFactor !== undefined ? Number(args.snapPitchFactor) : prevVp.snapPitchFactor ?? 0.5,
      rotationSnapDeg:
        args.rotationSnapDeg !== undefined ? Number(args.rotationSnapDeg) : prevVp.rotationSnapDeg ?? 15,
      showGrid: args.showGrid !== undefined ? Boolean(args.showGrid) : prevVp.showGrid ?? true,
      showConnectors:
        args.showConnectors !== undefined ? Boolean(args.showConnectors) : prevVp.showConnectors ?? true,
      explodeMode:
        args.explodeMode !== undefined
          ? args.explodeMode === 'off' ? 'off' : 'all'
          : args.explodeAmount !== undefined ? 'all' : prevVp.explodeMode === 'off' || !prevVp.explodeMode ? 'off' : 'all',
      // The slider goes straight to the value (1 when only explodeMode is given)
      explodeAmount:
        args.explodeAmount !== undefined
          ? Math.min(1, Math.max(0, Number(args.explodeAmount)))
          : args.explodeMode !== undefined
            ? 1
            : prevVp.explodeAmount ?? 1,
      focusTrigger: args.focusCamera ? (prevVp.focusTrigger || 0) + 1 : prevVp.focusTrigger || 0,
      projection: args.projection ?? prevVp.projection ?? 'perspective',
      viewLayout: args.viewLayout ?? prevVp.viewLayout ?? 'single',
      stereoCrossEyed: args.stereoCrossEyed ?? prevVp.stereoCrossEyed ?? false,
      stereoDepth: args.stereoDepth !== undefined ? Number(args.stereoDepth) : prevVp.stereoDepth ?? 1,
      shadows: args.shadows ?? prevVp.shadows ?? false,
      ambientOcclusion: args.ambientOcclusion ?? prevVp.ambientOcclusion ?? false,
      environmentReflections: args.environmentReflections ?? prevVp.environmentReflections ?? true,
      reflectionIntensity:
        args.reflectionIntensity !== undefined ? Number(args.reflectionIntensity) : prevVp.reflectionIntensity ?? 0.75,
      // A one-shot turn: the app turns the camera when the count goes up
      viewAlongTrigger: args.viewAlong ? { dir: args.viewAlong, n: (prevAlong.n || 0) + 1 } : prevAlong
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

  if (name === 'place_parts') {
    const state = readAssemblyState();
    const dryRun = Boolean(args.dryRun);
    const result = placeParts(state, args.parts, { mirror: args.mirror });
    if (result.error) {
      const { index, ref, reason } = result.error;
      const where = index == null ? '' : `item ${index}${ref ? ` (ref "${ref}")` : ''}: `;
      return { isError: true, ok: false, saved: false, error: `${where}${reason}`, item: result.error };
    }

    const overlapping = result.placed.filter((p) => p.inst.isIntersecting);
    const rejected = Boolean(args.rejectIntersecting) && overlapping.length > 0;
    const withPoses = Boolean(args.verbose) || dryRun;
    const parts = result.placed.map((p) => ({
      ref: p.ref ?? p.index,
      instanceId: p.inst.instanceId,
      label: p.inst.label,
      status: p.inst.isIntersecting ? 'overlapping' : 'placed',
      ...(p.collidingWith.length ? { overlaps: p.collidingWith } : {}),
      ...(p.stoppedAgainst ? { stoppedAgainst: p.stoppedAgainst } : {}),
      ...(p.otherFits?.length
        ? {
            otherFits: p.otherFits,
            otherFitsNote: `This part also fits ${p.otherFits.length} other way(s) that look different. Check it faces the right way; pass insert.flip / insert.rollDeg from one of these to use it instead.`
          }
        : {}),
      ...(p.mirrorApproximate ? { mirrorApproximate: true } : {}),
      // The placement step: meshes, square fits, hub turns, neighbours it couldn't mesh with
      ...(p.notes?.length ? { notes: p.notes } : {}),
      ...(p.rollReplaced ? { rollReplaced: 'The given roll was changed to fit a square hole or to mesh.' } : {}),
      ...(p.turnedOthers?.length ? { turnedOthers: p.turnedOthers } : {}),
      ...(withPoses ? { position: p.inst.position, rotation: p.inst.rotation } : {})
    }));

    const saved = !dryRun && !rejected;
    if (saved) {
      await writeAssemblyState({
        ...state,
        selectedId: result.placed.at(-1)?.inst.instanceId ?? state.selectedId,
        instances: result.instances
      });
    }
    return {
      ok: !rejected,
      ...(dryRun ? { dryRun: true } : {}),
      saved,
      ...(rejected ? { message: `Nothing saved: ${overlapping.length} part(s) overlap (rejectIntersecting).` } : {}),
      placedCount: parts.length,
      parts,
      audit: result.audit
    };
  }

  if (name === 'capture_screenshot') {
    const clamp = (v, d) => Math.round(Math.min(Math.max(Number(v) || d, 320), 1920));
    const request = {
      view: SCREENSHOT_VIEWS.includes(args.view) ? args.view : 'iso',
      ...(Array.isArray(args.direction) && args.direction.length === 3 ? { direction: args.direction.map(Number) } : {}),
      width: clamp(args.width, 1024),
      height: clamp(args.height, 768),
      ...(args.focusInstanceId ? { focusInstanceId: args.focusInstanceId } : {})
    };
    let res;
    try {
      res = await fetch(`${appUrl()}/api/assembly/screenshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(12000)
      });
    } catch {
      return {
        isError: true,
        error: "The app isn't running, so there is no view to capture.",
        appHint: 'Start it with `npm run dev`.'
      };
    }
    const reply = await res.json().catch(() => ({}));
    if (res.status === 409) {
      return { isError: true, error: 'No browser has the app open.', appHint: `Open ${appUrl()} to see it.` };
    }
    if (!res.ok || !reply.png) {
      return { isError: true, error: reply.error || `Screenshot failed (HTTP ${res.status}).` };
    }
    return {
      mcpContent: [
        { type: 'image', data: reply.png, mimeType: 'image/png' },
        { type: 'text', text: JSON.stringify({ ok: true, ...request, ...(reply.warning ? { warning: reply.warning } : {}) }) }
      ]
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
          },
          instructions: partUsageNotes()
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
      // Tools that save the assembly report whether the open app received the change
      // The tool name and call id let a changing call be recorded as one history step
      const sync = { toolName, callId: `${Date.now().toString(36)}-${id ?? Math.random().toString(36).slice(2, 8)}` };
      const output = await appSyncContext.run(sync, () => executeTool(toolName, toolArgs));
      if (sync.appSync && output && typeof output === 'object') {
        output.appSync = sync.appSync;
        if (sync.appHint) output.appHint = sync.appHint;
      }
      if (sync.historyStep && output && typeof output === 'object') {
        output.historyStep = sync.historyStep;
        if (sync.historyBranched) {
          output.historyNote =
            'The build had been moved back in its history, so this change started a new branch. The later steps are kept as another branch (see get_history).';
        }
      }
      sendResponse({
        jsonrpc: '2.0',
        id,
        result: {
          // A tool may return its own content items (e.g. an image) instead of a JSON text reply
          content: output?.mcpContent || [
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
