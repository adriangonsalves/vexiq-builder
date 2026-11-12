import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GitBranch, Pause, Play, SkipForward } from 'lucide-react';
import { applyOps, branchesAt, currentLine, pathTo } from '../utils/buildHistory.js';
import HelpQ from '../help/HelpQ.jsx';

// Mark colors per step source (see the legend in the bar)
export const SOURCE_COLORS = { app: '#60a5fa', mcp: '#f59e0b', assistant: '#c084fc', action: '#34d399' };
const SOURCE_NAMES = { app: 'App', mcp: 'MCP', assistant: 'Assistant', action: 'Smart action' };
const SNAPSHOT_EVERY = 100; // steps between cached part lists, so any position is a short replay away
const PLAY_RATE = 6; // positions per second at 1x
const SPEEDS = [1, 2, 4];

const timeOf = (at) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const opCounts = (step) => {
  const n = (kind) => step.ops.filter((o) => o.op === kind).length;
  const bits = [];
  if (n('add')) bits.push(`${n('add')} added`);
  if (n('remove')) bits.push(`${n('remove')} removed`);
  if (n('update')) bits.push(`${n('update')} changed`);
  return bits.join(', ');
};

/**
 * Positions on the current line: the start, then for each step one position per part it touches
 * (a step that adds 72 parts plays them one at a time), ending on the step's boundary.
 * { step: 1-based step number (0 = start), opCount: ops applied of that step, boundary }
 */
function buildPositions(line) {
  const positions = [{ step: 0, opCount: 0, boundary: true }];
  line.forEach((s, i) => {
    const n = Math.max(1, s.ops.length);
    for (let k = 1; k <= n; k += 1) positions.push({ step: i + 1, opCount: k, boundary: k === n });
  });
  return positions;
}

/**
 * The build history as a bar under the 3D view: marks per step, scrubbing, part-by-part playback
 * inside multi-part steps, Play, hover tips and branch menus.
 * Scrubbing previews (read-only) through `onPreview(parts | null, info)`; stopping on a step's
 * boundary calls `onMoveTo(stepId | null)` to make it the current step.
 */
