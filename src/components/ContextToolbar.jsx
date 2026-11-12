import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, Copy, Move, RotateCw, Trash2, X } from 'lucide-react';
import PopoverMenu, { MenuItem } from './PopoverMenu.jsx';
import ThumbWheel from './ThumbWheel.jsx';
import {
  AddToSelectionIcon,
  FreeMoveIcon,
  GrowSelectionIcon,
  AutoJoinIcon,
  ManualJoinIcon,
  MarkHoleIcon,
  OnePartOfGroupIcon,
  PinsOnlyIcon,
  StampCopiesIcon,
  TurnStepIcon,
  WorldArrowsIcon
} from './toolbarIcons.jsx';

/**
 * The context bar in the 3D view (openspec context-toolbar): a column of icon buttons on the right
 * edge of the working view, under the view cube, showing what can be done now. `items` come from
 * barItems() (src/utils/contextToolbarItems.js); `on` says which switches are on (tapped on, or their
 * key held). While a wheel session runs, `stepper` replaces the buttons with the thumb wheel, its
 * read-out, the session's extras and its tick and cross.
 */

const TURN_STEPS = [
  { label: '15°', value: 15 },
  { label: '45°', value: 45 },
  { label: '90°', value: 90 },
  { label: 'Free', value: 0 }
];
export const turnStepLabel = (deg) => TURN_STEPS.find((s) => s.value === deg)?.label ?? `${deg}°`;

// Name, one line on what it does, and the keys or mouse gesture that do the same
const TIPS = {
  move: ['Move', 'Slide the part along its arrows', 'W'],
  rotate: ['Rotate', 'Turn the part with its rings', 'E · right-click the part'],
  addToSelection: ['Add to selection', 'Tap parts to add or take them out', 'Shift + click'],
  markHole: ['Mark a hole', 'Tap the hole or pin end the next part goes in', 'Alt + click'],
  join: ['Manual Join', 'Pick the hole the part goes into', 'Double-click the part'],
  autoJoin: ['Auto Join', "Push the part into what it's lined up with", 'Double-click the part'],
  stampCopies: ['Stamp copies', 'Put a copy of this part in each hole you pick', 'Ctrl/Cmd + double-click'],
  worldArrows: ['World arrows', 'Arrows follow the room, not the part', 'Hold Alt'],
  freeMove: ['Free move', 'Stop parts jumping onto holes', 'Hold Alt while dragging'],
  turnStep: ['Turn step', 'How far each turn step goes', null],
  growSelection: ['Grow selection', 'Add the parts joined to this one, layer by layer', 'Shift + wheel'],
  onePartOfGroup: ['One part of a group', 'Pick a single part inside the group', 'Shift + Alt + click'],
  duplicate: ['Duplicate', 'Make a copy next to it', 'D'],
  delete: ['Delete', 'Remove it (Undo brings it back)', 'Del'],
  wheel: ['Wheel', 'Turn it for the next or previous one', 'Mouse wheel'],
  stepUp: ['Next', 'Step to the next one', 'R'],
  stepDown: ['Previous', 'Step back one', 'Shift + R'],
  cancel: ['Cancel', 'Stop without changing anything', 'Esc'],
  pinsOnly: ['Pins only', 'Only follow pins and shafts', 'Ctrl/Cmd + Shift + wheel']
};
const COMMIT_TIPS = {
  fits: ['Put it in', 'Put the part in at the fit shown', 'Click the lit hole'],
  stamp: ['Put a copy in', 'Insert a copy at the fit shown and keep going', 'Ctrl/Cmd + double-click'],
  bendFits: ['Keep', 'Keep this bend', 'Enter'],
  ring: ['Done', 'Finish turning with this ring', 'Esc'],
  layers: ['Done', 'Keep this selection', null],
  band: ['Add this spot', 'Add the lit spot to the band', 'Click the spot']
};
const SEPARATED = new Set(['addToSelection', 'join', 'duplicate']); // a divider above these
// Switches and modes, which show on or off (aria-pressed); the rest are actions
const TOGGLES = new Set(['move', 'rotate', 'addToSelection', 'markHole', 'stampCopies', 'worldArrows', 'freeMove', 'growSelection', 'onePartOfGroup', 'pinsOnly']);
// What may be open along the bottom of the view: the history timeline, the Audit panel, the shortcuts strip
const BOTTOM_OVERLAYS = ['.history-timeline', '.audit-panel.open', '.viewport-hud-bottom .shortcuts-bar'];
// On a phone the bar is on the left, where the band builder's panel sits along the bottom
const LEFT_BOTTOM_OVERLAYS = [...BOTTOM_OVERLAYS, '.band-panel'];
const LEFT_TOP = 64; // under the phone's warning button

