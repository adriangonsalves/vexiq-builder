import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Box,
  Compass,
  Copy,
  Download,
  Expand,
  Eye,
  EyeOff,
  Grid,
  Layers,
  Lock,
  Maximize2,
  Move,
  Radio,
  RotateCcw,
  RotateCw,
  Search,
  Sparkles,
  Trash2,
  Unlock,
  Upload,
  X
} from 'lucide-react';
import Viewport3D from './components/Viewport3D.jsx';
import PartThumbnail from './components/PartThumbnail.jsx';
import { registerVexIqWebMcpTools } from './utils/webMcpTools.js';

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

const STORAGE_KEY = 'vexiq_builder_assembly_v2';
const EXPLODE_MODES = ['off', 'x', 'y', 'z', 'all'];

export default function App() {
  const [catalog, setCatalog] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');

  const [instances, setInstances] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [transformMode, setTransformMode] = useState('translate'); // 'translate' | 'rotate'
  const [snapPitchFactor, setSnapPitchFactor] = useState(0.5); // 1 = 12.7mm, 0.5 = 6.35mm, 0.25 = 3.175mm, 0 = Free
  const [rotationSnapDeg, setRotationSnapDeg] = useState(15); // 15, 45, 90, 0
  const [showGrid, setShowGrid] = useState(true);
  const [showConnectors, setShowConnectors] = useState(true);
  const [explodeMode, setExplodeMode] = useState('off'); // 'off' | 'x' | 'y' | 'z' | 'all'
  const [focusTrigger, setFocusTrigger] = useState(0);
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
  const [isRunningAction, setIsRunningAction] = useState(false);
  const [auditModalData, setAuditModalData] = useState(null);

  const fileInputRef = useRef(null);
  const auditDialogRef = useRef(null);
  const suppressNextServerSyncRef = useRef(false);
  const webMcpContextRef = useRef(null);
  const flushMoverRef = useRef(null);

  const handleRegisterFlushMover = useCallback((fn) => {
    flushMoverRef.current = fn;
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
        if (serverState && Array.isArray(serverState.instances) && serverState.instances.length > 0) {
          suppressNextServerSyncRef.current = true;
          setInstances(serverState.instances);
          if (serverState.selectedId !== undefined) setSelectedId(serverState.selectedId);
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
            if (serverState.viewport.explodeMode) {
              setExplodeMode(serverState.viewport.explodeMode);
            }
          }
        } else {
          const starter = buildStarterAssembly(catalogData);
          setInstances(starter);
          setSelectedId(starter[1]?.instanceId || starter[0]?.instanceId || null);
        }
      })
      .catch((err) => console.error('Failed to initialize catalog:', err));
  }, []);

  // Subscribe to real-time SSE updates pushed by the MCP Server
  useEffect(() => {
    const es = new EventSource('/api/assembly/events');
    es.onopen = () => setMcpConnected(true);
    es.onerror = () => setMcpConnected(false);
    es.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.source === 'browser') return;
        const nextState = msg.state;
        if (nextState && Array.isArray(nextState.instances)) {
          suppressNextServerSyncRef.current = true;
          setInstances(nextState.instances);
          if (nextState.selectedId !== undefined) {
            setSelectedId(nextState.selectedId);
          }
          if (nextState.viewport) {
            const vp = nextState.viewport;
            if (vp.transformMode) setTransformMode(vp.transformMode);
            if (vp.snapPitchFactor !== undefined) setSnapPitchFactor(vp.snapPitchFactor);
            if (vp.rotationSnapDeg !== undefined) setRotationSnapDeg(vp.rotationSnapDeg);
            if (vp.showGrid !== undefined) setShowGrid(vp.showGrid);
            if (vp.showConnectors !== undefined) setShowConnectors(vp.showConnectors);
            if (vp.explodeMode !== undefined) setExplodeMode(vp.explodeMode);
            if (vp.focusTrigger !== undefined) setFocusTrigger(vp.focusTrigger);
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
    try {
      const validOnly = instances.filter((i) => !i.isIntersecting);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(validOnly));
    } catch {
      // ignore
    }

    if (suppressNextServerSyncRef.current) {
      suppressNextServerSyncRef.current = false;
      return;
    }

    fetch('/api/assembly', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-mcp-source': 'browser'
      },
      body: JSON.stringify({
        version: '1.0',
        selectedId,
        viewport: {
          transformMode,
          snapPitchFactor,
          rotationSnapDeg,
          showGrid,
          showConnectors,
          explodeMode,
          focusTrigger
        },
        instances
      })
    }).catch(() => {
      // ignore offline
    });
  }, [
    catalog.length,
    instances,
    selectedId,
    transformMode,
    snapPitchFactor,
    rotationSnapDeg,
    showGrid,
    showConnectors,
    explodeMode,
    focusTrigger
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

  const filteredCatalog = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return catalog.filter((part) => {
      if (activeCategory !== 'All' && part.category !== activeCategory) {
        return false;
      }
      if (!q) return true;
      return (
        part.name.toLowerCase().includes(q) ||
        part.partNumber.toLowerCase().includes(q) ||
        part.category.toLowerCase().includes(q)
      );
    });
  }, [catalog, searchQuery, activeCategory]);

  const selectedInstance = useMemo(
    () => instances.find((i) => i.instanceId === selectedId) || null,
    [instances, selectedId]
  );

  const selectedPartMeta = useMemo(
    () => (selectedInstance ? catalogMap.get(selectedInstance.partId) : null),
    [selectedInstance, catalogMap]
  );

  function buildStarterAssembly(catalogList) {
    const findByPartNum = (num) => catalogList.find((p) => p.partNumber === num);
    const beam =
      findByPartNum('228-2500-025') ||
      catalogList.find((p) => p.name.includes('2x8 Beam')) ||
      catalogList[0];
    const pin =
      findByPartNum('228-2500-086') ||
      catalogList.find((p) => p.name.includes('0x2 Connector Pin'));
    const shaft =
      findByPartNum('228-2500-258') ||
      catalogList.find((p) => p.name.includes('4x Pitch Shaft'));
    const gear =
      findByPartNum('228-2500-215') ||
      catalogList.find((p) => p.name.includes('36 Tooth Gear'));

    const starter = [];
    if (beam) {
      starter.push({
        instanceId: `inst-starter-beam`,
        partId: beam.id,
        label: `${beam.name} #1`,
        position: [0, 12.7, 0],
        rotation: [0, 0, 0],
        lastValidPosition: [0, 12.7, 0],
        lastValidRotation: [0, 0, 0],
        isIntersecting: false,
        color: beam.defaultColor,
        visible: true,
        locked: false
      });
    }
    if (pin) {
      starter.push({
        instanceId: `inst-starter-pin`,
        partId: pin.id,
        label: `${pin.name} #1`,
        position: [6.35, 6.35, 3.175],
        rotation: [0, 180, 0],
        lastValidPosition: [6.35, 6.35, 3.175],
        lastValidRotation: [0, 180, 0],
        isIntersecting: false,
        color: pin.defaultColor,
        visible: true,
        locked: false
      });
    }
    if (shaft) {
      starter.push({
        instanceId: `inst-starter-shaft`,
        partId: shaft.id,
        label: `${shaft.name} #1`,
        position: [-19.05, 6.35, 0],
        rotation: [0, 0, 0],
        lastValidPosition: [-19.05, 6.35, 0],
        lastValidRotation: [0, 0, 0],
        isIntersecting: false,
        color: shaft.defaultColor,
        visible: true,
        locked: false
      });
    }
    if (gear) {
      starter.push({
        instanceId: `inst-starter-gear`,
        partId: gear.id,
        label: `${gear.name} #1`,
        position: [-19.05, 6.35, 12.7],
        rotation: [0, 0, 0],
        lastValidPosition: [-19.05, 6.35, 12.7],
        lastValidRotation: [0, 0, 0],
        isIntersecting: false,
        color: '#dc2626',
        visible: true,
        locked: false
      });
    }
    return starter;
  }

  const resolveIntersectingInstances = (list, keepInstanceId = null) => {
    const out = [];
    for (const inst of list) {
      if (inst.instanceId === keepInstanceId) {
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

  const handleSelectInstance = (nextId) => {
    setInstances((prev) => resolveIntersectingInstances(prev, nextId));
    setSelectedId(nextId);
  };

  const handleRevertSelectedIntersection = () => {
    if (!selectedInstance) return;
    setInstances((prev) => resolveIntersectingInstances(prev, null));
    if (!selectedInstance.lastValidPosition) {
      setSelectedId(null);
    }
  };

  const handleAddPart = (part, customPos = null, customColor = null) => {
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
        : [
            ((instances.length % 5) - 2) * VEX_PITCH_MM * 2,
            VEX_PITCH_MM,
            Math.floor(instances.length / 5) * VEX_PITCH_MM * 2
          ]);

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

    setInstances((prev) => [...resolveIntersectingInstances(prev, null), newInst]);
    setSelectedId(newInst.instanceId);
    return newInst;
  };

  const handleUpdateTransform = (instanceId, patch) => {
    setInstances((prev) =>
      prev.map((inst) => {
        if (inst.instanceId !== instanceId) return inst;
        const updated = { ...inst, ...patch };
        if (updated.isIntersecting === false) {
          updated.lastValidPosition = [...updated.position];
          updated.lastValidRotation = [...updated.rotation];
        }
        return updated;
      })
    );
  };

  const handleDuplicateSelected = () => {
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
    setInstances((prev) => [...resolveIntersectingInstances(prev, null), copy]);
    setSelectedId(copy.instanceId);
  };

  const handleDeleteSelected = () => {
    if (!selectedId) return;
    setInstances((prev) => prev.filter((i) => i.instanceId !== selectedId));
    setSelectedId(null);
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
        handleUpdateTransform(selectedInstance.instanceId, {
          position: resolved.position,
          isIntersecting: resolved.isIntersecting
        });
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
    handleUpdateTransform(selectedInstance.instanceId, { position: nextPos });
  };

  // Keep WebMCP context ref up to date and register WebMCP tools on mount
  webMcpContextRef.current = {
    catalog,
    instances,
    selectedId,
    placePartAt: (part, pos, color) => handleAddPart(part, pos, color),
    configureViewport: ({
      transformMode: tm,
      showGrid: sg,
      showConnectors: sc,
      explodeMode: em,
      focusCamera
    }) => {
      if (tm) setTransformMode(tm);
      if (sg !== undefined) setShowGrid(Boolean(sg));
      if (sc !== undefined) setShowConnectors(Boolean(sc));
      if (em && EXPLODE_MODES.includes(em)) setExplodeMode(em);
      if (focusCamera) setFocusTrigger((c) => c + 1);
    },
    resetAssembly: (mode) => {
      setExplodeMode('off');
      if (mode === 'starter') {
        const starter = buildStarterAssembly(catalog);
        setInstances(starter);
        setSelectedId(starter[0]?.instanceId || null);
      } else {
        setInstances([]);
        setSelectedId(null);
      }
    }
  };

  useEffect(() => {
    return registerVexIqWebMcpTools(webMcpContextRef);
  }, []);

  // Global keyboard shortcuts for 3D Modeler
  useEffect(() => {
    const onKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key === 'w') {
        setTransformMode('translate');
      } else if (key === 'e') {
        setTransformMode('rotate');
      } else if (key === 'x') {
        setExplodeMode((prev) => {
          const nextIdx = (EXPLODE_MODES.indexOf(prev) + 1) % EXPLODE_MODES.length;
          return EXPLODE_MODES[nextIdx];
        });
      } else if (key === 'f') {
        setFocusTrigger((c) => c + 1);
      } else if (key === 'd' && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
        e.preventDefault();
        handleDuplicateSelected();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        handleDeleteSelected();
      } else if (e.key === 'Escape') {
        if (explodeMode !== 'off') {
          setExplodeMode('off');
        } else {
          setInstances((prev) => resolveIntersectingInstances(prev, null));
          setSelectedId(null);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const handleExportJson = () => {
    const validInstances = instances.filter((i) => !i.isIntersecting);
    const payload = {
      version: '1.0',
      pitchUnitMm: VEX_PITCH_MM,
      exportedAt: new Date().toISOString(),
      instances: validInstances
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vexiq-assembly-${new Date().toISOString().slice(0, 10)}.vexiq.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportJson = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (Array.isArray(parsed.instances)) {
          setExplodeMode('off');
          setInstances(parsed.instances);
          setSelectedId(null);
          setFocusTrigger((c) => c + 1);
        }
      } catch (err) {
        alert('Invalid .vexiq.json assembly file: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

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
            selectedId,
            viewport: {
              transformMode,
              snapPitchFactor,
              rotationSnapDeg,
              showGrid,
              showConnectors,
              explodeMode,
              focusTrigger
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
          setInstances(data.state.instances);
          if (data.state.selectedId !== undefined) {
            setSelectedId(data.state.selectedId);
          }
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
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              color: mcpConnected ? '#4ade80' : 'var(--text-muted)',
              fontWeight: 500
            }}
            title="Live MCP Server Bridge Status"
          >
            <Radio size={12} />
            {mcpConnected ? `MCP Live • ${catalog.length} Parts` : `${catalog.length} Parts`}
          </span>
        </div>

        {/* Transform, Snap & Explode Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
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

          <div className="toolbar-group" role="group" aria-label="VEX Pitch Snap">
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', padding: '0 5px' }}>
              Pitch:
            </span>
            {[
              { label: '1P', value: 1 },
              { label: '0.5P', value: 0.5 },
              { label: '0.25P', value: 0.25 },
              { label: 'Free', value: 0 }
            ].map((opt) => (
              <button
                key={opt.label}
                type="button"
                className={`btn ${snapPitchFactor === opt.value ? 'active' : ''}`}
                onClick={() => setSnapPitchFactor(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Explode View Controls: Off, X, Y, Z, All */}
          <div className="toolbar-group" role="group" aria-label="Explode Assembly View">
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 11,
                color: 'var(--text-secondary)',
                padding: '0 6px'
              }}
              title="Explode assembly along X, Y, Z, or All axes (Shortcut: X)"
            >
              <Expand size={13} />
              Explode:
            </span>
            {[
              { label: 'Off', value: 'off' },
              { label: 'X', value: 'x' },
              { label: 'Y', value: 'y' },
              { label: 'Z', value: 'z' },
              { label: 'All', value: 'all' }
            ].map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`btn ${explodeMode === opt.value ? 'active' : ''}`}
                onClick={() => setExplodeMode(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="toolbar-group">
            <button
              type="button"
              className={`btn ${showGrid ? 'active' : ''}`}
              onClick={() => setShowGrid((v) => !v)}
              title="Toggle VEX 12.7mm Pitch Grid"
            >
              <Grid size={14} />
              Grid
            </button>
            <button
              type="button"
              className={`btn ${showConnectors ? 'active' : ''}`}
              onClick={() => setShowConnectors((v) => !v)}
              title="Preview Analytic Pin/Shaft Hole Axes extracted from STEP file"
            >
              <Compass size={14} />
              Axes
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setFocusTrigger((c) => c + 1)}
              title="Frame Selected or All Parts (Shortcut: F)"
            >
              <Maximize2 size={14} />
              Focus
            </button>
          </div>
        </div>

        {/* Scene Actions: Starter, Export, Import */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => {
              setExplodeMode('off');
              const starter = buildStarterAssembly(catalog);
              setInstances(starter);
              setSelectedId(starter[1]?.instanceId || starter[0]?.instanceId || null);
              setFocusTrigger((c) => c + 1);
            }}
            title="Reset to sample starter parts"
          >
            <Sparkles size={14} />
            Starter
          </button>
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
            className="btn btn-outline"
            onClick={handleExportJson}
            disabled={instances.length === 0}
          >
            <Download size={14} />
            Save
          </button>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={14} />
            Load
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            style={{ display: 'none' }}
            onChange={handleImportJson}
          />
        </div>
      </header>

      {/* Main 3-Column Modeler Layout */}
      <div className="workspace-grid">
        {/* Left Sidebar: 478-Part VEX IQ Catalog with 3D Thumbnails */}
        <aside className="panel panel-left">
          <div className="panel-header">
            <div className="panel-title-row">
              <span>VEX IQ Part Library</span>
              <span>
                {filteredCatalog.length} / {catalog.length}
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
              {categories.map(([cat, count]) => (
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

          <div className="catalog-list scroller">
            {filteredCatalog.map((part, idx) => (
              <button
                key={part.id}
                type="button"
                className={`part-card ${idx >= 18 ? 'part-card-deferred' : ''}`}
                onClick={() => handleAddPart(part)}
              >
                <PartThumbnail part={part} index={idx} />
                <div className="part-info">
                  <div className="part-name" title={part.name}>
                    {part.name}
                  </div>
                  <div className="part-meta">
                    <span>{part.partNumber}</span>
                    <span>•</span>
                    <span>{part.connectorCount} holes/axes</span>
                  </div>
                </div>
                <span className="part-add-badge">+ Add</span>
              </button>
            ))}

            {filteredCatalog.length === 0 && (
              <div className="empty-state">
                No VEX IQ parts match "{searchQuery}".
              </div>
            )}
          </div>
        </aside>

        {/* Center 3D Viewport */}
        <main className="viewport-container">
          <Viewport3D
            instances={instances}
            catalogMap={catalogMap}
            selectedId={selectedId}
            onSelect={handleSelectInstance}
            onUpdateTransform={handleUpdateTransform}
            onRegisterFlushMover={handleRegisterFlushMover}
            transformMode={transformMode}
            snapPitchFactor={snapPitchFactor}
            rotationSnapDeg={rotationSnapDeg}
            showGrid={showGrid}
            showConnectors={showConnectors}
            explodeMode={explodeMode}
            focusTrigger={focusTrigger}
            onLoadingChange={setIsLoadingMesh}
            onMateFeedback={(message, isError) => setActionFeedback({ message, isError })}
          />

          <div className="viewport-hud-top">
            <div className="hud-pill">
              <Box size={14} style={{ color: '#60a5fa' }} />
              <span>
                <strong>1x VEX Pitch</strong> = 12.7 mm (0.5")
              </span>
              {explodeMode !== 'off' && (
                <span style={{ color: '#38bdf8', fontWeight: 600 }}>
                  • Explode: {explodeMode.toUpperCase()}
                </span>
              )}
              {isLoadingMesh && (
                <span style={{ color: '#93c5fd', marginLeft: 6 }}>• Loading mesh…</span>
              )}
            </div>

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
              <span>
                <kbd className="kbd">E</kbd> Rotate
              </span>
              <span>
                <kbd className="kbd">X</kbd> Cycle Explode
              </span>
              <span>
                <kbd className="kbd">D</kbd> Duplicate
              </span>
              <span>
                <kbd className="kbd">F</kbd> Focus
              </span>
              <span>
                <kbd className="kbd">Esc</kbd> Un-Explode / Cancel
              </span>
            </div>
          </div>
        </main>

        {/* Right Sidebar: Scene Assembly Outliner + Precision Inspector */}
        <aside className="panel panel-right">
          {/* Scene Outliner */}
          <section className="outliner-section">
            <div className="panel-header" style={{ padding: '10px 14px' }}>
              <div className="panel-title-row">
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Layers size={14} />
                  Assembly Outliner ({instances.length})
                </span>
                {instances.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-danger"
                    style={{ padding: '2px 7px', fontSize: 11 }}
                    onClick={() => {
                      setExplodeMode('off');
                      setInstances([]);
                      setSelectedId(null);
                    }}
                  >
                    Clear All
                  </button>
                )}
              </div>
            </div>

            <div className="instance-list scroller">
              {instances.map((inst) => {
                const isSelected = inst.instanceId === selectedId;
                return (
                  <div
                    key={inst.instanceId}
                    className={`instance-row ${isSelected ? 'selected' : ''}`}
                    onClick={() => handleSelectInstance(inst.instanceId)}
                  >
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 3,
                        background: inst.isIntersecting ? '#9ca3af' : inst.color,
                        opacity: inst.isIntersecting ? 0.5 : 1,
                        flexShrink: 0
                      }}
                    />
                    <span className="instance-row-name" title={inst.label}>
                      {inst.label}
                      {inst.isIntersecting && (
                        <span style={{ color: '#fca5a5', marginLeft: 6, fontSize: 11 }}>
                          (Intersecting)
                        </span>
                      )}
                    </span>

                    <button
                      type="button"
                      className="icon-btn"
                      title={inst.visible === false ? 'Show Part' : 'Hide Part'}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleUpdateTransform(inst.instanceId, {
                          visible: inst.visible === false
                        });
                      }}
                    >
                      {inst.visible === false ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>

                    <button
                      type="button"
                      className="icon-btn"
                      title={inst.locked ? 'Unlock Part' : 'Lock Part'}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleUpdateTransform(inst.instanceId, { locked: !inst.locked });
                      }}
                    >
                      {inst.locked ? <Lock size={13} /> : <Unlock size={13} />}
                    </button>
                  </div>
                );
              })}

              {instances.length === 0 && (
                <div className="empty-state">
                  Click any part in the left library to place it into the 3D workspace.
                </div>
              )}
            </div>
          </section>

          {/* Part Inspector */}
          <section className="inspector-section scroller">
            <div className="panel-header" style={{ padding: '10px 14px' }}>
              <div className="panel-title-row">
                <span>Part Inspector</span>
                {selectedInstance && (
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

            {selectedInstance && selectedPartMeta ? (
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
                            handleUpdateTransform(selectedInstance.instanceId, {
                              position: next
                            });
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
                            handleUpdateTransform(selectedInstance.instanceId, {
                              rotation: next
                            });
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
                        handleUpdateTransform(selectedInstance.instanceId, {
                          color: e.target.value
                        })
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

                {/* Smart Assembly & Fastening Tools (Manual CAD Workflow) */}
                <div className="field-group">
                  <div className="field-label">
                    <span>Smart Assembly &amp; Fastening</span>
                    <span style={{ color: '#38bdf8' }}>BVH Verified</span>
                  </div>

                  {actionFeedback && (
                    <div className={`action-toast ${actionFeedback.isError ? 'error' : ''}`}>
                      {actionFeedback.message}
                    </div>
                  )}

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
              </div>
            ) : (
              <div className="empty-state">
                Select a part in the 3D viewport or Assembly Outliner to inspect its VEX Pitch
                coordinates, use Auto-Fasten / Port Mating / Gear Train tools, or view its semantic
                ports.
              </div>
            )}
          </section>
        </aside>
      </div>

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
