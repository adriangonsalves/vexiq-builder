import { MCP_OFF_MESSAGE } from './appSettings.js';
const VEX_PITCH_MM = 12.7;
const TRANSFORM_MODES = ['translate', 'rotate'];
const VIEW_OPTIONS = {
  projection: ['perspective', 'orthographic'],
  viewLayout: ['single', 'four', 'stereo'],
  viewAlong: ['+x', '-x', '+y', '-y', '+z', '-z']
};
const CLEAR_MODES = ['empty', 'starter'];

/**
 * Registers client-side WebMCP tools via `document.modelContext.registerTool()`
 * with progressive-enhancement feature detection and AbortController lifecycle cleanup.
 */
export function registerVexIqWebMcpTools(contextRef) {
  if (typeof document === 'undefined' || !('modelContext' in document) || !document.modelContext) {
    return () => {};
  }

  const controller = new AbortController();
  const options = { signal: controller.signal };

  const tools = [
    {
      name: 'search_parts',
      description:
        'Searches the VEX IQ CAD library to find parts for robot assembly.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Keyword or VEX part code to match.'
          },
          limit: {
            type: 'number',
            default: 15,
            minimum: 1,
            maximum: 50,
            description: 'Maximum results to return.'
          }
        },
        required: ['query']
      },
      execute({ query, limit = 15 } = {}) {
        if (typeof query !== 'string' || !query.trim()) {
          return { error: 'Provide a non-empty search keyword.' };
        }
        const safeLimit = Math.min(Math.max(Number(limit) || 15, 1), 50);
        const q = query.trim().toLowerCase();
        const catalog = contextRef.current?.catalog || [];
        const matches = catalog.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.partNumber.toLowerCase().includes(q) ||
            p.category.toLowerCase().includes(q)
        );
        return {
          totalMatches: matches.length,
          parts: matches.slice(0, safeLimit).map((p) => ({
            id: p.id,
            name: p.name,
            partNumber: p.partNumber,
            category: p.category,
            originType: p.originType || 'centered',
            portCounts: p.portCounts || { total: p.connectorCount },
            gearSpecs: p.gearSpecs || null,
            fastenerSpecs: p.fastenerSpecs || null,
            mountingRules: p.mountingRules || null
          }))
        };
      },
      annotations: { readOnlyHint: true }
    },
    {
      name: 'get_assembly',
      description:
        'Retrieves all part instances currently in the 3D workspace along with their coordinates and collision status.',
      inputSchema: {
        type: 'object',
        properties: {}
      },
      execute() {
        const ctx = contextRef.current;
        if (!ctx) return { error: 'Application context is not ready.' };
        return {
          selectedId: ctx.selectedId,
          selectedIds: ctx.selectedIds,
          instances: ctx.instances
        };
      },
      annotations: { readOnlyHint: true }
    },
    {
      name: 'place_part',
      description:
        'Spawns a VEX IQ part from the library into the 3D workspace at the specified coordinates.',
      inputSchema: {
        type: 'object',
        properties: {
          partQuery: {
            type: 'string',
            description: 'Part code, identifier, or name from the library.'
          },
          xMm: {
            type: 'number',
            default: 0,
            description: 'World X coordinate in millimeters.'
          },
          yMm: {
            type: 'number',
            default: 12.7,
            description: 'World Y coordinate in millimeters.'
          },
          zMm: {
            type: 'number',
            default: 0,
            description: 'World Z coordinate in millimeters.'
          },
          color: {
            type: 'string',
            description: 'Hex color string to apply to the part.'
          }
        },
        required: ['partQuery']
      },
      execute({ partQuery, xMm = 0, yMm = VEX_PITCH_MM, zMm = 0, color } = {}) {
        const ctx = contextRef.current;
        if (!ctx) return { error: 'Application context is not ready.' };
        if (typeof partQuery !== 'string' || !partQuery.trim()) {
          return { error: 'Provide a part identifier or name.' };
        }
        const q = partQuery.trim().toLowerCase();
        const part =
          ctx.catalog.find((p) => p.id === partQuery || p.partNumber.toLowerCase() === q) ||
          ctx.catalog.find(
            (p) => p.name.toLowerCase().includes(q) || p.partNumber.toLowerCase().includes(q)
          );
        if (!part) {
          return { error: `No VEX IQ part matched "${partQuery}".` };
        }
        return ctx.placePartAt(part, [Number(xMm) || 0, Number(yMm) || 0, Number(zMm) || 0], color);
      },
      annotations: { readOnlyHint: false }
    },
    {
      name: 'configure_viewport',
      description:
        'Updates the active 3D gizmo mode, grid visibility, hole axis overlay, camera framing, the Explode panel and slider, or view options (projection, layout, stereo, a camera turn along an axis).',
      inputSchema: {
        type: 'object',
        properties: {
          transformMode: {
            type: 'string',
            enum: TRANSFORM_MODES,
            default: 'translate',
            description: 'Gizmo manipulation mode.'
          },
          showGrid: {
            type: 'boolean',
            description: 'Visibility of the pitch grid.'
          },
          showConnectors: {
            type: 'boolean',
            description: 'Visibility of extracted hole axis vectors.'
          },
          explodeMode: {
            type: 'string',
            enum: ['off', 'all'],
            description: "Explode panel: 'off' closes it; 'all' opens it (parts slide out every way they come apart)."
          },
          explodeAmount: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: 'Explode slider from 0 (built) to 1 (fully apart), set straight away (1 when only explodeMode is given).'
          },
          focusCamera: {
            type: 'boolean',
            description: 'Whether to center the camera on the scene.'
          },
          projection: { type: 'string', enum: VIEW_OPTIONS.projection, description: 'Main view projection.' },
          viewLayout: { type: 'string', enum: VIEW_OPTIONS.viewLayout, description: 'Single view, four-view, or side-by-side stereo.' },
          stereoCrossEyed: { type: 'boolean', description: 'Swap the stereo pictures for cross-eyed viewing.' },
          stereoDepth: { type: 'number', minimum: 0.25, maximum: 3, description: 'Stereo depth (1 by default).' },
          viewAlong: { type: 'string', enum: VIEW_OPTIONS.viewAlong, description: 'Turn the camera once to look from that side.' },
          shadows: { type: 'boolean', description: 'Soft shadows from the main light (off by default).' },
          ambientOcclusion: { type: 'boolean', description: 'Darken creases and inside corners (off by default).' },
          environmentReflections: { type: 'boolean', description: 'Studio environment reflections on metal shafts and surfaces (on by default).' },
          reflectionIntensity: { type: 'number', minimum: 0, maximum: 2, description: 'Brightness/intensity of reflections (0 to 2, default 0.75).' }
        }
      },
      execute({ transformMode = 'translate', showGrid, showConnectors, explodeMode, explodeAmount, focusCamera, projection, viewLayout, stereoCrossEyed, stereoDepth, viewAlong, shadows, ambientOcclusion, environmentReflections, reflectionIntensity } = {}) {
        const ctx = contextRef.current;
        if (!ctx) return { error: 'Application context is not ready.' };
        if (transformMode && !TRANSFORM_MODES.includes(transformMode)) {
          return { error: 'Unsupported transform mode.', supportedModes: TRANSFORM_MODES };
        }
        for (const [key, value] of Object.entries({ projection, viewLayout, viewAlong })) {
          if (value !== undefined && !VIEW_OPTIONS[key].includes(value)) {
            return { error: `${key} must be one of: ${VIEW_OPTIONS[key].join(', ')}.` };
          }
        }
        if (stereoDepth !== undefined && !(Number(stereoDepth) >= 0.25 && Number(stereoDepth) <= 3)) {
          return { error: 'stereoDepth must be a number from 0.25 to 3.' };
        }
        if (shadows !== undefined && typeof shadows !== 'boolean') return { error: 'shadows must be true or false.' };
        if (ambientOcclusion !== undefined && typeof ambientOcclusion !== 'boolean') return { error: 'ambientOcclusion must be true or false.' };
        if (environmentReflections !== undefined && typeof environmentReflections !== 'boolean') return { error: 'environmentReflections must be true or false.' };
        if (reflectionIntensity !== undefined && !(Number(reflectionIntensity) >= 0 && Number(reflectionIntensity) <= 2)) {
          return { error: 'reflectionIntensity must be a number from 0 to 2.' };
        }
        if (explodeMode !== undefined && !['off', 'all'].includes(explodeMode)) return { error: "explodeMode must be 'off' or 'all'." };
        if (explodeAmount !== undefined && !(typeof explodeAmount === 'number' && explodeAmount >= 0 && explodeAmount <= 1)) {
          return { error: 'explodeAmount must be a number from 0 to 1.' };
        }
        ctx.configureViewport({ transformMode, showGrid, showConnectors, explodeMode, explodeAmount, focusCamera, projection, viewLayout, stereoCrossEyed, stereoDepth, viewAlong, shadows, ambientOcclusion, environmentReflections, reflectionIntensity });
        return { ok: true };
      },
      annotations: { readOnlyHint: false }
    },
    {
      name: 'place_band',
      description:
        'Strings a rubber band or belt round spots on other parts (as the MCP server\'s place_band and the app\'s Band builder do). spots: [{ instanceId, feature ("post:body", "post:pin", "post:shaft", "groove", "rim", "gap:<k>", "gaphook:<k>", "edge:<holePortId>", "edge:side+|side-|end+|end-", "hook"), side ("out" | "in"), wraps (1-3), height, cross }] in loop order. Each stretch between hooks takes the shortest clear way round parts in the way, bending on their real corners (addedInWay; alternative 1-3 for the next ways round); inWay: { instanceId: "over" | "under" } limits one to a side; a part no way round clears comes back in needsRoute. Two hooks (first and last spots, posts, pins, grooves, gaps) with only edges between: there and back over the same spots; three or more hooks: a loop (back forces one). A band longer than its route is refused with the size that fits (suggestion) unless allowSlack. With list: true or one spot, lists spots and routes and changes nothing. Reply: stretch, stretchState, pullN, lengthMm, suggestion, route.',
      inputSchema: {
        type: 'object',
        properties: {
          bandPartId: { type: 'string', description: 'The band or belt to add (part id, number or name).' },
          instanceId: { type: 'string', description: 'A placed band to re-string instead.' },
          spots: { type: 'array', items: { type: 'object' }, description: 'The spots in loop order.' },
          inWay: { type: 'object', description: 'Answers for parts in a run\'s way: "over" | "under".' },
          list: { type: 'boolean', description: 'List spots (and routes between two spots); change nothing.' },
          back: { type: 'string', enum: ['auto', 'straight', 'same'], description: '"auto" (default): there and back for two hooks, a loop for more; "same" or "straight" forces one.' },
          allowSlack: { type: 'boolean', description: 'Place it even when it would hang loose.' },
          alternative: { type: 'number', description: '0: the shortest way round; 1-3: the next ways.' },
          near: { type: 'array', items: { type: 'string' } }
        }
      },
      async execute(args = {}) {
        const ctx = contextRef.current;
        if (!ctx) return { error: 'Application context is not ready.' };
        const data = await ctx.runAction('place_band', args);
        if (!data?.ok) return { error: data?.error || 'Could not place the band.', ...(data?.needsRoute ? { needsRoute: data.needsRoute } : {}), ...(data?.suggestion ? { suggestion: data.suggestion } : {}) };
        const { state, record, stepLabel, ...reply } = data;
        return reply;
      },
      annotations: { readOnlyHint: false }
    },
    {
      name: 'clear_assembly',
      description:
        'Resets the 3D workspace by removing all placed parts or restoring the starter assembly.',
      inputSchema: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: CLEAR_MODES,
            default: 'empty',
            description: 'Target workspace state after reset.'
          }
        }
      },
      execute({ mode = 'empty' } = {}) {
        const ctx = contextRef.current;
        if (!ctx) return { error: 'Application context is not ready.' };
        if (!CLEAR_MODES.includes(mode)) {
          return { error: 'Unsupported reset mode.', supportedModes: CLEAR_MODES };
        }
        ctx.resetAssembly(mode);
        return { ok: true, mode };
      },
      annotations: {
        readOnlyHint: false,
        consequentialHint: true
      }
    }
  ];

  for (const tool of tools) {
    // With the assistant turned off in Settings, tools that change things refuse (openspec mcp-app-link)
    if (!tool.annotations?.readOnlyHint) {
      const execute = tool.execute;
      tool.execute = (...args) => (contextRef.current?.mcpEnabled === false ? { error: MCP_OFF_MESSAGE } : execute.apply(tool, args));
    }
    Promise.resolve(document.modelContext.registerTool(tool, options)).catch(() => {
      // Ignore registration errors in environments with partial WebMCP support
    });
  }

  return () => {
    controller.abort();
  };
}
