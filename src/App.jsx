import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Box,
  Columns2,
  Cuboid,
  Glasses,
  LayoutGrid,
  Square,
  Sun,
  Compass,
  Contrast,
  Copy,
  Crosshair,
  Download,
  Expand,
  Fullscreen,
  Grid,
  History as HistoryIcon,
  List as ListIcon,
  Maximize2,
  Move,
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
  Settings as SettingsIcon,
  Redo2,
  RotateCcw,
  RotateCw,
  Search,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
  X
} from 'lucide-react';
import Viewport3D from './components/Viewport3D.jsx';
import PartThumbnail, { GRID_THUMB_PX, ZOOM_THUMB_PX, cachedThumbnail } from './components/PartThumbnail.jsx';
import { loadRecent, recordUse, saveRecent } from './utils/recentParts.js';
import HistoryTimeline from './components/HistoryTimeline.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
import ToolbarMenu from './components/ToolbarMenu.jsx';
import ExplodePanel from './components/ExplodePanel.jsx';
import SelectMenu from './components/SelectMenu.jsx';
import BuildMenu, { ChainBuilderDialog, ChainRouteDialog } from './components/BuildMenu.jsx';
import { buildChainPath, checkSprocketsForChain } from './utils/chainPath.js';
import AssemblyOutliner from './components/AssemblyOutliner.jsx';
import SetInspector from './components/SetInspector.jsx';
import ViewMenu from './components/ViewMenu.jsx';
import { STARTERS, starterById } from './starters.js';
import {
  copyName,
  deleteBuild,
  exportFileName,
  fileBuildName,
  getBuild,
  libraryAvailable,
  listBuilds,
  newBuildId,
  nextBuildName,
  putBuild,
  starterBuildName,
  uniqueName
} from './utils/buildLibrary.js';
import FileMenu, { BuildNameField } from './components/FileMenu.jsx';
import LibraryDialog from './components/LibraryDialog.jsx';
import { registerVexIqWebMcpTools } from './utils/webMcpTools.js';
import { DEFAULT_SETTINGS, isLinearHistory, normalizeSettings } from './utils/appSettings.js';
import {
  applyPatches as applyGroupPatches,
  applySetTransform,
  axisTurn,
  cloneSet,
  expandToGroups,
  groupCollapse,
  groupParts,
  groupsOf,
  renameGroup,
  setPivot,
  setWorldBoxes,
  spotBesideBuild,
  ungroupParts,
  wholeGroupOf
} from './utils/partGroups.js';
import { connectedFrom, layersFrom } from './utils/jointLayers.js';
import {
  applyOps,
  createHistory,
  diffParts,
  headPosition,
  isHistory,
  loadHistory,
  moveTo as moveHistoryTo,
  recordStep,
  redo as redoHistory,
  stepById,
  undo as undoHistory,
  withExportStep
} from './utils/buildHistory.js';

const VEX_PITCH_MM = 12.7;

const VEX_COLORS = [
  '#64748b', // VEX Structural Slate Gray
  '#334155', // VEX Dark Charcoal
  '#2563eb', // VEX Connector Blue
  '#0d9488', // VEX Teal (3x Pin)
  '#dc2626', // VEX Competition Red
  '#f59e0b', // VEX Yellow / Amber
  '#16a34a', // VEX Green
  '#9333ea', // VEX Purple
  '#e2e8f0', // Metal / Silver
  '#f8fafc', // VEX Connector White
  '#1f2937'  // Tire / Rubber Black
];

