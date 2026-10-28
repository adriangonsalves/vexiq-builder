import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * A small floating menu at window point `at` ({ x, y }), kept inside the window. `Esc`, a press
 * outside it, or a right-click elsewhere closes it (`onClose`). Used by the view cube's menu and the
 * toolbar drop-downs (openspec view-cube-menu, app-settings).
 */
export default function PopoverMenu({ at, onClose, children, label }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: at.x, top: at.y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const margin = 8;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(margin, Math.min(at.x, window.innerWidth - width - margin)),
      top: Math.max(margin, Math.min(at.y, window.innerHeight - height - margin))
    });
  }, [at.x, at.y]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const onPress = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPress, true);
    window.addEventListener('contextmenu', onPress, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPress, true);
      window.removeEventListener('contextmenu', onPress, true);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="popover-menu" role="menu" aria-label={label} style={pos}>
      {children}
    </div>
  );
}

/** A menu row: a choice (`checked` marks the current one) or a switch (`checked` on/off). */
export function MenuItem({ checked, onSelect, children, title, icon: Icon }) {
  return (
    <button
      type="button"
      role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={checked === undefined ? undefined : Boolean(checked)}
      className={`popover-item ${checked ? 'checked' : ''}`}
      onClick={onSelect}
      title={title}
    >
      <span className="popover-check">{checked ? '✓' : ''}</span>
      {Icon && <Icon size={14} />}
      <span>{children}</span>
    </button>
  );
}

export const MenuHeading = ({ children }) => <div className="popover-heading">{children}</div>;
export const MenuDivider = () => <div className="popover-divider" />;