function iconFor(id, { on, hasTarget, turnStep, joinKind }) {
  switch (id) {
    case 'move':
      return <Move size={18} />;
    case 'rotate':
      return <RotateCw size={18} />;
    case 'addToSelection':
      return <AddToSelectionIcon />;
    case 'markHole':
      return <MarkHoleIcon set={hasTarget} />;
    case 'join':
      return joinKind === 'auto' ? <AutoJoinIcon /> : <ManualJoinIcon />;
    case 'stampCopies':
      return <StampCopiesIcon />;
    case 'worldArrows':
      return <WorldArrowsIcon on={on} />;
    case 'freeMove':
      return <FreeMoveIcon on={on} />;
    case 'turnStep':
      return <TurnStepIcon value={turnStepLabel(turnStep)} />;
    case 'growSelection':
      return <GrowSelectionIcon />;
    case 'onePartOfGroup':
      return <OnePartOfGroupIcon />;
    case 'duplicate':
      return <Copy size={18} />;
    case 'delete':
      return <Trash2 size={18} />;
    case 'pinsOnly':
      return <PinsOnlyIcon />;
    case 'commit':
      return <Check size={20} />;
    case 'cancel':
      return <X size={20} />;
    default:
      return null;
  }
}

/** Where the bar goes and how many rows its columns have, from the room under the cube. */
function useBarPlace(barRef, measureKey, side) {
  const [place, setPlace] = useState({ rows: 20, beside: false, room: 2000 });
  const measure = useCallback(() => {
    const bar = barRef.current;
    const container = bar?.closest('.viewport-container');
    if (!bar || !container) return;
    const css = getComputedStyle(bar);
    const btn = parseFloat(css.getPropertyValue('--ctx-btn')) || 32;
    const gap = parseFloat(css.getPropertyValue('--ctx-gap')) || 4;
    const height = container.clientHeight;
    // The bar ends above whatever is open along the bottom of the view (layout tops, not transforms)
    const topOf = (el) => {
      let t = 0;
      for (let n = el; n && n !== container; n = n.offsetParent) t += n.offsetTop;
      return t;
    };
    let bottom = height - 12;
    for (const sel of side === 'left' ? LEFT_BOTTOM_OVERLAYS : BOTTOM_OVERLAYS) {
      const el = container.querySelector(sel);
      if (!el || el.offsetParent === null) continue; // not shown (display: none)
      bottom = Math.min(bottom, topOf(el) - 8); // layout top: the Audit panel's slide doesn't count
    }
    const pitch = btn + gap + 1;
    const top = side === 'left' ? LEFT_TOP : 182;
    const under = Math.floor((bottom - top - 8) / pitch);
    const beside = side !== 'left' && under < 4; // the right side moves beside the cube when short
    const room = bottom - (beside ? 60 : top);
    const rows = Math.max(1, Math.floor((room - 8) / pitch));
    setPlace((cur) => (cur.rows === rows && cur.beside === beside && cur.room === room ? cur : { rows, beside, room }));
  }, [barRef, side]);
  useLayoutEffect(() => {
    measure();
    const t = setTimeout(measure, 260); // after the Audit panel's slide
    return () => clearTimeout(t);
  }, [measure, measureKey]);
  useEffect(() => {
    const container = barRef.current?.closest('.viewport-container');
    if (!container || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    for (const sel of ['.history-timeline', '.audit-panel', '.viewport-hud-bottom .shortcuts-bar', '.band-panel']) {
      const el = container.querySelector(sel);
      if (el) ro.observe(el);
    }
    return () => ro.disconnect();
  }, [measure, measureKey]);
  return place;
}

/** The tip: name, one line, and the keys (not on touch); kept inside the window. */
function BarTip({ tip, side }) {
  const ref = useRef(null);
  const [top, setTop] = useState(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !tip) return;
    const h = el.getBoundingClientRect().height;
    const centre = tip.rect.top + tip.rect.height / 2;
    setTop(Math.max(8, Math.min(centre - h / 2, window.innerHeight - h - 8)));
  }, [tip]);
  if (!tip) return null;
  const [name, line, keys] = tip.text;
  return (
    <div
      ref={ref}
      className="ctx-tip"
      role="tooltip"
      style={
        side === 'left'
          ? { left: tip.rect.right + 8, top: top ?? tip.rect.top, maxWidth: Math.max(160, window.innerWidth - tip.rect.right - 24) }
          : { right: Math.max(8, window.innerWidth - tip.rect.left + 8), top: top ?? tip.rect.top, maxWidth: Math.max(160, tip.rect.left - 24) }
      }
    >
      <strong>{name}</strong>
      {line && <span>{line}</span>}
      {tip.reason && <span className="ctx-tip-reason">{tip.reason}</span>}
      {keys && !tip.touch && (
        <span className="ctx-tip-keys">
          {keys.split(' · ').map((part) => (
            <span key={part}>
              {part.split(' + ').map((k, i) => (
                <React.Fragment key={k}>
                  {i > 0 && ' + '}
                  <kbd className="kbd">{k}</kbd>
                </React.Fragment>
              ))}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

export default function ContextToolbar({ items, on = {}, hasTarget = false, turnStep = 15, joinKind = 'manual', side = 'right', onTurnStep, onPress, onInputKind, stepper = null, measureKey = '' }) {
  const barRef = useRef(null);
  const place = useBarPlace(barRef, `${measureKey}|${items.length}|${stepper?.kind ?? ''}`, side);
  const [tip, setTip] = useState(null); // { id, rect, text, reason, touch }
  const [turnMenu, setTurnMenu] = useState(null); // { x, y }
  const tipTimer = useRef(0);
  const heldRef = useRef(false); // a touch hold showed the tip: the click that follows is dropped

  const tipText = (id) => {
    if (id === 'commit') return COMMIT_TIPS[stepper?.commitTip || stepper?.kind] || [id, '', null];
    // The step buttons name R / Shift+R only in the sessions R steps
    if (id === 'join' && joinKind === 'auto') return TIPS.autoJoin;
    if ((id === 'stepUp' || id === 'stepDown') && stepper) return [TIPS[id][0], TIPS[id][1], stepper.stepKeys ? stepper.stepKeys[id === 'stepUp' ? 0 : 1] : 'Mouse wheel'];
    return TIPS[id] || [id, '', null];
  };
  const showTipFor = (el, touch) => {
    const id = el.dataset.tip;
    const item = items.find((i) => i.id === id);
    setTip({ id, rect: el.getBoundingClientRect(), text: tipText(id), reason: item?.disabledReason || (id === 'wheel' ? stepper?.emptyText : null), touch });
  };
  const hideTip = () => {
    clearTimeout(tipTimer.current);
    setTip(null);
  };
  useEffect(() => () => clearTimeout(tipTimer.current), []);
  const itemKey = items.map((i) => i.id).join(',');
  useEffect(hideTip, [itemKey, stepper?.kind]); // the buttons changed: the tip's button may be gone

  // Tips: mouse rest or keyboard focus shows them; a touch hold shows them and drops the click
  const tipHandlers = {
    onPointerEnter: (e) => {
      if (e.pointerType !== 'mouse') return;
      const el = e.target.closest('[data-tip]');
      if (!el) return;
      clearTimeout(tipTimer.current);
      tipTimer.current = setTimeout(() => showTipFor(el, false), 500);
    },
    onPointerOver: (e) => {
      if (e.pointerType !== 'mouse') return;
      const el = e.target.closest('[data-tip]');
      if (!el || tip?.id === el.dataset.tip) return;
      clearTimeout(tipTimer.current);
      if (tip) showTipFor(el, false);
      else tipTimer.current = setTimeout(() => showTipFor(el, false), 500);
    },
    onPointerLeave: hideTip,
    onFocus: (e) => {
      const el = e.target.closest('[data-tip]');
      if (el && el.matches(':focus-visible')) showTipFor(el, false);
    },
    onBlur: hideTip
  };

  const onBarPointerDown = (e) => {
    e.stopPropagation(); // never reaches the view, the drawers or the camera
    onInputKind?.(e.pointerType === 'mouse' ? 'mouse' : 'touch');
    if (e.pointerType === 'mouse') {
      hideTip();
      return;
    }
    const el = e.target.closest('[data-tip]');
    heldRef.current = false;
    clearTimeout(tipTimer.current);
    if (!el || el.classList.contains('ctx-wheel')) return;
    tipTimer.current = setTimeout(() => {
      heldRef.current = true;
      showTipFor(el, true);
    }, 500);
  };
  const onBarPointerUp = (e) => {
    e.stopPropagation();
    if (e.pointerType !== 'mouse') {
      clearTimeout(tipTimer.current);
      if (heldRef.current) setTimeout(() => setTip(null), 0);
    }
  };
  const stop = (e) => e.stopPropagation();

  const press = (id, e) => {
    if (heldRef.current) {
      heldRef.current = false; // the hold showed the tip: lifting the finger doesn't press
      e.preventDefault();
      return;
    }
    const item = items.find((i) => i.id === id);
    if (item?.state === 'disabled') {
      // A greyed button says why instead
      const kind = e.nativeEvent?.pointerType;
      showTipFor(e.currentTarget, Boolean(kind && kind !== 'mouse'));
      return;
    }
    if (id === 'turnStep') {
      const r = e.currentTarget.getBoundingClientRect();
      setTurnMenu(turnMenu ? null : { x: side === 'left' ? r.right + 8 : r.left - 132, y: r.top });
      return;
    }
    onPress?.(id, e);
  };

  const button = (item) => {
    const isOn = item.state === 'on' || Boolean(on[item.id]);
    const disabled = item.state === 'disabled';
    const [name] = tipText(item.id);
    const label = item.id === 'turnStep' ? `${name}: ${turnStepLabel(turnStep)}` : name;
    return (
      <button
        key={item.id}
        type="button"
        className={['ctx-btn', isOn ? 'on' : '', disabled ? 'disabled' : '', SEPARATED.has(item.id) ? 'sep' : '', item.id === 'delete' ? 'danger' : ''].filter(Boolean).join(' ')}
        data-tip={item.id}
        aria-label={label}
        aria-pressed={TOGGLES.has(item.id) ? isOn : undefined}
        aria-disabled={disabled || undefined}
        onClick={(e) => press(item.id, e)}
      >
        {iconFor(item.id, { on: isOn, hasTarget, turnStep, joinKind })}
      </button>
    );
  };

  if (!items.length) return null;

  const style = {
    // As many rows as fit (more columns grow to the left), but no empty rows
    '--ctx-rows': Math.max(1, Math.min(place.rows, stepper ? items.length : Math.ceil(items.length / Math.ceil(items.length / place.rows)))),
    ...(place.beside ? { top: 60, right: 'calc(var(--ctx-right, 12px) + 122px)' } : null)
  };
  const shared = {
    ref: barRef,
    style,
    onPointerDown: onBarPointerDown,
    onPointerUp: onBarPointerUp,
    onClick: stop,
    onDoubleClick: stop,
    onContextMenu: (e) => e.preventDefault(),
    ...tipHandlers
  };

  let body;
  if (stepper) {
    const has = (id) => items.find((i) => i.id === id);
    const extras = items.filter((i) => ['turnStep', 'worldArrows', 'pinsOnly', 'commit', 'cancel'].includes(i.id));
    const wheel = has('wheel');
    body = (
      <div className={`ctx-bar ctx-bar-wheel ${side === 'left' ? 'ctx-bar-left' : ''} ${place.room < 420 ? 'wide' : ''}`} role="toolbar" aria-label="Wheel" aria-orientation="vertical" {...shared}>
        {wheel && (
          <div className="ctx-wheel-group">
            {stepper.readout && (
              <span className={`ctx-readout ${wheel.state === 'disabled' ? 'muted' : ''}`} aria-live="polite">
                {stepper.readout}
              </span>
            )}
            <ThumbWheel canStep={wheel.state !== 'disabled'} onStep={stepper.onStep} position={stepper.position ?? 0} awayDir={stepper.awayDir ?? 1} disabledReason={wheel.disabledReason} />
          </div>
        )}
        <div className="ctx-wheel-actions">{extras.map(button)}</div>
      </div>
    );
  } else {
    body = (
      <div className={`ctx-bar ${side === 'left' ? 'ctx-bar-left' : ''}`} role="toolbar" aria-label="Context bar" aria-orientation="vertical" {...shared}>
        {items.map(button)}
      </div>
    );
  }

  return (
    <>
      {body}
      <BarTip tip={tip} side={side} />
      {turnMenu && (
        <PopoverMenu at={turnMenu} onClose={() => setTurnMenu(null)} label="Turn step">
          {TURN_STEPS.map((s) => (
            <MenuItem
              key={s.value}
              checked={turnStep === s.value}
              onSelect={() => {
                onTurnStep?.(s.value);
                setTurnMenu(null);
              }}
            >
              {s.label}
            </MenuItem>
          ))}
        </PopoverMenu>
      )}
    </>
  );
}
