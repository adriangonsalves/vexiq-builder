import React, { useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

const STEP_PX = 24; // travel per step
const RIDGE_PX = 8; // how far the ridges shift per step

/**
 * A thumb wheel seen edge-on (openspec context-toolbar, design Decision 8). Dragging it up or down
 * steps once every 24 px (up = +1), with no momentum; the mouse wheel over it steps as it does over
 * the view (`awayDir`: the step for turning it away from you), and a
 * chevron at each end steps once. `position` (a fit index, layer, angle in steps…) shifts the ridges,
 * so the wheel turns whatever made the step. Greyed while `canStep` is false. Its presses never reach
 * the 3D view, so dragging it doesn't turn the camera.
 */
export default function ThumbWheel({ canStep, onStep, position = 0, awayDir = 1, label = 'Wheel', disabledReason = null }) {
  const wheelRef = useRef(null);
  const dragRef = useRef(null); // { pointerId, y, travelled }
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;
  const canStepRef = useRef(canStep);
  canStepRef.current = canStep;
  const awayDirRef = useRef(awayDir);
  awayDirRef.current = awayDir;

  // The mouse wheel over it steps (non-passive, so the page doesn't scroll)
  useEffect(() => {
    const el = wheelRef.current;
    if (!el) return undefined;
    let accum = 0;
    const onWheel = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!canStepRef.current) return;
      accum += e.deltaY;
      if (Math.abs(accum) >= 40) {
        // Turning the mouse wheel away steps as it does over the 3D view in this session
        onStepRef.current?.(accum < 0 ? awayDirRef.current : -awayDirRef.current);
        accum = 0;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = (e) => {
    e.stopPropagation();
    if (!canStep) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { pointerId: e.pointerId, y: e.clientY };
  };
  const onPointerMove = (e) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    let dy = e.clientY - drag.y;
    while (Math.abs(dy) >= STEP_PX) {
      const dir = dy < 0 ? 1 : -1; // up is +1
      onStepRef.current?.(dir);
      drag.y += dir > 0 ? -STEP_PX : STEP_PX;
      dy = e.clientY - drag.y;
    }
  };
  const endDrag = (e) => {
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
  };

  const ridges = { backgroundPositionY: `${-position * RIDGE_PX}px` };
  return (
    <div className={`ctx-wheel-wrap ${canStep ? '' : 'disabled'}`}>
      <button type="button" className="ctx-btn ctx-wheel-step" aria-label="Next" data-tip="stepUp" aria-disabled={!canStep} onClick={() => canStep && onStep(1)}>
        <ChevronUp size={18} />
      </button>
      <div
        ref={wheelRef}
        className="ctx-wheel"
        role="slider"
        aria-label={label}
        aria-disabled={!canStep}
        aria-valuetext={disabledReason || undefined}
        data-tip="wheel"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="ctx-wheel-ridges" style={ridges} />
      </div>
      <button type="button" className="ctx-btn ctx-wheel-step" aria-label="Previous" data-tip="stepDown" aria-disabled={!canStep} onClick={() => canStep && onStep(-1)}>
        <ChevronDown size={18} />
      </button>
    </div>
  );
}