export default function HistoryTimeline({ history, onMoveTo, onPreview, onHelp }) {
  const line = useMemo(() => currentLine(history), [history]);
  const positions = useMemo(() => buildPositions(line), [line]);
  const headStep = useMemo(() => pathTo(history, history.headId).length, [history]);
  const headPos = useMemo(() => positions.findIndex((p) => p.boundary && p.step === headStep), [positions, headStep]);
  const boundaryIndexOfStep = useMemo(() => {
    const map = new Map();
    positions.forEach((p, i) => p.boundary && map.set(p.step, i));
    return map;
  }, [positions]);

  // Part lists at every SNAPSHOT_EVERY-th step boundary, built once per line
  const snapshots = useMemo(() => {
    const out = [JSON.parse(JSON.stringify(history.base))];
    let parts = out[0];
    line.forEach((s, i) => {
      parts = applyOps(parts, s.ops);
      if ((i + 1) % SNAPSHOT_EVERY === 0) out.push(parts);
    });
    return out;
  }, [history.base, line]);

  const partsAt = useCallback(
    (pos) => {
      const { step, opCount } = positions[pos];
      const fullSteps = step === 0 ? 0 : positions[pos].boundary ? step : step - 1;
      const snap = Math.min(Math.floor(fullSteps / SNAPSHOT_EVERY), snapshots.length - 1);
      let parts = snapshots[snap];
      for (let i = snap * SNAPSHOT_EVERY; i < fullSteps; i += 1) parts = applyOps(parts, line[i].ops);
      if (!positions[pos].boundary && step > 0) parts = applyOps(parts, line[step - 1].ops, opCount);
      return parts;
    },
    [positions, snapshots, line]
  );

  // previewPos: null = showing the current step; otherwise the position being previewed
  const [previewPos, setPreviewPos] = useState(null);
  const [playing, setPlayingState] = useState(false);
  // Also kept in a ref, so a play tick already queued never runs after playback was stopped
  const playingRef = useRef(false);
  const setPlaying = useCallback((value) => {
    playingRef.current = value;
    setPlayingState(value);
  }, []);
  const [speed, setSpeed] = useState(1);
  const [hover, setHover] = useState(null); // { x, step }
  const [branchMenu, setBranchMenu] = useState(null); // { x, stepNumber, branches }
  const trackRef = useRef(null);
  const canvasRef = useRef(null);
  const draggingRef = useRef(false);
  const ownMoveRef = useRef(null); // set while our own onMoveTo is changing the history
  const playPosRef = useRef(null); // position Play has reached
  const [width, setWidth] = useState(600);

  const shownPos = previewPos ?? headPos;

  const showPosition = useCallback(
    (pos) => {
      if (pos === headPos) {
        setPreviewPos(null);
        onPreview(null);
        return;
      }
      const p = positions[pos];
      setPreviewPos(pos);
      onPreview(partsAt(pos), {
        midStep: !p.boundary,
        step: p.step,
        part: p.opCount,
        parts: p.step > 0 ? line[p.step - 1].ops.length : 0,
        label: p.step > 0 ? line[p.step - 1].label : 'Start'
      });
    },
    [headPos, positions, partsAt, onPreview, line]
  );

  // Make a boundary position the current step (the preview ends)
  const commitPosition = useCallback(
    (pos) => {
      const p = positions[pos];
      if (!p.boundary) return;
      setPreviewPos(null);
      onPreview(null);
      if (pos !== headPos) {
        ownMoveRef.current = true;
        onMoveTo(p.step === 0 ? null : line[p.step - 1].id);
      }
    },
    [positions, headPos, onPreview, onMoveTo, line]
  );

  // Any change from outside (an edit, undo/redo, MCP) stops playback and ends the preview
  const lastHistoryRef = useRef(history);
  useEffect(() => {
    if (lastHistoryRef.current === history) return;
    lastHistoryRef.current = history;
    if (ownMoveRef.current) {
      ownMoveRef.current = null;
      return;
    }
    setPlaying(false);
    playPosRef.current = null;
    setPreviewPos(null);
    onPreview(null);
  }, [history, onPreview, setPlaying]);

  // Leaving (hiding the timeline) returns the view to the current step
  useEffect(() => () => onPreview(null), [onPreview]);

  // Play: step through every position at an even pace, ending on the last step. Each position is
  // scheduled after the previous one has been shown, so a slow redraw never builds up a backlog.
  useEffect(() => {
    if (!playing) return undefined;
    const timer = setTimeout(() => {
      if (!playingRef.current) return;
      const next = (playPosRef.current ?? headPos) + 1;
      if (next >= positions.length - 1) {
        playPosRef.current = null;
        setPlaying(false);
        commitPosition(positions.length - 1);
        return;
      }
      playPosRef.current = next;
      showPosition(next);
    }, 1000 / (PLAY_RATE * speed));
    return () => clearTimeout(timer);
  }, [playing, speed, previewPos, positions, headPos, showPosition, commitPosition, setPlaying]);

  const togglePlay = () => {
    if (playing) {
      // Pause on the position reached: a boundary becomes the current step, mid-step stays a preview
      setPlaying(false);
      if (previewPos !== null && positions[previewPos]?.boundary) commitPosition(previewPos);
      return;
    }
    if (positions.length < 2) return;
    // From the start when at the end, otherwise from where the view is
    const from = shownPos >= positions.length - 1 ? 0 : shownPos;
    if (from !== shownPos) showPosition(from);
    playPosRef.current = from;
    setBranchMenu(null);
    setPlaying(true);
  };

  // --- Drawing --------------------------------------------------------------------------------------
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setWidth(Math.max(100, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const xOf = useCallback((pos) => (positions.length <= 1 ? 0 : (pos / (positions.length - 1)) * width), [positions.length, width]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const height = 26;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    // Track
    ctx.fillStyle = 'rgba(148, 163, 184, 0.18)';
    ctx.fillRect(0, height / 2 - 2, width, 4);
    // Reached part of the line
    ctx.fillStyle = 'rgba(96, 165, 250, 0.35)';
    ctx.fillRect(0, height / 2 - 2, xOf(shownPos), 4);
    // One mark per step; with more steps than pixels, later marks in a column draw over earlier ones
    line.forEach((s, i) => {
      const x = Math.round(xOf(boundaryIndexOfStep.get(i + 1)));
      ctx.fillStyle = SOURCE_COLORS[s.source] || SOURCE_COLORS.app;
      ctx.globalAlpha = i + 1 > headStep ? 0.45 : 1;
      ctx.fillRect(Math.max(0, x - 1), 5, 2, height - 10);
    });
    ctx.globalAlpha = 1;
    // Handle
    const hx = xOf(shownPos);
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.arc(Math.min(Math.max(hx, 6), width - 6), height / 2, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = previewPos !== null && !positions[previewPos]?.boundary ? '#f59e0b' : '#2563eb';
    ctx.lineWidth = 2;
    ctx.stroke();
  }, [width, line, xOf, shownPos, headStep, boundaryIndexOfStep, previewPos, positions]);

  // --- Pointer --------------------------------------------------------------------------------------
  const posAtX = (clientX) => {
    const rect = trackRef.current.getBoundingClientRect();
    const t = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    return Math.round(t * (positions.length - 1));
  };
  const stepAtX = (clientX) => {
    const pos = posAtX(clientX);
    return positions[pos].step;
  };

  // While dragging, show only the latest position once per frame
  const scrubFrameRef = useRef({ raf: 0, pos: null });
  const scrubTo = (pos) => {
    const frame = scrubFrameRef.current;
    frame.pos = pos;
    if (frame.raf) return;
    frame.raf = requestAnimationFrame(() => {
      frame.raf = 0;
      if (draggingRef.current) showPosition(frame.pos);
    });
  };

  const onPointerDown = (e) => {
    if (positions.length < 2) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    setPlaying(false);
    setBranchMenu(null);
    showPosition(posAtX(e.clientX));
  };
  const onPointerMove = (e) => {
    const rect = trackRef.current.getBoundingClientRect();
    setHover({ x: e.clientX - rect.left, step: stepAtX(e.clientX) });
    if (draggingRef.current) scrubTo(posAtX(e.clientX));
  };
  const onPointerUp = (e) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    // Released on a step's boundary: that step becomes current. Mid-step: the preview stays.
    const pos = posAtX(e.clientX);
    if (positions[pos].boundary) commitPosition(pos);
    else showPosition(pos);
  };

  const branchPoints = useMemo(() => {
    const out = [];
    [null, ...line.map((s) => s.id)].forEach((id, i) => {
      const branches = branchesAt(history, id);
      if (branches.length > 1) out.push({ stepNumber: i, branches });
    });
    return out;
  }, [history, line]);

  const hoverStep = hover && hover.step > 0 ? line[hover.step - 1] : null;
  const shown = positions[shownPos] || positions[0];
  const midStep = !shown.boundary;

  return (
    <div className="history-timeline" role="region" aria-label="Build history timeline">
      <div className="history-controls">
        <HelpQ tool="History" onHelp={onHelp} />
        <button type="button" className="btn" data-help="play" onClick={togglePlay} disabled={positions.length < 2} title={playing ? 'Pause' : 'Play the build from the start'} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <div className="toolbar-group history-speed" role="group" aria-label="Playback speed">
          {SPEEDS.map((v) => (
            <button key={v} type="button" className={`btn ${speed === v ? 'active' : ''}`} data-help={`speed-${v}`} onClick={() => setSpeed(v)}>
              {v}×
            </button>
          ))}
        </div>
        <span className="history-count" aria-live="polite">
          Step {shown.step} of {line.length}
          {midStep && ` · part ${shown.opCount} of ${line[shown.step - 1].ops.length}`}
        </span>
        <span className="history-legend">
          {Object.entries(SOURCE_COLORS).map(([key, color]) => (
            <span key={key}>
              <i style={{ background: color }} />
              {SOURCE_NAMES[key]}
            </span>
          ))}
        </span>
      </div>

      <div
        className="history-track"
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHover(null)}
        role="slider"
        aria-label="Build history position"
        aria-valuemin={0}
        aria-valuemax={line.length}
        aria-valuenow={shown.step}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          const target = Math.min(Math.max(shown.step + (e.key === 'ArrowRight' ? 1 : -1), 0), line.length);
          commitPosition(boundaryIndexOfStep.get(target));
        }}
      >
        <canvas ref={canvasRef} />
        {branchPoints.map((bp) => (
          <button
            key={`branch-${bp.stepNumber}`}
            type="button"
            className="history-branch-marker"
            style={{ left: xOf(boundaryIndexOfStep.get(bp.stepNumber)) }}
            title={`${bp.branches.length} branches continue after step ${bp.stepNumber}`}
            aria-label={`Branches after step ${bp.stepNumber}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setBranchMenu((m) => (m?.stepNumber === bp.stepNumber ? null : { x: xOf(boundaryIndexOfStep.get(bp.stepNumber)), ...bp }));
            }}
          >
            <GitBranch size={11} />
          </button>
        ))}
        {hoverStep && !draggingRef.current && (
          <div className="history-tip" style={{ left: hover.x }}>
            <strong>{hoverStep.label}</strong>
            <span>
              {SOURCE_NAMES[hoverStep.source] || hoverStep.source} · {timeOf(hoverStep.at)}
              {opCounts(hoverStep) && ` · ${opCounts(hoverStep)}`}
            </span>
          </div>
        )}
        {branchMenu && (
          <div className="history-branch-menu" style={{ left: branchMenu.x }} onPointerDown={(e) => e.stopPropagation()}>
            <div className="history-branch-title">Branches after step {branchMenu.stepNumber}</div>
            {branchMenu.branches.map((b) => (
              <button
                key={b.id}
                type="button"
                className={`history-branch-item ${b.active ? 'active' : ''}`}
                onClick={() => {
                  setBranchMenu(null);
                  setPreviewPos(null);
                  onPreview(null);
                  ownMoveRef.current = true;
                  onMoveTo(b.leafId);
                }}
              >
                <span className="history-branch-label">{b.label}</span>
                <span className="history-branch-meta">
                  {b.length} step{b.length === 1 ? '' : 's'} · {timeOf(b.at)}
                  {b.active ? ' · current' : ''}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {midStep && !playing && (
        <div className="history-banner" role="status">
          Showing step {shown.step} part-way ({shown.opCount} of {line[shown.step - 1].ops.length} parts). This view can't be edited.
          <button type="button" className="btn btn-outline" data-help="go-to-end-of-step" onClick={() => commitPosition(boundaryIndexOfStep.get(shown.step))}>
            <SkipForward size={12} />
            Go to end of step
          </button>
        </div>
      )}
    </div>
  );
}