const TIMELINE_KEY = 'vexiq_history_timeline_visible';
// This tab's id: its own saves come back over SSE and are skipped; other tabs' saves are taken
const EMPTY_IDS = [];
const TAB_ID = `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const EXPLODE_MODES = ['off', 'x', 'y', 'z', 'all'];
/** Explode always takes the robot apart every way: an older saved X, Y or Z direction opens as All. */
const explodeOn = (mode) => (mode === 'off' ? 'off' : 'all');
const EXPLODE_PLAY_MS = 2500; // the slider's play from 0% to 100% when Explode is opened by hand
const clamp01 = (n) => Math.min(1, Math.max(0, Number(n) || 0));
// What an explode plan depends on: the visible parts and where they are (openspec explode-view)
const explodeSignature = (parts) =>
  JSON.stringify(parts.filter((i) => i.visible !== false).map((i) => [i.instanceId, i.partId, i.position, i.rotation, i.groupId || null, i.socketAngleDeg || 0]));
const PROJECTIONS = ['perspective', 'orthographic'];
const VIEW_LAYOUTS = ['single', 'four', 'stereo'];
const VIEW_DIRECTIONS = ['+x', '-x', '+y', '-y', '+z', '-z'];
const PANELS_HIDDEN_KEY = 'vexiq.panelsHidden';
const LIBRARY_VIEW_KEY = 'vexiq.libraryView';
const RECENT_CATEGORY = 'Recent';
const TILE_TIP_DELAY_MS = 250;
/** "190 mm": the longest side of the part's box */
const sizeText = (part) => `${Math.round(Math.max(0, ...(part.bbox?.size || [])) * 10) / 10} mm`;
const TILE_TIP_IMAGE_DELAY_MS = 1000; // resting this long on a tile adds the large picture
const SETTINGS_KEY = 'vexiq.settings'; // fallback copy of the app settings when there is no bridge
const clampStereoDepth =(v) => Math.min(3, Math.max(0.25, Number(v) || 1));

/** Parts with pose patches ({ instanceId, position?, rotation?, socketAngleDeg? }) applied. */
const applyPatches = (parts, patches) => {
  if (!patches?.length) return parts;
  return parts.map((inst) => {
    const patch = patches.find((p) => p.instanceId === inst.instanceId);
    if (!patch) return inst;
    const { instanceId, ...fields } = patch;
    const updated = { ...inst, ...fields };
    if (fields.position) {
      updated.lastValidPosition = [...updated.position];
      updated.lastValidRotation = [...updated.rotation];
    }
    return updated;
  });
};

export default function App() {
  const [catalog, setCatalog] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');

  // Parts and their history change together: every change to the parts is recorded as a step
  const [build, setBuild] = useState(() => ({ instances: [], history: createHistory() }));
  const { instances, history } = build;
  // Selection (openspec outliner-part-groups): ordered ids, the last one is the primary part.
  // selectedId is the part when exactly one is selected, so single-part tools turn off for sets.
  const [selectedIds, setSelectedIds] = useState([]);
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  const primaryId = selectedIds.at(-1) ?? null;
  const setSelectedId = useCallback((id) => setSelectedIds(id ? [id] : []), []);
  // A saved or sent state's selection: selectedIds when given, else the older single selectedId
  const adoptSelection = useCallback((state) => {
    if (Array.isArray(state?.selectedIds)) setSelectedIds(state.selectedIds.filter(Boolean));
    else if (state?.selectedId !== undefined) setSelectedIds(state.selectedId ? [state.selectedId] : []);
  }, []);
  const [transformMode, setTransformMode] = useState('translate'); // 'translate' | 'rotate'
  // Select mode: a plain click in the 3D view adds or removes parts; never saved
  const [selectMode, setSelectMode] = useState(false);
  // Box select: a left-drag in the 3D view draws a box that selects parts; never saved
  const [boxSelect, setBoxSelect] = useState(false);
  const [snapPitchFactor, setSnapPitchFactor] = useState(0.5); // 1 = 12.7mm, 0.5 = 6.35mm, 0.25 = 3.175mm, 0 = Free
  const [rotationSnapDeg, setRotationSnapDeg] = useState(15); // 15, 45, 90, 0
  const [showGrid, setShowGrid] = useState(true);
  const [showConnectors, setShowConnectors] = useState(true);
  // Explode panel (openspec explode-view): the direction while open ('off' = closed), the slider
  // value (0 built .. 1 fully apart), whether the slider is playing, and the plan for the build
  const [explodeMode, setExplodeMode] = useState('off'); // 'off' | 'all'
  const [explodeAmount, setExplodeAmount] = useState(1);
  const [explodePlaying, setExplodePlaying] = useState(false);
  const [explodePlan, setExplodePlan] = useState(null); // { key, plan } for the build and direction
  const [explodeProgress, setExplodeProgress] = useState(null); // 0..1 while the server works out a plan
  const explodeModeRef = useRef(explodeMode);
  explodeModeRef.current = explodeMode;
  // The slider value saved with the view: follows the slider once it has been still for a moment, so
  // the play and drags don't save the build every frame
  const [savedExplodeAmount, setSavedExplodeAmount] = useState(1);
  useEffect(() => {
    const timer = setTimeout(() => setSavedExplodeAmount(explodeAmount), 400);
    return () => clearTimeout(timer);
  }, [explodeAmount]);
  const [focusTrigger, setFocusTrigger] = useState(0);
  // View options (openspec: view-options); saved with the viewport settings, never history steps
  const [projection, setProjection] = useState('perspective');
  const [viewLayout, setViewLayout] = useState('single');
  const [stereoCrossEyed, setStereoCrossEyed] = useState(false);
  const [stereoDepth, setStereoDepth] = useState(1);
  const [viewAlongTrigger, setViewAlongTrigger] = useState({ dir: null, n: 0 }); // one-shot camera turn
  const [immersive, setImmersive] = useState(false); // stereo full screen (not saved)
  // Side panels hidden for a wide view: a per-browser preference, not part of the build
  const [panelsHidden, setPanelsHidden] = useState(() => {
    try {
      return window.localStorage.getItem(PANELS_HIDDEN_KEY) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(PANELS_HIDDEN_KEY, panelsHidden ? '1' : '0');
    } catch {
      // storage unavailable: the choice just isn't remembered
    }
  }, [panelsHidden]);
  // Library list or grid: a per-browser preference, not part of the build
  const [libraryView, setLibraryView] = useState(() => {
    try {
      return window.localStorage.getItem(LIBRARY_VIEW_KEY) === 'grid' ? 'grid' : 'list';
    } catch {
      return 'list';
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(LIBRARY_VIEW_KEY, libraryView);
    } catch {
      // storage unavailable: the choice just isn't remembered
    }
  }, [libraryView]);
  // Parts recently added from the library, best first (part-library); per browser, not in the build
  const [recentEntries, setRecentEntries] = useState(() => {
    try {
      return loadRecent(window.localStorage);
    } catch {
      return [];
    }
  });
  const [tileTip, setTileTip] = useState(null); // { part, left, top } of the hovered grid tile
  const tileTipTimerRef = useRef(null);
  const tileTipImageTimerRef = useRef(null);
  const [shadows, setShadows] = useState(false); // optional soft shadows (render-shadows)
  const [ambientOcclusion, setAmbientOcclusion] = useState(false); // optional AO (render-ambient-occlusion)
  const [environmentReflections, setEnvironmentReflections] = useState(true); // optional studio environment reflections
  const [reflectionIntensity, setReflectionIntensity] = useState(0.75); // brightness/intensity of reflections (0 to 2)
  const [isLoadingMesh, setIsLoadingMesh] = useState(false);
  const [mcpConnected, setMcpConnected] = useState(false);

  // Manual Smart Assembly & Fastening UI State
  const [fastenPartnerId, setFastenPartnerId] = useState('ALL');
  const [fastenMaxPins, setFastenMaxPins] = useState(8);
  const [mateSourcePortId, setMateSourcePortId] = useState('');
  const [mateTargetInstanceId, setMateTargetInstanceId] = useState('');
  const [mateTargetPortId, setMateTargetPortId] = useState('');
  const [mateFlipAxis, setMateFlipAxis] = useState(false);
  const [mateRollDeg, setMateRollDeg] = useState(0);
  const [mateAxialOffsetMm, setMateAxialOffsetMm] = useState(0);
  const [gearTrainStartPortId, setGearTrainStartPortId] = useState('hole_1');
  const [gearTrainOuterBeamId, setGearTrainOuterBeamId] = useState('');
  const [gearTrainPreset, setGearTrainPreset] = useState('3x36T');
  const [gearTrainIncludeShafts, setGearTrainIncludeShafts] = useState(true);
  const [actionFeedback, setActionFeedback] = useState(null);
  // App settings (openspec app-settings): shared through /api/settings, a local copy as fallback
  const [settings, setSettings] = useState(() => {
    try {
      return normalizeSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'));
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  });
  // The build being worked on (openspec build-library): { id, name }, shared through the saved state
  const [currentBuild, setCurrentBuild] = useState(null);
  const currentBuildRef = useRef(null);
  currentBuildRef.current = currentBuild;
  const lastPostedBuildIdRef = useRef(null); // the build the bridge last got from this tab
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [viewMenuAt, setViewMenuAt] = useState(null); // { x, y } while the view menu is open
  const closeViewMenu = useCallback(() => setViewMenuAt(null), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const keepSettings = useCallback((next) => {
    const normalized = normalizeSettings(next);
    settingsRef.current = normalized;
    setSettings(normalized);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalized));
    } catch {
      // private mode: the bridge copy still applies
    }
    return normalized;
  }, []);
  /** Changes some settings: applied at once, saved for every tab and the MCP server. */
  const updateSettings = useCallback(
    (patch) => {
      const next = keepSettings({ ...settingsRef.current, ...patch });
      fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Client-Id': TAB_ID },
        body: JSON.stringify(next)
      }).catch(() => {});
    },
    [keepSettings]
  );
  useEffect(() => {
    if (!actionFeedback) return undefined;
    const timer = setTimeout(() => setActionFeedback(null), 4000);
    return () => clearTimeout(timer);
  }, [actionFeedback]);
  useEffect(() => {
    fetch('/api/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((loaded) => loaded && keepSettings(loaded))
      .catch(() => {});
  }, [keepSettings]);
  const [isRunningAction, setIsRunningAction] = useState(false);
  const [auditModalData, setAuditModalData] = useState(null);

  // The history the server last confirmed (its rev and the parts at that point), so a save built on
  // an older history is refused by the bridge and re-recorded on top instead of overwriting MCP steps
  const syncRef = useRef({ baseRev: undefined, baseInstances: [], postedHistory: null });

  // Timeline: shown or not (remembered in this browser), and a read-only preview of a past point
  const [timelineVisible, setTimelineVisible] = useState(() => {
    try {
      return localStorage.getItem(TIMELINE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [preview, setPreview] = useState(null); // { parts, info } while scrubbing or playing
  const [pickStatus, setPickStatus] = useState(null); // { text, tone } while picking a hole
  const previewRef = useRef(null);
  previewRef.current = preview;
  const handlePreview = useCallback((parts, info) => setPreview(parts ? { parts, info } : null), []);
  const noop = useCallback(() => {}, []);

  /**
   * Changes the parts and records the change as one history step (none when no build field changed,
   * e.g. the viewport updating overlap flags). meta: { label, source ('app' | 'assistant'), mergeKey }.
   */
  const setInstances = useCallback((updater, meta = {}) => {
    // A past point on the timeline is read-only
    if (previewRef.current) {
      setActionFeedback({ message: "This is a preview of an earlier point. Go to a step's end to edit.", isError: true });
      return;
    }
    const source = meta.source || 'app';
    setBuild((b) => {
      const next = typeof updater === 'function' ? updater(b.instances) : updater;
      if (next === b.instances) return b;
      const recorded = recordStep(b.history, b.instances, next, {
        source,
        label: meta.label,
        mergeKey: meta.mergeKey,
        linear: isLinearHistory(settingsRef.current)
      });
      return { instances: next, history: recorded.history };
    });
  }, []);

  /**
   * Takes the view options from a saved or pushed viewport. A new `viewAlongTrigger` turns the camera
   * only when `turnCamera` is set (an MCP push), never when a saved file is opened.
   */
  const applyViewOptions = useCallback((vp, { turnCamera = false } = {}) => {
    if (PROJECTIONS.includes(vp.projection)) setProjection(vp.projection);
    if (VIEW_LAYOUTS.includes(vp.viewLayout)) setViewLayout(vp.viewLayout);
    if (vp.stereoCrossEyed !== undefined) setStereoCrossEyed(Boolean(vp.stereoCrossEyed));
    if (vp.stereoDepth !== undefined) setStereoDepth(clampStereoDepth(vp.stereoDepth));
    if (vp.shadows !== undefined) setShadows(Boolean(vp.shadows));
    if (vp.ambientOcclusion !== undefined) setAmbientOcclusion(Boolean(vp.ambientOcclusion));
    if (vp.environmentReflections !== undefined) setEnvironmentReflections(Boolean(vp.environmentReflections));
    if (vp.reflectionIntensity !== undefined) setReflectionIntensity(Math.max(0, Math.min(2, Number(vp.reflectionIntensity) || 0.75)));
    if (Array.isArray(vp.attentionIds)) {
      setAttentionIds(vp.attentionIds);
      setChainRouteDialogOpen(vp.attentionIds.length > 0);
    }
    const trigger = vp.viewAlongTrigger;
    if (trigger && Number.isFinite(trigger.n)) {
      setViewAlongTrigger((prev) =>
        trigger.n === prev.n ? prev : { dir: turnCamera && VIEW_DIRECTIONS.includes(trigger.dir) ? trigger.dir : null, n: trigger.n }
      );
    }
  }, []);

  /** Takes parts (and history, when present) that came from the server: MCP, smart actions, startup. */
  const adoptServerState = useCallback((state) => {
    if (!state || !Array.isArray(state.instances)) return;
    // Another tab or the assistant switched or renamed the current build
    if (state.build?.id && (state.build.id !== currentBuildRef.current?.id || state.build.name !== currentBuildRef.current?.name)) {
      lastPostedBuildIdRef.current = state.build.id;
      setCurrentBuild({ id: state.build.id, name: state.build.name });
    }
    if (isHistory(state.history)) {
      const history = loadHistory(state.history, state.instances);
      syncRef.current = { baseRev: history.rev, baseInstances: state.instances, postedHistory: history };
      setBuild({ instances: state.instances, history });
    } else {
      // An older writer sent parts without history: record what it changed
      setBuild((b) => ({
        instances: state.instances,
        history: recordStep(b.history, b.instances, state.instances, {
          source: 'mcp',
          label: 'External change',
          linear: isLinearHistory(settingsRef.current)
        }).history
      }));
    }
  }, []);

  // Overlapping parts snap back to their last good pose; ones that never had one are dropped
  const moveBackLabel = (ops) => {
    const name = (op) => op.name || op.part?.label;
    const verb = ops.every((op) => op.op === 'remove') ? 'Cancel placement of' : 'Move back';
    return ops.length === 1 ? `${verb} ${name(ops[0])}` : `${verb} ${ops.length} parts`;
  };

  /**
   * Result of moving through the history (undo, redo, timeline): the parts, the history, and the
   * parts whose pose changed, so the viewport checks their overlap flags again.
   */
  const afterHistoryMove = (b, moved) => {
    if (!moved) return b;
    const ids = new Set();
    for (const stepId of [...moved.undone, ...moved.redone]) {
      for (const op of stepById(moved.history, stepId)?.ops || []) {
        if (op.op === 'add' || op.op === 'remove') ids.add(op.part.instanceId);
        else if (op.op === 'update' && (op.after.position || op.after.rotation)) ids.add(op.id);
      }
    }
    return { instances: moved.parts, history: moved.history, recheck: { ids: [...ids], rev: moved.history.rev } };
  };

  const handleUndo = useCallback(() => {
    setBuild((b) => afterHistoryMove(b, undoHistory(b.history, b.instances)));
  }, []);

  const handleRedo = useCallback(() => {
    setBuild((b) => afterHistoryMove(b, redoHistory(b.history, b.instances)));
  }, []);

  // Timeline: make any step (null = the start) the current one
  const handleMoveTo = useCallback((stepId) => {
    setBuild((b) => afterHistoryMove(b, moveHistoryTo(b.history, b.instances, stepId)));
  }, []);

  const toggleTimeline = () => {
    setTimelineVisible((visible) => {
      try {
        localStorage.setItem(TIMELINE_KEY, visible ? '0' : '1');
      } catch {
        // ignore
      }
      return !visible;
    });
  };

  const historyPosition = useMemo(() => headPosition(history), [history]);

  // Undo, redo or an MCP change can remove selected parts
  useEffect(() => {
    const ids = new Set(instances.map((i) => i.instanceId));
    if (selectedIds.some((id) => !ids.has(id))) setSelectedIds((prev) => prev.filter((id) => ids.has(id)));
  }, [instances, selectedIds]);

  const auditDialogRef = useRef(null);
  const suppressNextServerSyncRef = useRef(false);
  const webMcpContextRef = useRef(null);
  const flushMoverRef = useRef(null);

  const handleRegisterFlushMover = useCallback((fn) => {
    flushMoverRef.current = fn;
  }, []);

  // The viewport's screenshot renderer, used to answer the MCP server's capture_screenshot requests
  const screenshotRef = useRef(null);
  const waitForExplodeRef = useRef(async () => {}); // resolves once an open Explode panel shows its plan
  const handleRegisterScreenshot = useCallback((fn) => {
    screenshotRef.current = fn;
  }, []);

  // Fallback for browsers without <dialog closedby="any"> support
  useEffect(() => {
    const dialog = auditDialogRef.current;
    if (!dialog) return undefined;
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      const onDialogClick = (event) => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        const isDialogContent =
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width;
        if (isDialogContent) return;
        dialog.close();
      };
      dialog.addEventListener('click', onDialogClick);
      return () => dialog.removeEventListener('click', onDialogClick);
    }
    return undefined;
  }, []);

  // Load 478-part catalog + initial assembly state from MCP bridge (/api/assembly)
  useEffect(() => {
    Promise.all([
      fetch(`/catalog.json?t=${Date.now()}`).then((r) => r.json()),
      fetch('/api/assembly')
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
    ])
      .then(([catalogData, serverState]) => {
        setCatalog(catalogData);
        // A saved build with parts, or one emptied on purpose (its history has steps), is kept as is
        const hasSavedBuild =
          serverState &&
          Array.isArray(serverState.instances) &&
          (serverState.instances.length > 0 || serverState.history?.steps?.length > 0);
        if (hasSavedBuild) {
          suppressNextServerSyncRef.current = true;
          adoptServerState(serverState);
          adoptSelection(serverState);
          if (serverState.viewport) {
            if (serverState.viewport.transformMode) setTransformMode(serverState.viewport.transformMode);
            if (serverState.viewport.snapPitchFactor !== undefined) {
              setSnapPitchFactor(serverState.viewport.snapPitchFactor);
            }
            if (serverState.viewport.rotationSnapDeg !== undefined) {
              setRotationSnapDeg(serverState.viewport.rotationSnapDeg);
            }
            if (serverState.viewport.showGrid !== undefined) setShowGrid(serverState.viewport.showGrid);
            if (serverState.viewport.showConnectors !== undefined) {
              setShowConnectors(serverState.viewport.showConnectors);
            }
            if (EXPLODE_MODES.includes(serverState.viewport.explodeMode)) {
              // A saved open panel comes back at its slider value (1 when it has none), without playing
              setExplodeMode(explodeOn(serverState.viewport.explodeMode));
              setExplodeAmount(serverState.viewport.explodeAmount === undefined ? 1 : clamp01(serverState.viewport.explodeAmount));
            }
            applyViewOptions(serverState.viewport);
          }
        } else {
          const starter = buildStarterAssembly(catalogData);
          if (serverState) adoptServerState(serverState);
          setInstances(starter, { label: 'Load starter assembly' });
          setSelectedId(starter[1]?.instanceId || starter[0]?.instanceId || null);
        }
        chooseStartupBuild(serverState?.build);
      })
      .catch((err) => console.error('Failed to initialize catalog:', err));
  }, []);

  /**
   * The build the app opens with: the saved state's build when the library has it (the saved state
   * is the newest copy), else a new library entry for what was open: "Build #1" in an empty library,
   * which takes over the build saved before the library existed.
   */
  const startupBuildChosenRef = useRef(false);
  const chooseStartupBuild = async (savedBuild) => {
    // Once per page: the catalog load runs twice in development (React strict mode)
    if (startupBuildChosenRef.current) return;
    startupBuildChosenRef.current = true;
    let names = [];
    let known = false;
    if (libraryAvailable()) {
      try {
        const list = await listBuilds();
        names = list.map((b) => b.name);
        known = Boolean(savedBuild?.id && list.some((b) => b.id === savedBuild.id));
      } catch {
        // no library in this browser: the build still works, it just isn't listed
      }
    }
    if (known) {
      setCurrentBuild({ id: savedBuild.id, name: savedBuild.name });
      return;
    }
    const name = savedBuild?.name && !names.includes(savedBuild.name) ? savedBuild.name : nextBuildName(names);
    setCurrentBuild({ id: savedBuild?.id || newBuildId(), name });
  };

  // --- Auto-save to the library (openspec build-library) ------------------------------------------
  const autoSaveTimerRef = useRef(null);
  const latestForSaveRef = useRef(null);
  const SAVE_DELAY_MS = 1000;

  /** A small JPEG picture of the build for the library (null when the view isn't ready). */
  const makeThumbnail = useCallback(async () => {
    try {
      const png = screenshotRef.current?.({ view: 'iso', width: 240, height: 160 });
      if (!png) return null;
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 240;
      canvas.height = 160;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, 240, 160);
      ctx.drawImage(img, 0, 0, 240, 160);
      return canvas.toDataURL('image/jpeg', 0.72);
    } catch {
      return null;
    }
  }, []);

  /** Writes the current build to the library now (no-op without a library or a build). */
  const saveCurrentBuildNow = useCallback(async () => {
    clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = null;
    const data = latestForSaveRef.current;
    if (!data?.build || !libraryAvailable()) return;
    try {
      const existing = await getBuild(data.build.id);
      const thumbnail = document.visibilityState === 'hidden' ? existing?.thumbnail ?? null : (await makeThumbnail()) ?? existing?.thumbnail ?? null;
      await putBuild({
        id: data.build.id,
        name: data.build.name,
        createdAt: existing?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
        partCount: data.instances.length,
        thumbnail,
        instances: data.instances,
        history: data.history,
        viewport: data.viewport
      });
    } catch (err) {
      console.warn('Saving the build to the library failed:', err);
    }
  }, [makeThumbnail]);

  // Builds save themselves about a second after each change
  useEffect(() => {
    if (catalog.length === 0 || !currentBuild) return;
    latestForSaveRef.current = {
      build: currentBuild,
      instances,
      history,
      viewport: { transformMode, snapPitchFactor, rotationSnapDeg, showGrid, showConnectors, projection, viewLayout, stereoCrossEyed, stereoDepth, shadows, ambientOcclusion, environmentReflections, reflectionIntensity }
    };
    clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(saveCurrentBuildNow, SAVE_DELAY_MS);
  }, [catalog.length, currentBuild, instances, history, transformMode, snapPitchFactor, rotationSnapDeg, showGrid, showConnectors, projection, viewLayout, stereoCrossEyed, stereoDepth, shadows, ambientOcclusion, environmentReflections, reflectionIntensity, saveCurrentBuildNow]);

  // A pending save goes out when the tab is hidden or closed
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === 'hidden' && autoSaveTimerRef.current) saveCurrentBuildNow();
    };
    document.addEventListener('visibilitychange', flush);
    return () => document.removeEventListener('visibilitychange', flush);
  }, [saveCurrentBuildNow]);

  // Subscribe to real-time SSE updates pushed by the MCP Server
  useEffect(() => {
    const es = new EventSource('/api/assembly/events');
    es.onopen = () => setMcpConnected(true);
    es.onerror = () => setMcpConnected(false);
    es.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'settings') {
          if (msg.clientId !== TAB_ID) keepSettings(msg.settings);
          return;
        }
        if (msg.type === 'explode-progress') {
          if (msg.mode === explodeModeRef.current) setExplodeProgress(msg.fraction);
          return;
        }
        if (msg.type === 'screenshot-request') {
          await waitForExplodeRef.current();
          let reply;
          try {
            const png = screenshotRef.current?.(msg);
            const status = screenshotRef.current?.status?.();
            reply = png ? { requestId: msg.requestId, png, status } : { requestId: msg.requestId, error: 'The 3D view is not ready yet', status };
          } catch (err) {
            reply = { requestId: msg.requestId, error: err?.message || String(err) };
          }
          fetch('/api/assembly/screenshot-result', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reply)
          }).catch(() => {});
          return;
        }
        if (msg.source === 'browser' && (!msg.clientId || msg.clientId === TAB_ID)) return;
        const nextState = msg.state;
        if (nextState && Array.isArray(nextState.instances)) {
          suppressNextServerSyncRef.current = true;
          adoptServerState(nextState);
          adoptSelection(nextState);
          if (nextState.viewport) {
            const vp = nextState.viewport;
            if (vp.transformMode) setTransformMode(vp.transformMode);
            if (vp.snapPitchFactor !== undefined) setSnapPitchFactor(vp.snapPitchFactor);
            if (vp.rotationSnapDeg !== undefined) setRotationSnapDeg(vp.rotationSnapDeg);
            if (vp.showGrid !== undefined) setShowGrid(vp.showGrid);
            if (vp.showConnectors !== undefined) setShowConnectors(vp.showConnectors);
            // Only the assistant sets the explode from outside: another tab's save leaves this tab's
            // explode (and its play) alone
            if (msg.source !== 'browser' && EXPLODE_MODES.includes(vp.explodeMode)) {
              // Straight to the given value (1 when none is given), no play
              setExplodePlaying(false);
              setExplodeMode(explodeOn(vp.explodeMode));
              if (vp.explodeMode !== 'off') setExplodeAmount(vp.explodeAmount === undefined ? 1 : clamp01(vp.explodeAmount));
            }
            if (vp.focusTrigger !== undefined) setFocusTrigger(vp.focusTrigger);
            applyViewOptions(vp, { turnCamera: true });
          }
        }
      } catch {
        // ignore malformed SSE
      }
    };
    return () => es.close();
  }, []);

  // Sync browser changes back to localStorage and the MCP bridge (/api/assembly)
  useEffect(() => {
    if (catalog.length === 0) return;
    if (suppressNextServerSyncRef.current) {
      suppressNextServerSyncRef.current = false;
      return;
    }

    // History goes along only when it changed since the last save; the bridge keeps it otherwise
    const base = syncRef.current;
    // Switching builds (New, Starter, Open, Delete) replaces the whole saved state, so it goes
    // without the history check that guards edits of the same build against another writer
    const switching = Boolean(currentBuild) && currentBuild.id !== lastPostedBuildIdRef.current;
    if (currentBuild) lastPostedBuildIdRef.current = currentBuild.id;
    const sendHistory = switching || history !== base.postedHistory;
    if (sendHistory) {
      syncRef.current = { baseRev: history.rev, baseInstances: instances, postedHistory: history };
    }
    const postedInstances = instances;
    fetch('/api/assembly', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-mcp-source': 'browser',
        'x-client-id': TAB_ID
      },
      body: JSON.stringify({
        version: '1.0',
        ...(switching ? {} : { baseHistoryRev: base.baseRev }),
        ...(sendHistory ? { history } : {}),
        ...(currentBuild ? { build: currentBuild } : {}),
        selectedId: primaryId,
        selectedIds,
        viewport: {
          transformMode,
          snapPitchFactor,
          rotationSnapDeg,
          showGrid,
          showConnectors,
          explodeMode,
          explodeAmount: savedExplodeAmount,
          focusTrigger,
          projection,
          viewLayout,
          stereoCrossEyed,
          stereoDepth,
          viewAlongTrigger,
          shadows,
          ambientOcclusion,
          environmentReflections,
          reflectionIntensity
        },
        instances
      })
    })
      .then(async (res) => {
        if (res.status !== 409) return;
        // Another writer saved first: take the saved build, then put this tab's change on top of it
        const { state } = await res.json();
        if (!state || !isHistory(state.history)) return;
        adoptServerState(state);
        if (!sendHistory) return;
        const newSteps = history.steps.filter((st) => !stepById(state.history, st.id));
        if (newSteps.length === 0) {
          // Only moved through the history (undo, redo, timeline): make the same move on the saved one
          if (history.headId === null || stepById(state.history, history.headId)) {
            setBuild((b) => afterHistoryMove(b, moveHistoryTo(b.history, b.instances, history.headId)));
          }
          return;
        }
        // New edits: record what they changed as one step on top
        const ops = diffParts(base.baseInstances, postedInstances);
        if (ops.length > 0) {
          setInstances((prev) => applyOps(prev, ops), { label: newSteps.at(-1).label, source: newSteps.at(-1).source });
        }
      })
      .catch(() => {
        // ignore offline
      });
  }, [
    catalog.length,
    instances,
    history,
    selectedIds,
    transformMode,
    snapPitchFactor,
    rotationSnapDeg,
    showGrid,
    showConnectors,
    explodeMode,
    savedExplodeAmount,
    focusTrigger,
    projection,
    viewLayout,
    stereoCrossEyed,
    stereoDepth,
    viewAlongTrigger,
    shadows,
    ambientOcclusion,
    environmentReflections,
    reflectionIntensity,
    currentBuild
  ]);

  const catalogMap = useMemo(() => {
    const map = new Map();
    for (const item of catalog) {
      map.set(item.id, item);
    }
    return map;
  }, [catalog]);

  const categories = useMemo(() => {
    const counts = new Map();
    counts.set('All', catalog.length);
    for (const p of catalog) {
      counts.set(p.category, (counts.get(p.category) || 0) + 1);
    }
    return Array.from(counts.entries());
  }, [catalog]);

  // Recent entries whose part is still in the catalog, in score order
  const recentParts = useMemo(
    () => recentEntries.map((e) => catalogMap.get(e.id)).filter(Boolean),
    [recentEntries, catalogMap]
  );

  const filteredCatalog = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const source = activeCategory === RECENT_CATEGORY ? recentParts : catalog;
    return source.filter((part) => {
      if (activeCategory !== 'All' && activeCategory !== RECENT_CATEGORY && part.category !== activeCategory) {
        return false;
      }
      if (!q) return true;
      return (
        part.name.toLowerCase().includes(q) ||
        part.partNumber.toLowerCase().includes(q) ||
        part.category.toLowerCase().includes(q)
      );
    });
  }, [catalog, recentParts, searchQuery, activeCategory]);

  const selectedInstance = useMemo(
    () => instances.find((i) => i.instanceId === selectedId) || null,
    [instances, selectedId]
  );

  const selectedPartMeta = useMemo(
    () => (selectedInstance ? catalogMap.get(selectedInstance.partId) : null),
    [selectedInstance, catalogMap]
  );

  // The Inspector header: one part (label; catalog name · part number, in <group>), a group (name; N parts)
  // or a loose set (N parts selected)
  const selectionTitle = useMemo(() => {
    if (selectedIds.length === 0) return null;
    const allGroups = groupsOf(instances);
    if (selectedInstance) {
      const group = selectedInstance.groupId ? allGroups.get(selectedInstance.groupId) : null;
      const catalogLine = selectedPartMeta ? `${selectedPartMeta.name} · ${selectedPartMeta.partNumber}` : '';
      return { name: selectedInstance.label, sub: [catalogLine, group ? `in ${group.name}` : ''].filter(Boolean).join(' · ') };
    }
    const group = wholeGroupOf(instances, selectedIds, allGroups);
    if (group) return { name: group.name, sub: `${group.ids.length} parts` };
    return { name: `${selectedIds.length} parts selected`, sub: '' };
  }, [instances, selectedIds, selectedInstance, selectedPartMeta]);

  // The sample starter (src/starters.js); File → Starter lists every starter
  function buildStarterAssembly(catalogList) {
    return starterById('sample').build(catalogList);
  }

  // keep: an id or a list of ids left where they are (the parts being selected)
  const resolveIntersectingInstances = (list, keep = null) => {
    const kept = new Set(Array.isArray(keep) ? keep : keep ? [keep] : []);
    // Nothing to move back: keep the same list, so a plain selection isn't treated as a build change
    if (!list.some((inst) => inst.isIntersecting && !kept.has(inst.instanceId))) return list;
    const out = [];
    for (const inst of list) {
      if (kept.has(inst.instanceId)) {
        out.push(inst);
        continue;
      }
      if (inst.isIntersecting) {
        if (inst.lastValidPosition && inst.lastValidRotation) {
          out.push({
            ...inst,
            position: [...inst.lastValidPosition],
            rotation: [...inst.lastValidRotation],
            isIntersecting: false
          });
        }
      } else {
        out.push(inst);
      }
    }
    return out;
  };

  /**
   * Select a part. A grouped part brings its whole group unless `exact` (an Outliner row inside a folder).
   * `additive` (Shift+click, Select mode) adds the part, or removes it when it is already selected.
   */
  const handleSelectInstance = (nextId, { additive = false, exact = false } = {}) => {
    const picked = !nextId ? [] : exact ? [nextId] : expandToGroups([nextId], instances);
    let next = picked;
    if (additive) {
      const all = picked.length > 0 && picked.every((id) => selectedIds.includes(id));
      next = all
        ? selectedIds.filter((id) => !picked.includes(id))
        : [...selectedIds.filter((id) => !picked.includes(id)), ...picked];
    }
    setInstances((prev) => resolveIntersectingInstances(prev, next), { label: moveBackLabel });
    setSelectedIds(next);
  };

  // --- Select menu (openspec outliner-part-groups) ---
  const groups = useMemo(() => groupsOf(instances), [instances]);
  const selectedGroupIds = useMemo(() => {
    const byId = new Map(instances.map((i) => [i.instanceId, i]));
    return [...new Set(selectedIds.map((id) => byId.get(id)?.groupId).filter((g) => groups.has(g)))];
  }, [instances, selectedIds, groups]);

  const changeSelection = (next) => {
    setInstances((prev) => resolveIntersectingInstances(prev, next), { label: moveBackLabel });
    setSelectedIds(next);
  };
  const handleSelectAll = () => changeSelection(instances.filter((i) => i.visible !== false).map((i) => i.instanceId));
  const handleSelectNone = () => changeSelection([]);
  const handleInvertSelection = () =>
    changeSelection(instances.filter((i) => i.visible !== false && !selectedIds.includes(i.instanceId)).map((i) => i.instanceId));

  // The joints between the parts as they are now (unsaved drags included), from the bridge's audit code
  // `pinnedOnly`: only pins, shafts and pegs seated in holes join parts (no gear meshes or parts that only touch)
  const fetchJointGraph = async (parts, { pinnedOnly = false } = {}) => {
    const res = await fetch('/api/assembly/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'joint_graph', state: { instances: parts }, params: { pinnedOnly } })
    });
    const data = await res.json().catch(() => null);
    if (!data?.ok || !data.graph) throw new Error(data?.error || `the server replied ${res.status}`);
    return data.graph;
  };

  // --- Explode (openspec explode-view) -----------------------------------------------------------
  /** Opens the panel by hand: the slider plays from 0% once the take-apart is worked out. */
  const openExplode = () => {
    setExplodeAmount(0);
    setExplodePlaying(true);
    setExplodeMode('all');
  };
  const closeExplode = () => {
    setExplodePlaying(false);
    setExplodeMode('off');
  };
  const toggleExplode = () => (explodeMode === 'off' ? openExplode() : closeExplode());

  const partCount = (n) => `${n} part${n === 1 ? '' : 's'}`;

  const handleSelectConnected = async () => {
    if (selectedIds.length === 0) {
      setActionFeedback({ message: 'Select a part first.', isError: true });
      return;
    }
    const parts = instances;
    const seeds = selectedIds;
    try {
      const graph = await fetchJointGraph(parts);
      const next = connectedFrom(graph, seeds, { collapse: groupCollapse(parts) });
      changeSelection(next);
      setActionFeedback({ message: `${partCount(next.length)} selected.`, isError: false });
    } catch (err) {
      setActionFeedback({ message: `Couldn't find connected parts: ${err.message}`, isError: true });
    }
  };

  /**
   * Shift+wheel: grow the selection one layer of joined parts (+1) or take the last layer off (-1).
   * Shift+Ctrl/Cmd+wheel (`pinnedOnly`) does the same through pins, shafts and pegs in holes only.
   * Remembers where it started until the selection changes some other way (its last ids no longer
   * match) or the other kind of step is used, which starts again from the current selection.
   */
  const expandRef = useRef(null); // { layers, depth, lastIds, pinnedOnly } or { pending: true } while the joints load
  const handleExpandSelection = async (dir, { pinnedOnly = false } = {}) => {
    let st = expandRef.current;
    const current = selectedIds;
    const same = (a, b) => a.length === b.length && a.every((id, i) => id === b[i]);
    if (!st || (!st.pending && (!same(st.lastIds, current) || st.pinnedOnly !== pinnedOnly))) {
      if (dir < 0 || current.length === 0) return;
      st = { pending: true, pinnedOnly };
      expandRef.current = st;
      try {
        const graph = await fetchJointGraph(instances, { pinnedOnly });
        st.layers = layersFrom(graph, current, { collapse: groupCollapse(instances) });
        st.depth = 0;
        st.pending = false;
      } catch (err) {
        expandRef.current = null;
        setActionFeedback({ message: `Couldn't find connected parts: ${err.message}`, isError: true });
        return;
      }
      if (expandRef.current !== st) return;
    } else if (st.pending) {
      return;
    }
    const depth = Math.max(0, Math.min(st.layers.length - 1, st.depth + dir));
    if (depth === st.depth && st.lastIds) return;
    st.depth = depth;
    st.lastIds = st.layers.slice(0, depth + 1).flat();
    changeSelection(st.lastIds);
    setActionFeedback({ message: `${st.pinnedOnly ? 'Pinned layer' : 'Layer'} ${depth} · ${partCount(st.lastIds.length)}`, isError: false });
  };

  // A folder's hide or lock button: every part of the group, one step
  const handleSetGroupFlag = (group, field, value) => {
    const verb = field === 'visible' ? (value ? 'Show' : 'Hide') : value ? 'Lock' : 'Unlock';
    const members = new Set(group.ids);
    setInstances((prev) => prev.map((i) => (members.has(i.instanceId) ? { ...i, [field]: value } : i)), {
      label: `${verb} ${group.name}`
    });
  };

  // --- A set of parts: a group or a loose multi-selection, moved and turned as one ---
  const isSet = selectedIds.length > 1;
  const selectionGroup = useMemo(() => wholeGroupOf(instances, selectedIds, groups), [instances, selectedIds, groups]);
  const setName = selectionGroup ? selectionGroup.name : partCount(selectedIds.length);
  const setParts = useMemo(() => {
    const wanted = new Set(selectedIds);
    return instances.filter((i) => wanted.has(i.instanceId));
  }, [instances, selectedIds]);
  const setCentre = useMemo(
    () => (isSet ? setPivot(instances, selectedIds, setWorldBoxes(instances, selectedIds, (i) => catalogMap.get(i.partId)?.bbox)) : null),
    [isSet, instances, selectedIds, catalogMap]
  );
  const setMoveBlocked = () => {
    const message = setParts.some((p) => p.locked) ? 'Part is locked' : setParts.some((p) => p.visible === false) ? 'Some parts are hidden' : null;
    if (message) setActionFeedback({ message, isError: true });
    return Boolean(message);
  };
  // One step for the whole set (also the viewport's drag of a set)
  const handleUpdateSet = (ids, patches, meta = {}) => {
    if (!patches.length) return;
    setInstances((prev) => applyGroupPatches(prev, patches), meta);
  };
  const setKey = selectedIds.join(',');
  const moveSetBy = (deltaPos, mergeKey) => {
    if (setMoveBlocked()) return;
    handleUpdateSet(selectedIds, applySetTransform(instances, selectedIds, setCentre, { deltaPos }), {
      label: `Move ${setName}`,
      mergeKey: `${mergeKey}:${setKey}`
    });
  };
  const handleMoveSetCentreTo = (axis, value) => {
    const delta = [0, 0, 0];
    delta[axis] = value - setCentre[axis];
    if (Math.abs(delta[axis]) < 1e-6) return;
    moveSetBy(delta, `set-position-${axis}`);
  };
  const handleTurnSet90 = (axis) => {
    if (setMoveBlocked()) return;
    handleUpdateSet(selectedIds, applySetTransform(instances, selectedIds, setCentre, { deltaQuat: axisTurn('XYZ'[axis], 90) }), {
      label: `Turn ${setName}`
    });
  };
  const handleSetSetFlag = (field, value) => {
    const verb = field === 'visible' ? (value ? 'Show' : 'Hide') : value ? 'Lock' : 'Unlock';
    const wanted = new Set(selectedIds);
    setInstances((prev) => prev.map((i) => (wanted.has(i.instanceId) ? { ...i, [field]: value } : i)), { label: `${verb} ${setName}` });
  };
  // Returns false when the name is refused (empty)
  const handleRenameGroup = (name) => {
    if (!selectionGroup) return false;
    try {
      const renamed = renameGroup(instances, selectionGroup.id, name);
      setInstances((prev) => applyGroupPatches(prev, renamed.patches), { label: `Rename ${renamed.oldName} to ${renamed.name}` });
      return true;
    } catch (err) {
      setActionFeedback({ message: err.message, isError: true });
      return false;
    }
  };

  // A box drawn in the 3D view: its parts (with their whole groups) replace the selection, or are added
  // to it with Shift or in Select mode
  const handleBoxSelect = (ids, { additive }) => {
    const picked = expandToGroups(ids, instances);
    const next = additive ? [...selectedIds.filter((id) => !picked.includes(id)), ...picked] : picked;
    changeSelection(next);
    if (picked.length === 0) setActionFeedback({ message: 'No parts in the box.', isError: false });
  };

  const handleGroupSelected = () => {
    if (selectedIds.length < 2) {
      setActionFeedback({ message: 'Select two or more parts to make a group.', isError: true });
      return;
    }
    const { name, patches } = groupParts(instances, selectedIds);
    setInstances((prev) => applyGroupPatches(prev, patches), { label: `Group ${selectedIds.length} parts as ${name}` });
    setActionFeedback({ message: `Grouped ${selectedIds.length} parts as ${name}.`, isError: false });
  };

  const handleUngroupSelected = () => {
    const { groupIds, patches } = ungroupParts(instances, selectedIds);
    if (groupIds.length === 0) {
      setActionFeedback({ message: 'No group is selected.', isError: true });
      return;
    }
    const label = groupIds.length === 1 ? `Ungroup ${groups.get(groupIds[0]).name}` : `Ungroup ${groupIds.length} groups`;
    setInstances((prev) => applyGroupPatches(prev, patches), { label });
  };

  const handleRevertSelectedIntersection = () => {
    if (!selectedInstance) return;
    setInstances((prev) => resolveIntersectingInstances(prev, null), { label: moveBackLabel });
    if (!selectedInstance.lastValidPosition) {
      setSelectedId(null);
    }
  };

  const handleAddPart = (part, customPos = null, customColor = null, meta = {}) => {
    if (previewRef.current) {
      setActionFeedback({ message: "This is a preview of an earlier point. Go to a step's end to edit.", isError: true });
      return null;
    }
    if (explodeMode !== 'off') setExplodeMode('off');
    const samePartCount = instances.filter((i) => i.partId === part.id).length;
    const basePos =
      customPos ||
      (selectedInstance
        ? [
            Number((selectedInstance.position[0] + VEX_PITCH_MM * 2).toFixed(3)),
            selectedInstance.position[1],
            selectedInstance.position[2]
          ]
        : // In front of the build, so it lands in view however many parts there are
          spotBesideBuild(instances, part.bbox, (i) => catalogMap.get(i.partId)?.bbox, VEX_PITCH_MM) || [0, VEX_PITCH_MM, 0]);

    const newInst = {
      instanceId: `inst-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      partId: part.id,
      label: `${part.name} #${samePartCount + 1}`,
      position: basePos,
      rotation: [0, 0, 0],
      lastValidPosition: null,
      lastValidRotation: null,
      isIntersecting: false,
      color: customColor || part.defaultColor,
      visible: true,
      locked: false
    };

    setInstances((prev) => [...resolveIntersectingInstances(prev, null), newInst], {
      label: `Add ${newInst.label}`,
      ...meta
    });
    setSelectedId(newInst.instanceId);
    return newInst;
  };

  // Adding by clicking a library part also counts as a use of it (the Recent list)
  const handleLibraryAdd = (part) => {
    const added = handleAddPart(part);
    if (!added) return;
    setRecentEntries((prev) => {
      const next = recordUse(prev, part.id);
      try {
        saveRecent(window.localStorage, next);
      } catch {
        // storage unavailable: the list just isn't kept
      }
      return next;
    });
  };

  const showTileTip = (part, el) => {
    clearTimeout(tileTipTimerRef.current);
    clearTimeout(tileTipImageTimerRef.current);
    tileTipTimerRef.current = setTimeout(() => {
      const tile = el.getBoundingClientRect();
      const panel = el.closest('.panel-left')?.getBoundingClientRect();
      setTileTip({
        part,
        centerX: tile.left + tile.width / 2,
        top: tile.bottom + 6,
        bottom: tile.top - 6,
        minX: (panel?.left ?? 0) + 8,
        maxX: (panel?.right ?? window.innerWidth) - 8,
        panelBottom: panel?.bottom ?? window.innerHeight,
        big: false
      });
      tileTipImageTimerRef.current = setTimeout(() => {
        setTileTip((tip) => (tip ? { ...tip, big: true } : tip));
      }, TILE_TIP_IMAGE_DELAY_MS);
    }, TILE_TIP_DELAY_MS);
  };
  const hideTileTip = () => {
    clearTimeout(tileTipTimerRef.current);
    clearTimeout(tileTipImageTimerRef.current);
    setTileTip(null);
  };

  // meta.extraPatches: other parts changed by the same placement (a shaft group turned to mesh, a
  // motor hub turned to fit), recorded in the same history step
  const handleUpdateTransform = (instanceId, patch, meta = {}) => {
    const { extraPatches = [], ...stepMeta } = meta || {};
    setInstances(
      (prev) => applyPatches(prev.map((inst) => {
          if (inst.instanceId !== instanceId) return inst;
          const updated = { ...inst, ...patch };
          if (updated.isIntersecting === false) {
            updated.lastValidPosition = [...updated.position];
            updated.lastValidRotation = [...updated.rotation];
          }
          return updated;
        }), extraPatches),
      stepMeta
    );
  };

  const handleDuplicateSelected = () => {
    if (selectedIds.length > 1) {
      // A set: copies one pitch along X, keeping their places relative to one another; the copies are selected
      const copies = cloneSet(instances, selectedIds, [VEX_PITCH_MM, 0, 0]);
      setInstances((prev) => [...resolveIntersectingInstances(prev, null), ...copies], { label: `Clone ${setName}` });
      setSelectedIds(copies.map((c) => c.instanceId));
      return;
    }
    if (!selectedInstance) return;
    const copyPos = [
      Number((selectedInstance.position[0] + VEX_PITCH_MM).toFixed(3)),
      selectedInstance.position[1],
      selectedInstance.position[2]
    ];
    const copy = {
      ...selectedInstance,
      instanceId: `inst-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label: `${selectedInstance.label} (Copy)`,
      position: copyPos,
      lastValidPosition: null,
      lastValidRotation: null,
      isIntersecting: false
    };
    setInstances((prev) => [...resolveIntersectingInstances(prev, null), copy], {
      label: `Duplicate ${selectedInstance.label}`
    });
    setSelectedId(copy.instanceId);
  };

  // Ctrl/Cmd+double-click on a hole in the viewport: add a copy of a part seated in it, as one history
  // step, keeping the original selected. Returns the copy's id.
  const handleInsertCopy = (sourceId, pose, receivingLabel) => {
    const { extraPatches = [], notes = [] } = pose;
    if (previewRef.current) return null;
    const source = instances.find((i) => i.instanceId === sourceId);
    const part = source ? catalogMap.get(source.partId) : null;
    if (!source || !part) return null;
    const labels = new Set(instances.map((i) => i.label));
    let n = instances.filter((i) => i.partId === part.id).length + 1;
    while (labels.has(`${part.name} #${n}`)) n++;
    const copy = {
      instanceId: `inst-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      partId: part.id,
      label: `${part.name} #${n}`,
      position: pose.position,
      rotation: pose.rotation,
      ...(pose.socketAngleDeg ? { socketAngleDeg: pose.socketAngleDeg } : {}),
      lastValidPosition: [...pose.position],
      lastValidRotation: [...pose.rotation],
      isIntersecting: false,
      color: source.color || part.defaultColor,
      visible: true,
      locked: false
    };
    // The placement step's notes name the copy '{copy}' before it has a label
    const noteText = notes.map((n) => n.replaceAll('{copy}', copy.label)).join('. ');
    const withNotes = (text) => (noteText ? `${text}. ${noteText}` : text);
    setInstances((prev) => [...applyPatches(prev, extraPatches), copy], {
      label: withNotes(`Insert copy of ${source.label} into ${receivingLabel}`)
    });
    setActionFeedback({ message: withNotes(`Inserted ${copy.label} into ${receivingLabel}`), isError: false });
    return copy.instanceId;
  };

  const handleDeleteSelected = () => {
    if (selectedIds.length === 0) return;
    const doomed = new Set(selectedIds);
    setInstances((prev) => prev.filter((i) => !doomed.has(i.instanceId)), selectedIds.length > 1 ? { label: `Delete ${setName}` } : {});
    setSelectedIds([]);
  };

  // Right-click on the selected part in the viewport: switch between Move and Rotate
  const handleToggleRotateRequest = () => {
    if (selectedIds.length === 0) return;
    const parts = instances.filter((i) => selectedIds.includes(i.instanceId));
    if (parts.some((p) => p.locked)) {
      setActionFeedback({ message: 'Part is locked', isError: true });
      return;
    }
    if (explodeMode !== 'off') {
      setActionFeedback({ message: "Can't rotate in Explode view", isError: true });
      return;
    }
    setTransformMode((mode) => (mode === 'rotate' ? 'translate' : 'rotate'));
  };

  const handleRotate90 = (axisIndex) => {
    if (!selectedInstance) return;
    const nextRot = [...selectedInstance.rotation];
    nextRot[axisIndex] = Number(((nextRot[axisIndex] + 90) % 360).toFixed(2));
    handleUpdateTransform(selectedInstance.instanceId, { rotation: nextRot });
  };

  const handleNudgePitch = (axisIndex, dirSign) => {
    if (!selectedInstance) return;
    const pitchStep = snapPitchFactor > 0 ? snapPitchFactor : 0.25;
    const deltaMm = dirSign * pitchStep * VEX_PITCH_MM;

    if (flushMoverRef.current) {
      const resolved = flushMoverRef.current(selectedInstance.instanceId, axisIndex, deltaMm);
      if (resolved) {
        handleUpdateTransform(
          selectedInstance.instanceId,
          { position: resolved.position, isIntersecting: resolved.isIntersecting },
          { mergeKey: `nudge:${selectedInstance.instanceId}` }
        );
        if (resolved.snappedFlush) {
          setActionFeedback({
            message: `Snapped flush to physical contact boundary (${resolved.position[axisIndex]}mm).`,
            isError: false
          });
        }
        return;
      }
    }

    const nextPos = [...selectedInstance.position];
    nextPos[axisIndex] = Number((nextPos[axisIndex] + deltaMm).toFixed(3));
    handleUpdateTransform(
      selectedInstance.instanceId,
      { position: nextPos },
      { mergeKey: `nudge:${selectedInstance.instanceId}` }
    );
  };

  // Keep WebMCP context ref up to date and register WebMCP tools on mount
  webMcpContextRef.current = {
    mcpEnabled: settings.mcpEnabled,
    catalog,
    instances,
    selectedId: primaryId,
    selectedIds,
    placePartAt: (part, pos, color) => handleAddPart(part, pos, color, { source: 'assistant' }),
    configureViewport: ({
      transformMode: tm,
      showGrid: sg,
      showConnectors: sc,
      explodeMode: em,
      explodeAmount: ea,
      focusCamera,
      projection: pj,
      viewLayout: vl,
      stereoCrossEyed: sx,
      stereoDepth: sd,
      viewAlong,
      shadows: sh,
      ambientOcclusion: ao,
      environmentReflections: er,
      reflectionIntensity: ri
    }) => {
      if (tm) setTransformMode(tm);
      if (sg !== undefined) setShowGrid(Boolean(sg));
      if (sc !== undefined) setShowConnectors(Boolean(sc));
      if ((em && EXPLODE_MODES.includes(em)) || ea !== undefined) {
        // From the assistant: straight to the given value (1 when only a direction is given), no play
        setExplodePlaying(false);
        if (em) setExplodeMode(explodeOn(em));
        if (em !== 'off') setExplodeAmount(ea === undefined ? 1 : clamp01(ea));
        if (!em && explodeMode === 'off') setExplodeMode('all');
      }
      if (focusCamera) setFocusTrigger((c) => c + 1);
      if (PROJECTIONS.includes(pj)) setProjection(pj);
      if (VIEW_LAYOUTS.includes(vl)) setViewLayout(vl);
      if (sx !== undefined) setStereoCrossEyed(Boolean(sx));
      if (sd !== undefined) setStereoDepth(clampStereoDepth(sd));
      if (VIEW_DIRECTIONS.includes(viewAlong)) turnViewAlong(viewAlong);
      if (sh !== undefined) setShadows(Boolean(sh));
      if (ao !== undefined) setAmbientOcclusion(Boolean(ao));
      if (er !== undefined) setEnvironmentReflections(Boolean(er));
      if (ri !== undefined) setReflectionIntensity(Math.max(0, Math.min(2, Number(ri) || 0.75)));
    },
    resetAssembly: (mode) => {
      setExplodeMode('off');
      if (mode === 'starter') {
        const starter = buildStarterAssembly(catalog);
        setInstances(starter, { label: 'Load starter assembly', source: 'assistant' });
        setSelectedId(starter[0]?.instanceId || null);
      } else {
        setInstances([], { label: 'Clear assembly', source: 'assistant' });
        setSelectedId(null);
      }
    }
  };

  useEffect(() => {
    return registerVexIqWebMcpTools(webMcpContextRef);
  }, []);

  // Turns the camera to look along an axis ('+x' looks from the +X side), once
  const turnViewAlong = (dir) => setViewAlongTrigger((prev) => ({ dir, n: prev.n + 1 }));

  // Stereo full screen: the viewport covers the window (and the screen, when the browser allows it)
  const enterImmersive = () => {
    setImmersive(true);
    document.documentElement.requestFullscreen?.().catch(() => {
      // Refused (e.g. inside a frame): the viewport still covers the whole window
    });
  };
  useEffect(() => {
    if (immersive && viewLayout !== 'stereo') setImmersive(false);
  }, [immersive, viewLayout]);
  useEffect(() => {
    if (!immersive && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }, [immersive]);
  useEffect(() => {
    // The browser's own Esc (or F11) leaves full screen: drop the overlay too
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) setImmersive(false);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  // The explode plan for the build as it is now, from the bridge, which works
  // it out with the engine's collision meshes; worked out again after any change to the build
  const explodeKey = useMemo(
    () => (explodeMode === 'off' ? null : `${explodeMode}|${explodeSignature(instances)}`),
    [explodeMode, instances]
  );
  const explodeReady = Boolean(explodeKey && explodePlan?.key === explodeKey);
  useEffect(() => {
    if (!explodeKey || explodePlan?.key === explodeKey) return undefined;
    let cancelled = false;
    const mode = explodeMode;
    const parts = instances;
    setExplodeProgress(null);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/assembly/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'explode_plan', state: { instances: parts }, params: { mode } })
        });
        const data = await res.json().catch(() => null);
        if (!data?.ok || !data.plan) throw new Error(data?.error || `the server replied ${res.status}`);
        if (!cancelled) setExplodePlan({ key: explodeKey, plan: data.plan });
      } catch (err) {
        if (!cancelled) setActionFeedback({ message: `Couldn't work out the explode: ${err.message}`, isError: true });
      }
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [explodeKey]);

  // The play: 0% to 100% over EXPLODE_PLAY_MS, from wherever the slider is, once the plan is ready
  const explodeAmountRef = useRef(explodeAmount);
  explodeAmountRef.current = explodeAmount;
  useEffect(() => {
    if (!explodePlaying || !explodeReady) return undefined;
    const from = performance.now() - explodeAmountRef.current * EXPLODE_PLAY_MS;
    let frame = 0;
    const tick = (now) => {
      const amount = Math.min(1, (now - from) / EXPLODE_PLAY_MS);
      setExplodeAmount(amount);
      if (amount < 1) frame = requestAnimationFrame(tick);
      else setExplodePlaying(false);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [explodePlaying, explodeReady, explodeMode]);
  useEffect(() => {
    if (explodeMode === 'off') setExplodePlaying(false);
  }, [explodeMode]);

  // A screenshot waits until an open Explode panel's plan is worked out and shown
  const explodeShownRef = useRef(true);
  explodeShownRef.current = explodeMode === 'off' || explodeReady;
  waitForExplodeRef.current = async () => {
    const until = Date.now() + 30000;
    while (!explodeShownRef.current && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  };

  // Global keyboard shortcuts for 3D Modeler
  useEffect(() => {
    const onKeyDown = (e) => {
      // Esc in full screen only leaves full screen (no deselect, no Explode change)
      if (immersive && e.key === 'Escape') {
        e.preventDefault();
        setImmersive(false);
        return;
      }
      const active = document.activeElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(active?.tagName) || active?.isContentEditable) {
        return;
      }
      // A dialog (Settings, Audit) takes the keys while it is open: Esc closes it, nothing else
      if (document.querySelector('dialog[open]')) return;
      const key = e.key.toLowerCase();
      // Undo: Ctrl/Cmd+Z. Redo: Shift+Ctrl/Cmd+Z or Ctrl+Y
      const mod = e.metaKey || e.ctrlKey;
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if (e.ctrlKey && key === 'y') {
        e.preventDefault();
        handleRedo();
        return;
      }
      // View keys only move the camera, so they also work while a past point is shown
      if (!mod && !e.altKey) {
        if (key === 'p') {
          setProjection((prev) => (prev === 'perspective' ? 'orthographic' : 'perspective'));
          return;
        }
        const axis = { Digit1: 'x', Digit2: 'y', Digit3: 'z' }[e.code];
        if (axis) {
          e.preventDefault();
          turnViewAlong(`${e.shiftKey ? '-' : '+'}${axis}`);
          return;
        }
      }
      // Nothing else edits or selects while a past point is shown
      if (previewRef.current) return;
      if (mod && key === 'a') {
        e.preventDefault();
        handleSelectAll();
        return;
      }
      if (!mod && !e.altKey && key === 'b') {
        setBoxSelect((on) => !on);
        return;
      }
      if (!mod && !e.altKey && key === 'c') {
        handleSelectConnected();
        return;
      }
      if (!mod && !e.altKey && key === 'g') {
        if (e.shiftKey) handleUngroupSelected();
        else handleGroupSelected();
        return;
      }
      if (key === 'w') {
        setTransformMode('translate');
      } else if (key === 'e') {
        setTransformMode('rotate');
      } else if (key === 'x') {
        toggleExplode();
      } else if (key === 'f') {
        setFocusTrigger((c) => c + 1);
      } else if (key === 'd' && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
        e.preventDefault();
        handleDuplicateSelected();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        handleDeleteSelected();
      } else if (e.key === 'Escape') {
        if (explodeMode !== 'off') {
          closeExplode();
        } else if (boxSelect || selectMode) {
          // Esc first leaves Box select / Select mode and keeps the selection
          setBoxSelect(false);
          setSelectMode(false);
        } else {
          setInstances((prev) => resolveIntersectingInstances(prev, null), { label: moveBackLabel });
          setSelectedId(null);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const handleExportJson = () => {
    const validInstances = instances.filter((i) => !i.isIntersecting);
    // Overlapping parts are left out; the saved history ends with a step that removes them
    const savedHistory = withExportStep(history, instances, validInstances);
    const payload = {
      version: '1.1',
      pitchUnitMm: VEX_PITCH_MM,
      exportedAt: new Date().toISOString(),
      instances: validInstances,
      history: savedHistory,
      historyRev: savedHistory.rev
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFileName(currentBuild?.name);
    a.click();
    URL.revokeObjectURL(url);
  };

  // --- Builds: New, Starter, the library, Open from computer (openspec build-library) -------------
  const [libraryOpen, setLibraryOpen] = useState(false);
  // Build menu (openspec chain-track-builder, chain-over-under): the route dialog for enclosed parts,
  // the builder dialog ({ kind, slackMm, route } while open), and their choices for this page
  const [builderDialog, setBuilderDialog] = useState(null);
  const [trackGrippers, setTrackGrippers] = useState(true);
  const [chainSlack, setChainSlack] = useState('lower');
  const closeBuilderDialog = useCallback(() => setBuilderDialog(null), []);
  const [chainRouteDialogOpen, setChainRouteDialogOpen] = useState(false);
  const [chainRoute, setChainRoute] = useState(() => new Map());
  const [attentionIds, setAttentionIds] = useState(EMPTY_IDS);
  const closeChainRouteDialog = useCallback(() => {
    setChainRouteDialogOpen(false);
    setAttentionIds(EMPTY_IDS);
  }, []);
  const handleHighlightAttention = useCallback((id) => {
    setAttentionIds((prev) => (id ? (prev.length === 1 && prev[0] === id ? prev : [id]) : EMPTY_IDS));
  }, []);
  const [libraryBuilds, setLibraryBuilds] = useState([]);
  const closeLibrary = useCallback(() => setLibraryOpen(false), []);

  const refreshLibrary = async () => {
    if (!libraryAvailable()) return [];
    try {
      const list = await listBuilds();
      setLibraryBuilds(list);
      return list;
    } catch {
      return [];
    }
  };
  /** Every build name in use: the library's and the open build's. */
  const buildNames = async () => [...(await refreshLibrary()).map((b) => b.name), currentBuildRef.current?.name].filter(Boolean);

  /**
   * Makes `record` the current build: the open one is saved first (unless it is being deleted), then
   * its parts, history and view settings come in, and the bridge, other tabs and the assistant follow.
   */
  const switchToBuild = async ({ id, name, instances: parts, history: hist, viewport }, { saveCurrent = true } = {}) => {
    if (saveCurrent) {
      await saveCurrentBuildNow();
    } else {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
      latestForSaveRef.current = null;
    }
    setPreview(null);
    setExplodeMode('off');
    setSelectedId(null);
    setBuild({ instances: parts, history: loadHistory(hist, parts, { source: 'app', label: 'External change' }) });
    if (viewport) {
      if (viewport.transformMode) setTransformMode(viewport.transformMode);
      if (viewport.snapPitchFactor !== undefined) setSnapPitchFactor(viewport.snapPitchFactor);
      if (viewport.rotationSnapDeg !== undefined) setRotationSnapDeg(viewport.rotationSnapDeg);
      if (viewport.showGrid !== undefined) setShowGrid(viewport.showGrid);
      if (viewport.showConnectors !== undefined) setShowConnectors(viewport.showConnectors);
      applyViewOptions(viewport);
    }
    setCurrentBuild({ id, name });
    setFocusTrigger((c) => c + 1);
  };

  const handleNewBuild = async () => {
    const name = nextBuildName(await buildNames());
    await switchToBuild({ id: newBuildId(), name, instances: [], history: createHistory([]) });
    setActionFeedback({ message: `Started ${name}`, isError: false });
  };

  const handleStarterBuild = async (starterId) => {
    const starter = starterById(starterId);
    const parts = starter.build(catalog);
    const history = recordStep(createHistory([]), [], parts, { source: 'app', label: `Add ${starter.name}` }).history;
    const name = starterBuildName(await buildNames(), starter.name);
    await switchToBuild({ id: newBuildId(), name, instances: parts, history });
    setActionFeedback({ message: `Started ${name}`, isError: false });
  };

  const handleOpenBuild = async (id) => {
    if (id === currentBuildRef.current?.id) return;
    const record = await getBuild(id).catch(() => null);
    if (!record) {
      setActionFeedback({ message: "That build couldn't be opened", isError: true });
      return;
    }
    await switchToBuild(record);
    setLibraryOpen(false);
  };

  const handleRenameBuild = async (id, name) => {
    if (id === currentBuildRef.current?.id) {
      setCurrentBuild({ id, name });
    } else {
      const record = await getBuild(id).catch(() => null);
      if (record) await putBuild({ ...record, name });
    }
    // The library list shows the new name once the open build's save lands
    setTimeout(refreshLibrary, id === currentBuildRef.current?.id ? 1200 : 0);
  };

  const handleDuplicateBuild = async (id) => {
    if (id === currentBuildRef.current?.id) await saveCurrentBuildNow();
    const record = await getBuild(id).catch(() => null);
    if (!record) return;
    const now = Date.now();
    await putBuild({ ...record, id: newBuildId(), name: copyName(await buildNames(), record.name), createdAt: now, updatedAt: now });
    refreshLibrary();
  };

  /** Deletes a build from this browser for good (asks first); the open one gives way to the next. */
  const handleDeleteBuild = async (id) => {
    const isCurrent = id === currentBuildRef.current?.id;
    const name = isCurrent ? currentBuildRef.current.name : libraryBuilds.find((b) => b.id === id)?.name || 'this build';
    if (!window.confirm(`Delete ${name}? This can't be undone.`)) return;
    if (isCurrent) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
      latestForSaveRef.current = null;
    }
    if (libraryAvailable()) await deleteBuild(id).catch(() => {});
    const remaining = await refreshLibrary();
    if (isCurrent) {
      const next = remaining[0] ? await getBuild(remaining[0].id).catch(() => null) : null;
      if (next) await switchToBuild(next, { saveCurrent: false });
      else {
        await switchToBuild(
          { id: newBuildId(), name: nextBuildName(remaining.map((b) => b.name)), instances: [], history: createHistory([]) },
          { saveCurrent: false }
        );
      }
    }
    setActionFeedback({ message: `Deleted ${name}`, isError: false });
  };

  /** Open from computer…: the file becomes a new build in the library, named after the file. */
  const handleOpenFile = (file) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!Array.isArray(parsed.instances)) throw new Error('it has no parts list');
        const name = uniqueName(await buildNames(), fileBuildName(file.name));
        await switchToBuild({ id: newBuildId(), name, instances: parsed.instances, history: parsed.history });
        setLibraryOpen(false);
        setActionFeedback({ message: `Opened ${name}`, isError: false });
      } catch (err) {
        setActionFeedback({ message: `Couldn't open ${file.name}: ${err.message}`, isError: true });
      }
    };
    reader.readAsText(file);
  };

  useEffect(() => {
    if (libraryOpen) refreshLibrary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryOpen]);

  const mateTargetInst = useMemo(
    () =>
      instances.find((i) => i.instanceId === mateTargetInstanceId) ||
      instances.find((i) => i.instanceId !== selectedId) ||
      null,
    [instances, mateTargetInstanceId, selectedId]
  );

  const mateTargetPartMeta = useMemo(
    () => (mateTargetInst ? catalogMap.get(mateTargetInst.partId) : null),
    [mateTargetInst, catalogMap]
  );

  const handleRunSmartAction = async (action, params = {}) => {
    setIsRunningAction(true);
    setActionFeedback(null);
    try {
      const res = await fetch('/api/assembly/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          state: {
            selectedId: primaryId,
            selectedIds,
            viewport: {
              transformMode,
              snapPitchFactor,
              rotationSnapDeg,
              showGrid,
              showConnectors,
              explodeMode,
              explodeAmount: savedExplodeAmount,
              focusTrigger,
              projection,
              viewLayout,
              stereoCrossEyed,
              stereoDepth,
              viewAlongTrigger,
              shadows,
              ambientOcclusion,
              environmentReflections,
              reflectionIntensity
            },
            instances
          },
          params
        })
      });
      const data = await res.json();
      if (!data.ok) {
        setActionFeedback({ message: data.error || 'Action failed.', isError: true });
      } else {
        if (data.state && Array.isArray(data.state.instances)) {
          suppressNextServerSyncRef.current = true;
          adoptServerState(data.state);
          adoptSelection(data.state);
        }
        if (data.message) {
          setActionFeedback({ message: data.message, isError: Boolean(data.isIntersecting) });
        }
      }
      return data;
    } catch (err) {
      setActionFeedback({ message: err.message || 'Network error.', isError: true });
      return { ok: false, error: err.message };
    } finally {
      setIsRunningAction(false);
    }
  };

  // Can the selection carry a chain? Drives the Build menu's items and their hover text
  const chainParts = useMemo(() => {
    const byId = new Map(instances.map((i) => [i.instanceId, i]));
    return selectedIds
      .map((id) => byId.get(id))
      .filter((i) => i && i.visible !== false)
      .map((i) => ({ instanceId: i.instanceId, label: i.label, meta: catalogMap.get(i.partId), position: i.position, rotation: i.rotation }));
  }, [instances, selectedIds, catalogMap]);
  const chainCheck = useMemo(() => {
    const remembered = {};
    for (const [id, side] of chainRoute.entries()) remembered[id] = side;
    return checkSprocketsForChain(chainParts, { route: remembered });
  }, [chainParts, chainRoute]);

  // Chain builder first asks over or under for each enclosed part; then either builder asks where
  // noticeable slack goes (Track builder always asks, for its grippers). Chain builder builds at once
  // when there is nothing to ask.
  const openChainBuilder = (kind, route = null) => {
    if (kind === 'chain' && chainCheck.ok && chainCheck.enclosed?.length > 0 && !route) {
      setAttentionIds([chainCheck.enclosed[0].instanceId]);
      setChainRouteDialogOpen(true);
      return;
    }
    let slackMm = null;
    if (chainCheck.ok) {
      const catalogParts = [...catalogMap.values()];
      const plan = buildChainPath(chainParts, { kind, route, grippers: false, metaByPartNumber: (pn) => catalogParts.find((p) => p.partNumber === pn) });
      if (plan.ok && plan.slackChoice) slackMm = -plan.gapMm;
    }
    if (kind === 'chain' && slackMm == null) handleBuildChain('chain', { route });
    else setBuilderDialog({ kind, slackMm, route });
  };

  const handleBuildChain = (kind, { grippers = false, slack = 'lower', route = null } = {}) => {
    if (previewRef.current) {
      setActionFeedback({ message: "This is a preview of an earlier point. Go to a step's end to edit.", isError: true });
      return;
    }
    if (!chainCheck.ok) {
      setActionFeedback({ message: chainCheck.error, isError: true });
      return;
    }
    handleRunSmartAction('build_chain', { kind, grippers, slack, ...(route ? { route } : {}), instanceIds: selectedIds });
  };

  const handleOpenAuditDialog = async () => {
    const data = await handleRunSmartAction('audit_and_blueprint', {});
    if (data && data.ok) {
      setAuditModalData({
        audit: data.audit,
        ortho: data.ortho,
        timestamp: Date.now()
      });
      auditDialogRef.current?.showModal();
    }
  };

  return (
    <div className="app-shell">
      {/* Top Modeler Toolbar */}
      <header className="topbar">
        <div className="brand">
          <span className="brand-badge">VEX IQ</span>
          <span>3D Robot Modeler</span>
          <BuildNameField name={currentBuild?.name} onRename={(name) => currentBuild && setCurrentBuild({ ...currentBuild, name })} />
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              color: settings.advanced && settings.mcpEnabled && mcpConnected ? '#4ade80' : 'var(--text-muted)',
              fontWeight: 500
            }}
            title={settings.advanced ? 'Parts in this build · live MCP server bridge status' : 'Parts in this build'}
          >
            {settings.advanced && <Radio size={12} />}
            {(() => {
              // The open build's part count (the library's 478 parts show in its own panel)
              const count = `${instances.length} part${instances.length === 1 ? '' : 's'}`;
              if (!settings.advanced) return count;
              if (!settings.mcpEnabled) return `MCP Off • ${count}`;
              return mcpConnected ? `MCP Live • ${count}` : count;
            })()}
          </span>
        </div>

        {/* Transform, Snap & Explode Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div className="toolbar-group" role="group" aria-label="Undo and Redo">
            <button
              type="button"
              className="btn"
              onClick={handleUndo}
              disabled={historyPosition.currentStep === 0}
              title="Undo (Ctrl/Cmd+Z)"
              aria-label="Undo"
            >
              <Undo2 size={14} />
            </button>
            <button
              type="button"
              className="btn"
              onClick={handleRedo}
              disabled={historyPosition.currentStep >= historyPosition.totalSteps}
              title="Redo (Shift+Ctrl/Cmd+Z or Ctrl+Y)"
              aria-label="Redo"
            >
              <Redo2 size={14} />
            </button>
            <button
              type="button"
              className={`btn ${timelineVisible ? 'active' : ''}`}
              onClick={toggleTimeline}
              title="History: show the build as a timeline you can scrub and play"
              aria-label="History"
              aria-pressed={timelineVisible}
            >
              <HistoryIcon size={14} />
            </button>
          </div>

          <div className="toolbar-group" role="group" aria-label="Selection">
            <SelectMenu
              selectMode={selectMode}
              onToggleSelectMode={() => setSelectMode((on) => !on)}
              boxSelect={boxSelect}
              onToggleBoxSelect={() => setBoxSelect((on) => !on)}
              hasSelection={selectedIds.length > 0}
              canGroup={selectedIds.length >= 2}
              canUngroup={selectedGroupIds.length > 0}
              onConnected={handleSelectConnected}
              onAll={handleSelectAll}
              onNone={handleSelectNone}
              onInvert={handleInvertSelection}
              onGroup={handleGroupSelected}
              onUngroup={handleUngroupSelected}
            />
            <BuildMenu
              chainCheck={chainCheck}
              disabledReason={preview ? "This is a preview of an earlier point. Go to a step's end to edit." : isRunningAction ? 'Working…' : null}
              onChain={() => openChainBuilder('chain')}
              onTrack={() => openChainBuilder('track')}
            />
          </div>

          <div className="toolbar-group" role="group" aria-label="Transform Mode">
            <button
              type="button"
              className={`btn ${transformMode === 'translate' ? 'active' : ''}`}
              onClick={() => setTransformMode('translate')}
              title="Move Tool (Shortcut: W)"
            >
              <Move size={14} />
              Move
            </button>
            <button
              type="button"
              className={`btn ${transformMode === 'rotate' ? 'active' : ''}`}
              onClick={() => setTransformMode('rotate')}
              title="Rotate Tool (Shortcut: E)"
            >
              <RotateCw size={14} />
              Rotate
            </button>
          </div>

          <div className="toolbar-group" role="group" aria-label="Snap and Explode">
            <ToolbarMenu
              label="Snap"
              title="How far a drag moves in one step (VEX pitch = 12.7 mm)"
              value={snapPitchFactor}
              onChange={setSnapPitchFactor}
              options={[
                { label: '1P', value: 1 },
                { label: '0.5P', value: 0.5 },
                { label: '0.25P', value: 0.25 },
                { label: 'Free', value: 0 }
              ]}
            />
            <button
              type="button"
              className={`btn ${explodeMode !== 'off' ? 'active' : ''}`}
              onClick={toggleExplode}
              aria-pressed={explodeMode !== 'off'}
              title="Take the robot apart with a slider (Shortcut: X)"
            >
              <Expand size={14} />
              Explode
            </button>
          </div>

          <div className="toolbar-group" role="group" aria-label="View">
            <button
              type="button"
              className="btn"
              onClick={() => setFocusTrigger((c) => c + 1)}
              title="Frame Selected or All Parts (Shortcut: F)"
            >
              <Maximize2 size={14} />
              Focus
            </button>
            <button
              type="button"
              className={`btn ${panelsHidden ? 'active' : ''}`}
              onClick={() => setPanelsHidden((v) => !v)}
              title={panelsHidden ? 'Show the parts library and Inspector' : 'Hide the side panels for a wide view'}
            >
              {panelsHidden ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
              {panelsHidden ? 'Panels' : 'Wide'}
            </button>
            {viewLayout === 'stereo' && (
              <button
                type="button"
                className={`btn ${viewMenuAt ? 'active' : ''}`}
                onClick={(e) => {
                  if (viewMenuAt) {
                    setViewMenuAt(null);
                    return;
                  }
                  const r = e.currentTarget.getBoundingClientRect();
                  setViewMenuAt({ x: r.left, y: r.bottom + 4 });
                }}
                title="View options (the view cube's menu, which is hidden in Stereo)"
                aria-haspopup="menu"
              >
                <Glasses size={14} />
                View
              </button>
            )}
          </div>
        </div>

        {/* Scene Actions: Starter, Export, Import */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <FileMenu
            starters={STARTERS}
            onNew={handleNewBuild}
            onStarter={handleStarterBuild}
            onLoad={() => setLibraryOpen(true)}
            onExport={handleExportJson}
            onDeleteCurrent={() => currentBuild && handleDeleteBuild(currentBuild.id)}
          />
          <button
            type="button"
            className="btn btn-outline"
            onClick={handleOpenAuditDialog}
            disabled={isRunningAction || instances.length === 0}
            title="Run 6-Stage Mechanical & Kinematic Audit and Open 3-View Orthographic Blueprint"
          >
            <Compass size={14} />
            Audit &amp; Blueprint
          </button>
          <button
            type="button"
            className={`btn btn-outline ${settingsOpen ? 'active' : ''}`}
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            aria-label="Settings"
          >
            <SettingsIcon size={14} />
          </button>
        </div>
      </header>

      {/* Main 3-Column Modeler Layout */}
      <div className={`workspace-grid${panelsHidden ? ' panels-hidden' : ''}`}>
        {/* Left Sidebar: 478-Part VEX IQ Catalog with 3D Thumbnails */}
        <aside className="panel panel-left">
          <div className="panel-header">
            <div className="panel-title-row">
              <span>VEX IQ Part Library</span>
              <span className="library-title-tools">
                <span>
                  {filteredCatalog.length} / {catalog.length}
                </span>
                <span className="view-switch" role="group" aria-label="Library view">
                  <button
                    type="button"
                    className={libraryView === 'list' ? 'active' : ''}
                    aria-pressed={libraryView === 'list'}
                    title="List view"
                    onClick={() => setLibraryView('list')}
                  >
                    <ListIcon size={14} />
                  </button>
                  <button
                    type="button"
                    className={libraryView === 'grid' ? 'active' : ''}
                    aria-pressed={libraryView === 'grid'}
                    title="Grid view"
                    onClick={() => setLibraryView('grid')}
                  >
                    <LayoutGrid size={14} />
                  </button>
                </span>
              </span>
            </div>

            <div className="search-box">
              <Search size={15} />
              <input
                type="search"
                className="search-input"
                placeholder="Search Brain, Motor, Sensor, 228-..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  type="button"
                  className="clear-search-btn"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <div className="category-pills">
              {[[RECENT_CATEGORY, recentParts.length], ...categories].map(([cat, count]) => (
                <button
                  key={cat}
                  type="button"
                  className={`category-pill ${activeCategory === cat ? 'active' : ''}`}
                  onClick={() => setActiveCategory(cat)}
                >
                  {cat} ({count})
                </button>
              ))}
            </div>
          </div>

          <div
            className={`catalog-list scroller${libraryView === 'grid' ? ' grid' : ''}`}
            onScroll={tileTip ? hideTileTip : undefined}
          >
            {filteredCatalog.map((part, idx) =>
              libraryView === 'grid' ? (
                <button
                  key={part.id}
                  type="button"
                  className={`part-tile ${idx >= 18 ? 'part-card-deferred' : ''}`}
                  aria-label={part.name}
                  onClick={() => handleLibraryAdd(part)}
                  onPointerEnter={(e) => showTileTip(part, e.currentTarget)}
                  onPointerLeave={hideTileTip}
                  onFocus={(e) => showTileTip(part, e.currentTarget)}
                  onBlur={hideTileTip}
                >
                  <PartThumbnail part={part} index={idx} size={GRID_THUMB_PX} />
                  <span className="tile-size">{sizeText(part)}</span>
                </button>
              ) : (
                <button
                  key={part.id}
                  type="button"
                  className={`part-card ${idx >= 18 ? 'part-card-deferred' : ''}`}
                  onClick={() => handleLibraryAdd(part)}
                  onPointerEnter={(e) => showTileTip(part, e.currentTarget)}
                  onPointerLeave={hideTileTip}
                  onFocus={(e) => showTileTip(part, e.currentTarget)}
                  onBlur={hideTileTip}
                >
                  <PartThumbnail part={part} index={idx} />
                  <div className="part-info">
                    <div className="part-name" title={part.name}>
                      {part.name}
                    </div>
                    <div className="part-meta">
                      <span>{part.partNumber}</span>
                      <span>{sizeText(part)}</span>
                      <span className="part-meta-count">{part.connectorCount} holes/axes</span>
                    </div>
                  </div>
                  <span className="part-add-badge">+ Add</span>
                </button>
              )
            )}

            {filteredCatalog.length === 0 && (
              <div className="empty-state">
                {activeCategory === RECENT_CATEGORY && !searchQuery.trim()
                  ? 'Parts you add from the library will show up here.'
                  : `No VEX IQ parts match "${searchQuery}".`}
              </div>
            )}
          </div>
          {tileTip && (
            <div
              className="tile-tip"
              role="tooltip"
              style={{
                left: Math.min(Math.max(tileTip.centerX, tileTip.minX + ZOOM_THUMB_PX / 2), tileTip.maxX - ZOOM_THUMB_PX / 2),
                ...(tileTip.top + (tileTip.big ? ZOOM_THUMB_PX + 70 : 52) > tileTip.panelBottom
                  ? { top: tileTip.bottom, transform: 'translate(-50%, -100%)' }
                  : { top: tileTip.top, transform: 'translateX(-50%)' })
              }}
            >
              {tileTip.big && cachedThumbnail(tileTip.part) && (
                <img className="tile-tip-img" src={cachedThumbnail(tileTip.part)} alt="" width={ZOOM_THUMB_PX} height={ZOOM_THUMB_PX} />
              )}
              <strong>{tileTip.part.name}</strong>
              <span className="tile-tip-size">{sizeText(tileTip.part)}</span>
              <span className="tile-tip-number">{tileTip.part.partNumber}</span>
            </div>
          )}
        </aside>

        {/* Center 3D Viewport */}
        <main className={`viewport-container layout-${viewLayout}`}>
          {actionFeedback && (
            <div className={`message-strip ${actionFeedback.isError ? 'error' : ''}`} role="status" aria-live="polite">
              {actionFeedback.message}
            </div>
          )}
          <Viewport3D
            onCubeMenu={setViewMenuAt}
            instances={preview ? preview.parts : instances}
            catalogMap={catalogMap}
            selectedId={preview ? null : selectedId}
            selectedIds={preview ? EMPTY_IDS : selectedIds}
            attentionIds={preview ? EMPTY_IDS : attentionIds}
            selectMode={selectMode}
            boxSelect={boxSelect && !preview}
            onBoxSelect={handleBoxSelect}
            onSelect={preview ? noop : handleSelectInstance}
            onExpandSelection={preview ? noop : handleExpandSelection}
            onUpdateTransform={preview ? noop : handleUpdateTransform}
            onUpdateSet={preview ? noop : (ids, patches, { kind }) => handleUpdateSet(ids, patches, { label: `${kind === 'turn' ? 'Turn' : 'Move'} ${setName}` })}
            onRegisterFlushMover={handleRegisterFlushMover}
            onRegisterScreenshot={handleRegisterScreenshot}
            transformMode={transformMode}
            snapPitchFactor={snapPitchFactor}
            rotationSnapDeg={rotationSnapDeg}
            showGrid={showGrid}
            projection={projection}
            viewLayout={viewLayout}
            stereoCrossEyed={stereoCrossEyed}
            stereoDepth={stereoDepth}
            viewAlongTrigger={viewAlongTrigger}
            immersive={immersive}
            shadows={shadows}
            ambientOcclusion={ambientOcclusion}
            environmentReflections={environmentReflections}
            reflectionIntensity={reflectionIntensity}
            showConnectors={showConnectors}
            explodeMode={explodeMode}
            explodeAmount={explodeAmount}
            explodePlan={explodePlan && explodePlan.plan.mode === explodeMode ? explodePlan.plan : null}
            focusTrigger={focusTrigger}
            onLoadingChange={setIsLoadingMesh}
            onMateFeedback={(message, isError) => setActionFeedback({ message, isError })}
            onToggleRotateRequest={preview ? noop : handleToggleRotateRequest}
            collisionRecheck={preview ? undefined : build.recheck}
            onPickStatus={setPickStatus}
            onInsertCopy={preview ? noop : handleInsertCopy}
          />

          {explodeMode !== 'off' && (
            <ExplodePanel
              amount={explodeAmount}
              ready={explodeReady}
              progress={explodeProgress}
              onAmount={setExplodeAmount}
              onGrab={() => setExplodePlaying(false)}
              onClose={closeExplode}
            />
          )}

          <div className="viewport-hud-top">
            <div className="hud-pill">
              <Box size={14} style={{ color: '#60a5fa' }} />
              <span>
                <strong>1x VEX Pitch</strong> = 12.7 mm (0.5")
              </span>
              {explodeMode !== 'off' && (
                <span style={{ color: '#38bdf8', fontWeight: 600 }}>
                  • Explode: {Math.round(explodeAmount * 100)}%
                </span>
              )}
              {isLoadingMesh && (
                <span style={{ color: '#93c5fd', marginLeft: 6 }}>• Loading mesh…</span>
              )}
            </div>

            {selectedIds.length > 0 && !preview && (
              <div className="hud-pill hud-pill-selection" role="status" aria-live="polite">
                <span>
                  <strong>{selectedIds.length === 1 ? '1 part' : `${selectedIds.length} parts`}</strong> selected
                </span>
                <button type="button" className="link-btn" onClick={handleSelectNone} title="Unselect everything (Esc)">
                  Clear
                </button>
              </div>
            )}

            {pickStatus && (
              <div className={`hud-pill hud-pill-pick ${pickStatus.tone === 'warning' ? 'hud-pill-pick-warning' : ''}`} role="status">
                <Crosshair size={14} />
                <span>{pickStatus.text}</span>
              </div>
            )}

            {selectedInstance?.isIntersecting ? (
              <div className="hud-pill hud-pill-warning">
                <AlertTriangle size={14} />
                <span>
                  <strong>Intersecting Part (Not Placed)</strong> — Move to clear space / through a
                  hole, or
                </span>
                <button
                  type="button"
                  className="btn btn-outline"
                  style={{ padding: '2px 8px', fontSize: 11 }}
                  onClick={handleRevertSelectedIntersection}
                >
                  <RotateCcw size={12} />
                  {selectedInstance.lastValidPosition ? 'Revert Pose' : 'Cancel Placement'}
                </button>
              </div>
            ) : (
              selectedInstance &&
              selectedPartMeta && (
                <div className="hud-pill">
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: selectedInstance.color || selectedPartMeta.defaultColor
                    }}
                  />
                  <strong style={{ color: '#f8fafc' }}>{selectedInstance.label}</strong>
                  <span>({selectedPartMeta.partNumber})</span>
                </div>
              )
            )}
          </div>

          {timelineVisible && (
            <HistoryTimeline history={history} onMoveTo={handleMoveTo} onPreview={handlePreview} />
          )}

          {!timelineVisible && (
            <div className="viewport-hud-bottom">
              <div className="shortcuts-bar">
                <span>
                  <kbd className="kbd">LMB</kbd> Select / Orbit
                </span>
                <span>
                  <kbd className="kbd">RMB</kbd> Pan
                </span>
                <span>
                  <kbd className="kbd">W</kbd> Move
                </span>
                <span title="Drag a colored square on the Move gizmo to slide the part within that plane">
                  <kbd className="kbd">▢</kbd> Plane Drag
                </span>
                <span title="The Move arrows and rotate rings follow the selected part's own axes; hold Alt for the world's axes. Dragging snaps a pin or shaft onto a nearby hole's line; with Alt held it doesn't">
                  <kbd className="kbd">Alt</kbd> World axes, no hole snap
                </span>
                <span title="With a part that has pins selected, hold Ctrl/Cmd to light the holes a copy would fill; double-click a hole to insert a copy">
                  <kbd className="kbd">Ctrl/Cmd</kbd> + double-click: insert a copy
                </span>
                <span>
                  <kbd className="kbd">E</kbd> Rotate
                </span>
                <span>
                  <kbd className="kbd">X</kbd> Explode
                </span>
                <span>
                  <kbd className="kbd">D</kbd> Duplicate
                </span>
                <span>
                  <kbd className="kbd">F</kbd> Focus
                </span>
                <span>
                  <kbd className="kbd">P</kbd> Persp / Ortho
                </span>
                <span title="Shift looks from the opposite side">
                  <kbd className="kbd">1</kbd>
                  <kbd className="kbd">2</kbd>
                  <kbd className="kbd">3</kbd> Front / Top / Side
                </span>
                <span>
                  <kbd className="kbd">Esc</kbd> Close Explode / Cancel
                </span>
              </div>
            </div>
          )}
        </main>

        {/* Right Sidebar: Scene Assembly Outliner + Precision Inspector */}
        <aside className="panel panel-right">
          {/* Scene Outliner */}
          <AssemblyOutliner
            instances={instances}
            catalogMap={catalogMap}
            groups={groups}
            selectedIds={selectedIds}
            primaryId={primaryId}
            selectMode={selectMode}
            onSelectIds={changeSelection}
            onTogglePart={(id, patch) => handleUpdateTransform(id, patch)}
            onSetGroupFlag={handleSetGroupFlag}
            onClearAll={() => {
              setExplodeMode('off');
              setInstances([], { label: 'Clear assembly' });
              setSelectedId(null);
            }}
          />

          {/* Part Inspector */}
          <section className="inspector-section scroller">
            <div className="panel-header" style={{ padding: '10px 14px' }}>
              <div className="panel-title-row">
                {selectionTitle ? (
                  <div className="inspector-title">
                    <span className="inspector-name" title={selectionTitle.name}>
                      {selectionTitle.name}
                    </span>
                    {selectionTitle.sub && (
                      <span className="inspector-sub" title={selectionTitle.sub}>
                        {selectionTitle.sub}
                      </span>
                    )}
                  </div>
                ) : (
                  <span>Part Inspector</span>
                )}
                {selectedIds.length > 0 && (
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      type="button"
                      className="btn btn-outline"
                      style={{ padding: '3px 7px', fontSize: 11 }}
                      onClick={handleDuplicateSelected}
                      title="Duplicate (Shortcut: D)"
                    >
                      <Copy size={12} />
                      Clone
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline btn-danger"
                      style={{ padding: '3px 7px', fontSize: 11 }}
                      onClick={handleDeleteSelected}
                      title="Delete (Shortcut: Del)"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {isSet ? (
              <SetInspector
                group={selectionGroup}
                parts={setParts}
                pivot={setCentre}
                snapPitchFactor={snapPitchFactor}
                onRename={handleRenameGroup}
                onMoveBy={(delta) => moveSetBy(delta, 'set-nudge')}
                onMoveCentreTo={handleMoveSetCentreTo}
                onTurn={handleTurnSet90}
                onSetFlag={handleSetSetFlag}
              />
            ) : selectedInstance && selectedPartMeta ? (
              <div className="inspector-body">
                {/* Position in mm + Pitch */}
                <div className="field-group">
                  <div className="field-label">
                    <span>Position (mm)</span>
                    <span style={{ color: '#93c5fd', textTransform: 'none' }}>
                      Pitch: {(selectedInstance.position[0] / VEX_PITCH_MM).toFixed(2)}P,{' '}
                      {(selectedInstance.position[1] / VEX_PITCH_MM).toFixed(2)}P,{' '}
                      {(selectedInstance.position[2] / VEX_PITCH_MM).toFixed(2)}P
                    </span>
                  </div>
                  <div className="xyz-grid">
                    {['X', 'Y', 'Z'].map((axis, idx) => (
                      <label key={axis} className="coord-input-wrap">
                        <span className={`coord-axis ${axis.toLowerCase()}`}>{axis}</span>
                        <input
                          type="number"
                          step="6.35"
                          className="coord-input"
                          value={selectedInstance.position[idx]}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            if (Number.isNaN(val)) return;
                            const next = [...selectedInstance.position];
                            next[idx] = val;
                            handleUpdateTransform(
                              selectedInstance.instanceId,
                              { position: next },
                              { mergeKey: `position-${idx}:${selectedInstance.instanceId}` }
                            );
                          }}
                        />
                      </label>
                    ))}
                  </div>
                  <div className="nudge-row">
                    {[
                      { label: '-X', axis: 0, dir: -1 },
                      { label: '+X', axis: 0, dir: 1 },
                      { label: '-Y', axis: 1, dir: -1 },
                      { label: '+Y', axis: 1, dir: 1 },
                      { label: '-Z', axis: 2, dir: -1 },
                      { label: '+Z', axis: 2, dir: 1 }
                    ].map((btn) => {
                      const activeStepP = snapPitchFactor > 0 ? snapPitchFactor : 0.25;
                      return (
                        <button
                          key={btn.label}
                          type="button"
                          className="btn btn-outline"
                          style={{ padding: '4px 0', fontSize: 11 }}
                          onClick={() => handleNudgePitch(btn.axis, btn.dir)}
                          title={`Step ${btn.dir > 0 ? '+' : '-'}${activeStepP}P (${(
                            btn.dir *
                            activeStepP *
                            VEX_PITCH_MM
                          ).toFixed(2)}mm) — Auto-stops flush at physical contact boundaries`}
                        >
                          {btn.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Rotation in degrees + Quick 90 deg flips */}
                <div className="field-group">
                  <div className="field-label">
                    <span>Rotation (deg)</span>
                    <span>Quick 90° Flip</span>
                  </div>
                  <div className="xyz-grid">
                    {['X', 'Y', 'Z'].map((axis, idx) => (
                      <label key={axis} className="coord-input-wrap">
                        <span className={`coord-axis ${axis.toLowerCase()}`}>{axis}</span>
                        <input
                          type="number"
                          step="15"
                          className="coord-input"
                          value={selectedInstance.rotation[idx]}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            if (Number.isNaN(val)) return;
                            const next = [...selectedInstance.rotation];
                            next[idx] = val;
                            handleUpdateTransform(
                              selectedInstance.instanceId,
                              { rotation: next },
                              { mergeKey: `rotation-${idx}:${selectedInstance.instanceId}` }
                            );
                          }}
                        />
                      </label>
                    ))}
                  </div>
                  <div className="xyz-grid">
                    {['Rotate X +90°', 'Rotate Y +90°', 'Rotate Z +90°'].map((label, idx) => (
                      <button
                        key={label}
                        type="button"
                        className="btn btn-outline"
                        style={{ fontSize: 11, padding: '5px 4px' }}
                        onClick={() => handleRotate90(idx)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Part Color Swatches */}
                <div className="field-group">
                  <div className="field-label">
                    <span>Part Color</span>
                  </div>
                  <div className="color-swatches">
                    {VEX_COLORS.map((hex) => (
                      <button
                        key={hex}
                        type="button"
                        className={`color-swatch-btn ${
                          selectedInstance.color === hex ? 'active' : ''
                        }`}
                        style={{ backgroundColor: hex }}
                        onClick={() =>
                          handleUpdateTransform(selectedInstance.instanceId, { color: hex })
                        }
                        aria-label={`Color ${hex}`}
                      />
                    ))}
                    <input
                      type="color"
                      value={selectedInstance.color || '#64748b'}
                      onChange={(e) =>
                        handleUpdateTransform(
                          selectedInstance.instanceId,
                          { color: e.target.value },
                          { mergeKey: `color:${selectedInstance.instanceId}` }
                        )
                      }
                      style={{
                        width: 26,
                        height: 26,
                        padding: 0,
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer'
                      }}
                      title="Custom Color"
                    />
                  </div>
                </div>

                {/* Advanced options only (openspec app-settings) */}
                {settings.advanced && (
                <>
                {/* Smart Assembly & Fastening Tools (Manual CAD Workflow) */}
                <div className="field-group">
                  <div className="field-label">
                    <span>Smart Assembly &amp; Fastening</span>
                    <span style={{ color: '#38bdf8' }}>BVH Verified</span>
                  </div>


                  <div className="smart-tools-card">
                    {/* 1. Auto-Fasten Joint */}
                    <div className="smart-tool-block">
                      <div className="smart-tool-title">
                        <span>⚡ 1. Auto-Fasten Joint (Pins)</span>
                      </div>
                      <select
                        className="cad-select"
                        value={fastenPartnerId}
                        onChange={(e) => setFastenPartnerId(e.target.value)}
                        aria-label="Target partner part to fasten with"
                      >
                        <option value="ALL">ALL Touching Parts (Auto-Detect Coaxial Holes)</option>
                        {instances
                          .filter(
                            (i) =>
                              i.instanceId !== selectedInstance.instanceId &&
                              catalogMap.get(i.partId)?.category !== 'Pins & Standoffs'
                          )
                          .map((inst) => (
                            <option key={inst.instanceId} value={inst.instanceId}>
                              {inst.label}
                            </option>
                          ))}
                      </select>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <select
                          className="cad-select"
                          style={{ width: 95 }}
                          value={fastenMaxPins}
                          onChange={(e) => setFastenMaxPins(Number(e.target.value))}
                          aria-label="Maximum connector pins to insert"
                        >
                          <option value={12}>Max 12</option>
                          <option value={8}>Max 8</option>
                          <option value={4}>Max 4</option>
                          <option value={2}>Max 2</option>
                          <option value={1}>Max 1</option>
                        </select>
                        <button
                          type="button"
                          className="btn btn-primary-action"
                          disabled={isRunningAction}
                          onClick={() =>
                            handleRunSmartAction('auto_fasten', {
                              instanceIdA: selectedInstance.instanceId,
                              instanceIdB: fastenPartnerId,
                              maxPins: fastenMaxPins
                            })
                          }
                        >
                          Auto-Fasten Pins
                        </button>
                      </div>
                    </div>

                    {/* 2. Declarative Port-to-Port Mate */}
                    <div className="smart-tool-block">
                      <div className="smart-tool-title">
                        <span>🎯 2. Snap &amp; Mate to Port</span>
                      </div>
                      <select
                        className="cad-select"
                        value={mateSourcePortId}
                        onChange={(e) => setMateSourcePortId(e.target.value)}
                        aria-label="Source port on selected part"
                      >
                        <option value="">Source Port: Auto (Primary Bore / Socket / Hole)</option>
                        {(selectedPartMeta.ports || []).map((p) => (
                          <option key={p.portId} value={p.portId}>
                            {p.portId} ({p.type}) [{p.origin.join(', ')}]
                          </option>
                        ))}
                      </select>
                      <select
                        className="cad-select"
                        value={mateTargetInst?.instanceId || ''}
                        onChange={(e) => {
                          setMateTargetInstanceId(e.target.value);
                          setMateTargetPortId('');
                        }}
                        aria-label="Target part instance to mate with"
                      >
                        {instances
                          .filter((i) => i.instanceId !== selectedInstance.instanceId)
                          .map((inst) => (
                            <option key={inst.instanceId} value={inst.instanceId}>
                              Target: {inst.label}
                            </option>
                          ))}
                      </select>
                      {mateTargetPartMeta && (
                        <select
                          className="cad-select"
                          value={mateTargetPortId}
                          onChange={(e) => setMateTargetPortId(e.target.value)}
                          aria-label="Target port on target part"
                        >
                          {(mateTargetPartMeta.ports || []).map((p) => (
                            <option key={p.portId} value={p.portId}>
                              Target Port: {p.portId} ({p.type}) [{p.origin.join(', ')}]
                            </option>
                          ))}
                        </select>
                      )}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 5 }}>
                        <select
                          className="cad-select"
                          value={mateRollDeg}
                          onChange={(e) => setMateRollDeg(Number(e.target.value))}
                          title="Roll angle around mated axis"
                        >
                          <option value={0}>Roll 0°</option>
                          <option value={5}>Roll 5° (36T)</option>
                          <option value={45}>Roll 45°</option>
                          <option value={90}>Roll 90°</option>
                          <option value={180}>Roll 180°</option>
                        </select>
                        <select
                          className="cad-select"
                          value={mateAxialOffsetMm}
                          onChange={(e) => setMateAxialOffsetMm(Number(e.target.value))}
                          title="Axial offset along port axis"
                        >
                          <option value={0}>0 mm (Center)</option>
                          <option value={-3.175}>-3.18 mm (-0.25P)</option>
                          <option value={3.175}>+3.18 mm (+0.25P)</option>
                          <option value={-6.35}>-6.35 mm (-0.5P)</option>
                          <option value={6.35}>+6.35 mm (+0.5P)</option>
                          <option value={-12.7}>-12.7 mm (-1P)</option>
                          <option value={12.7}>+12.7 mm (+1P)</option>
                        </select>
                        <button
                          type="button"
                          className={`btn btn-outline ${mateFlipAxis ? 'active' : ''}`}
                          style={{ fontSize: 11, padding: '4px 6px' }}
                          onClick={() => setMateFlipAxis((v) => !v)}
                          title="Flip axis 180 degrees"
                        >
                          {mateFlipAxis ? 'Flipped 180°' : 'Normal Dir'}
                        </button>
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary-action"
                        disabled={isRunningAction || !mateTargetInst}
                        onClick={() =>
                          handleRunSmartAction('mate_parts', {
                            sourceInstanceId: selectedInstance.instanceId,
                            sourcePortId: mateSourcePortId || undefined,
                            targetInstanceId: mateTargetInst.instanceId,
                            targetPortId:
                              mateTargetPortId ||
                              mateTargetPartMeta?.ports?.[0]?.portId ||
                              'hole_1',
                            flipAxis: mateFlipAxis,
                            rollDeg: mateRollDeg,
                            axialOffsetMm: mateAxialOffsetMm
                          })
                        }
                      >
                        Snap &amp; Mate Selected Part
                      </button>
                    </div>

                    {/* 3. Mesh Gear Train Builder */}
                    <div className="smart-tool-block">
                      <div className="smart-tool-title">
                        <span>⚙️ 3. Mesh Gear Train on Selected Beam</span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                        <select
                          className="cad-select"
                          value={gearTrainStartPortId}
                          onChange={(e) => setGearTrainStartPortId(e.target.value)}
                          title="Starting pin_hole port on selected beam"
                        >
                          {(selectedPartMeta.ports || [])
                            .filter((p) => p.type === 'pin_hole')
                            .map((p) => (
                              <option key={p.portId} value={p.portId}>
                                Start: {p.portId} [{p.origin[0]}mm]
                              </option>
                            ))}
                        </select>
                        <select
                          className="cad-select"
                          value={gearTrainPreset}
                          onChange={(e) => setGearTrainPreset(e.target.value)}
                          title="Gear train sequence"
                        >
                          <option value="3x36T">3 × 36T Gears (1:1)</option>
                          <option value="5x36T">5 × 36T Gears (Full Side)</option>
                          <option value="2x36T">2 × 36T Gears (1:1)</option>
                          <option value="12T-36T">12T → 36T (1:3 Torque)</option>
                          <option value="60T-36T">60T → 36T (1.67:1 Speed)</option>
                        </select>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 5 }}>
                        <select
                          className="cad-select"
                          value={gearTrainOuterBeamId}
                          onChange={(e) => setGearTrainOuterBeamId(e.target.value)}
                          title="Optional outer beam to center gears between"
                        >
                          <option value="">Single Beam (+12.7mm offset)</option>
                          {instances
                            .filter(
                              (i) =>
                                i.instanceId !== selectedInstance.instanceId &&
                                catalogMap.get(i.partId)?.category === 'Beams & Plates'
                            )
                            .map((inst) => (
                              <option key={inst.instanceId} value={inst.instanceId}>
                                Outer Rail: {inst.label}
                              </option>
                            ))}
                        </select>
                        <button
                          type="button"
                          className={`btn btn-outline ${gearTrainIncludeShafts ? 'active' : ''}`}
                          style={{ fontSize: 11, padding: '4px 8px' }}
                          onClick={() => setGearTrainIncludeShafts((v) => !v)}
                        >
                          {gearTrainIncludeShafts ? '+ 3x Shafts' : 'Gears Only'}
                        </button>
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary-action"
                        disabled={isRunningAction}
                        onClick={() => {
                          const presetGears = {
                            '3x36T': ['228-2500-214', '228-2500-214', '228-2500-214'],
                            '5x36T': [
                              '228-2500-214',
                              '228-2500-214',
                              '228-2500-214',
                              '228-2500-214',
                              '228-2500-214'
                            ],
                            '2x36T': ['228-2500-214', '228-2500-214'],
                            '12T-36T': ['228-2500-212', '228-2500-214'],
                            '60T-36T': ['228-2500-215', '228-2500-214']
                          }[gearTrainPreset] || ['228-2500-214', '228-2500-214', '228-2500-214'];

                          handleRunSmartAction('mesh_gear_train', {
                            supportBeamId: selectedInstance.instanceId,
                            outerSupportBeamId: gearTrainOuterBeamId || null,
                            startPortId: gearTrainStartPortId,
                            gears: presetGears,
                            shaftPartQuery: gearTrainIncludeShafts ? '228-2500-2221' : null
                          });
                        }}
                      >
                        Build Meshed Gear Train
                      </button>
                    </div>

                    {/* 4. Symmetry Mirror */}
                    <div className="smart-tool-block">
                      <div className="smart-tool-title">
                        <span>🪞 4. Symmetry Mirror (BVH Compensated)</span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 5 }}>
                        <button
                          type="button"
                          className="btn btn-outline"
                          style={{ fontSize: 11, padding: '5px 4px' }}
                          disabled={isRunningAction}
                          onClick={() =>
                            handleRunSmartAction('mirror_subassembly', {
                              instanceIds: [selectedInstance.instanceId],
                              mirrorPlane: 'Z',
                              planeOffsetMm: 0
                            })
                          }
                          title="Mirror selected part across Z = 0 (Left ↔ Right)"
                        >
                          Mirror Z (L↔R)
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline"
                          style={{ fontSize: 11, padding: '5px 4px' }}
                          disabled={isRunningAction}
                          onClick={() =>
                            handleRunSmartAction('mirror_subassembly', {
                              instanceIds: [selectedInstance.instanceId],
                              mirrorPlane: 'X',
                              planeOffsetMm: 0
                            })
                          }
                          title="Mirror selected part across X = 0 (Front ↔ Rear)"
                        >
                          Mirror X (F↔R)
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline"
                          style={{ fontSize: 11, padding: '5px 4px' }}
                          disabled={isRunningAction}
                          onClick={() =>
                            handleRunSmartAction('mirror_subassembly', {
                              instanceIds: [],
                              mirrorPlane: 'Z',
                              planeOffsetMm: 0
                            })
                          }
                          title="Mirror entire half-assembly across Z = 0"
                        >
                          Mirror All Z
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* CAD & Semantic Assembly Metadata */}
                <div className="field-group">
                  <div className="field-label">
                    <span>CAD &amp; Semantic Metadata</span>
                  </div>
                  <div className="metadata-card">
                    <div className="metadata-row">
                      <span>Status</span>
                      <strong
                        style={{
                          color: selectedInstance.isIntersecting ? '#fca5a5' : '#4ade80'
                        }}
                      >
                        {selectedInstance.isIntersecting
                          ? 'Intersecting (Unplaced)'
                          : 'Placed (Clear)'}
                      </strong>
                    </div>
                    <div className="metadata-row">
                      <span>Part Number</span>
                      <strong>{selectedPartMeta.partNumber}</strong>
                    </div>
                    <div className="metadata-row">
                      <span>Category</span>
                      <strong>{selectedPartMeta.category}</strong>
                    </div>
                    <div className="metadata-row">
                      <span>Origin Type</span>
                      <strong style={{ color: '#a78bfa' }}>
                        {selectedPartMeta.originType || 'centered'}
                      </strong>
                    </div>
                    <div className="metadata-row">
                      <span>Size (mm)</span>
                      <strong>
                        {selectedPartMeta.bbox.size[0]} × {selectedPartMeta.bbox.size[1]} ×{' '}
                        {selectedPartMeta.bbox.size[2]}
                      </strong>
                    </div>
                    <div className="metadata-row">
                      <span>Size (VEX Pitch)</span>
                      <strong>
                        {(selectedPartMeta.bbox.size[0] / VEX_PITCH_MM).toFixed(1)}P ×{' '}
                        {(selectedPartMeta.bbox.size[1] / VEX_PITCH_MM).toFixed(1)}P ×{' '}
                        {(selectedPartMeta.bbox.size[2] / VEX_PITCH_MM).toFixed(1)}P
                      </strong>
                    </div>
                    <div className="metadata-row">
                      <span>Semantic Ports</span>
                      <strong style={{ color: '#22d3ee' }}>
                        {selectedPartMeta.portCounts
                          ? `${selectedPartMeta.portCounts.pinHoles || 0} pin · ${selectedPartMeta.portCounts.shaftBores || 0} shaft · ${selectedPartMeta.portCounts.pinPegs || 0} peg`
                          : `${selectedPartMeta.connectorCount} axes`}
                      </strong>
                    </div>
                    {selectedPartMeta.gearSpecs && (
                      <div className="metadata-row">
                        <span>Gear Specs</span>
                        <strong style={{ color: '#f472b6' }}>
                          {selectedPartMeta.gearSpecs.teeth}T ({selectedPartMeta.gearSpecs.gearType}) · R={selectedPartMeta.gearSpecs.pitchRadiusMm}mm
                        </strong>
                      </div>
                    )}
                    {selectedPartMeta.fastenerSpecs && (
                      <div className="metadata-row">
                        <span>Fastener Specs</span>
                        <strong style={{ color: '#fbbf24' }}>
                          {selectedPartMeta.fastenerSpecs.fastenerType}
                          {selectedPartMeta.fastenerSpecs.hasEndCap ? ' (capped)' : ''}
                        </strong>
                      </div>
                    )}
                    {selectedPartMeta.mountingRules && (
                      <div className="metadata-row">
                        <span>Mounting Rule</span>
                        <strong
                          style={{
                            color:
                              selectedPartMeta.mountingRules.massClass === 'heavy'
                                ? '#fb923c'
                                : '#94a3b8'
                          }}
                        >
                          {selectedPartMeta.mountingRules.massClass} (min{' '}
                          {selectedPartMeta.mountingRules.minFastenersRequired} pins)
                        </strong>
                      </div>
                    )}
                  </div>
                </div>
                </>
                )}
              </div>
            ) : (
              <div className="empty-state">
                Select a part in the 3D view or the Assembly Outliner to see where it is, turn it
                and change its color.
              </div>
            )}
          </section>
        </aside>
      </div>

      {viewMenuAt && (
        <ViewMenu
          at={viewMenuAt}
          onClose={closeViewMenu}
          view={{
            projection,
            setProjection,
            viewLayout,
            setViewLayout,
            stereoCrossEyed,
            setStereoCrossEyed,
            stereoDepth,
            setStereoDepth: (v) => setStereoDepth(clampStereoDepth(v)),
            onFullScreen: enterImmersive,
            showGrid,
            setShowGrid,
            showConnectors,
            setShowConnectors
          }}
        />
      )}
      <ChainBuilderDialog
        open={Boolean(builderDialog)}
        kind={builderDialog?.kind}
        grippers={trackGrippers}
        slack={chainSlack}
        slackMm={builderDialog?.slackMm ?? null}
        onClose={closeBuilderDialog}
        onBuild={({ grippers, slack }) => {
          const { kind, slackMm, route } = builderDialog;
          if (kind === 'track') setTrackGrippers(grippers);
          if (slackMm != null) setChainSlack(slack);
          handleBuildChain(kind, { grippers: kind === 'track' && grippers, slack: slackMm != null ? slack : 'lower', route });
        }}
      />
      <ChainRouteDialog
        open={chainRouteDialogOpen}
        enclosed={chainCheck.enclosed || EMPTY_IDS}
        initialRoute={chainRoute}
        onHighlight={handleHighlightAttention}
        onClose={closeChainRouteDialog}
        onBuild={(chosenRoute) => {
          setChainRoute((prev) => {
            const next = new Map(prev);
            for (const [id, side] of Object.entries(chosenRoute)) next.set(id, side);
            return next;
          });
          setAttentionIds(EMPTY_IDS);
          setChainRouteDialogOpen(false);
          openChainBuilder('chain', chosenRoute);
        }}
      />
      <LibraryDialog
        open={libraryOpen}
        onClose={closeLibrary}
        builds={libraryBuilds}
        currentId={currentBuild?.id}
        available={libraryAvailable()}
        onOpen={handleOpenBuild}
        onRename={handleRenameBuild}
        onDuplicate={handleDuplicateBuild}
        onDelete={handleDeleteBuild}
        onOpenFile={handleOpenFile}
      />
      <SettingsPanel
        open={settingsOpen}
        onClose={closeSettings}
        settings={settings}
        onChange={updateSettings}
        shadows={shadows}
        setShadows={setShadows}
        ambientOcclusion={ambientOcclusion}
        setAmbientOcclusion={setAmbientOcclusion}
        environmentReflections={environmentReflections}
        setEnvironmentReflections={setEnvironmentReflections}
        reflectionIntensity={reflectionIntensity}
        setReflectionIntensity={setReflectionIntensity}
      />

      {/* Native Light-Dismiss Modal Dialog for 6-Stage Mechanical Audit & 3-View Blueprint */}
      <dialog
        ref={auditDialogRef}
        closedby="any"
        className="audit-dialog"
        aria-labelledby="auditDialogTitle"
      >
        <div className="audit-dialog-inner">
          <div className="audit-dialog-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="brand-badge">AUDIT &amp; BLUEPRINT</span>
              <strong id="auditDialogTitle" style={{ fontSize: 14 }}>
                6-Stage Mechanical Connectivity &amp; Kinematic Audit
              </strong>
              {auditModalData?.audit && (
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: auditModalData.audit.isMechanicallySound ? '#4ade80' : '#f87171'
                  }}
                >
                  {auditModalData.audit.isMechanicallySound
                    ? '● MECHANICALLY SOUND (0 ISSUES)'
                    : '▲ WARNINGS DETECTED'}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => window.open('/assembly-blueprint.svg', '_blank', 'noopener,noreferrer')}
              >
                Open Full SVG
              </button>
              <form method="dialog" style={{ margin: 0 }}>
                <button type="submit" className="btn btn-outline">
                  <X size={14} />
                  Close
                </button>
              </form>
            </div>
          </div>

          {auditModalData?.audit && (
            <div className="audit-dialog-body">
              <div className="audit-kpi-grid">
                <div className="audit-kpi-card">
                  <span className="audit-kpi-label">1. Solid Collisions</span>
                  <span
                    className="audit-kpi-value"
                    style={{
                      color: auditModalData.audit.collisionCount === 0 ? '#4ade80' : '#f87171'
                    }}
                  >
                    {auditModalData.audit.collisionCount} Intersections
                  </span>
                </div>
                <div className="audit-kpi-card">
                  <span className="audit-kpi-label">2. Floating Fasteners</span>
                  <span
                    className="audit-kpi-value"
                    style={{
                      color:
                        auditModalData.audit.floatingFastenerCount === 0 ? '#4ade80' : '#f87171'
                    }}
                  >
                    {auditModalData.audit.floatingFastenerCount} Unconnected
                  </span>
                </div>
                <div className="audit-kpi-card">
                  <span className="audit-kpi-label">3. Unsecured / Heavy</span>
                  <span
                    className="audit-kpi-value"
                    style={{
                      color:
                        auditModalData.audit.unsecuredPartCount === 0 &&
                        auditModalData.audit.underSecuredHeavyPartCount === 0
                          ? '#4ade80'
                          : '#f87171'
                    }}
                  >
                    {auditModalData.audit.unsecuredPartCount} Unpinned ·{' '}
                    {auditModalData.audit.underSecuredHeavyPartCount} Heavy
                  </span>
                </div>
                <div className="audit-kpi-card">
                  <span className="audit-kpi-label">4. Connectivity Graph</span>
                  <span
                    className="audit-kpi-value"
                    style={{
                      color:
                        auditModalData.audit.disconnectedIslandCount === 0 ? '#4ade80' : '#f87171'
                    }}
                  >
                    {auditModalData.audit.connectedComponentCount} Unified (
                    {auditModalData.audit.disconnectedIslandCount} Islands)
                  </span>
                </div>
                <div className="audit-kpi-card">
                  <span className="audit-kpi-label">5. Shaft Protrusions</span>
                  <span
                    className="audit-kpi-value"
                    style={{
                      color:
                        auditModalData.audit.protrudingShaftCount === 0 ? '#4ade80' : '#f87171'
                    }}
                  >
                    {auditModalData.audit.protrudingShaftCount} Overhanging
                  </span>
                </div>
                <div className="audit-kpi-card">
                  <span className="audit-kpi-label">6. Kinematic Drivetrain</span>
                  <span className="audit-kpi-value" style={{ color: '#38bdf8' }}>
                    {auditModalData.audit.kinematics?.motorCount || 0}M →{' '}
                    {auditModalData.audit.kinematics?.meshedGearPairCount || 0}G →{' '}
                    {auditModalData.audit.kinematics?.drivenWheelCount || 0}/
                    {auditModalData.audit.kinematics?.totalWheelCount || 0}W
                  </span>
                </div>
              </div>

              {/* Clickable Issue Callouts (Select & Focus in 3D Viewport) */}
              {(auditModalData.audit.unsecuredParts?.length > 0 ||
                auditModalData.audit.floatingFasteners?.length > 0 ||
                auditModalData.audit.protrudingShafts?.length > 0) && (
                <div className="metadata-card">
                  <div className="field-label">
                    <span>Flagged Parts (Click to Select &amp; Focus in 3D)</span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {[
                      ...(auditModalData.audit.unsecuredParts || []).map((x) => ({
                        ...x,
                        tag: 'Unsecured'
                      })),
                      ...(auditModalData.audit.floatingFasteners || []).map((x) => ({
                        ...x,
                        tag: 'Floating Pin/Shaft'
                      })),
                      ...(auditModalData.audit.protrudingShafts || []).map((x) => ({
                        ...x,
                        tag: 'Protruding Shaft'
                      }))
                    ].map((item) => (
                      <button
                        key={`${item.tag}-${item.instanceId}`}
                        type="button"
                        className="btn btn-outline"
                        style={{ borderColor: '#f87171', color: '#fecaca', fontSize: 11 }}
                        onClick={() => {
                          handleSelectInstance(item.instanceId);
                          setFocusTrigger((c) => c + 1);
                          auditDialogRef.current?.close();
                        }}
                      >
                        {item.tag}: {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Embedded 3-View Orthographic Blueprint SVG */}
              <div className="blueprint-preview-wrap">
                <img
                  src={`/assembly-blueprint.svg?t=${auditModalData.timestamp}`}
                  alt="3-View Orthographic Engineering Blueprint (Top XZ, Side XY, Front ZY)"
                />
              </div>
            </div>
          )}
        </div>
      </dialog>
    </div>
  );
}
