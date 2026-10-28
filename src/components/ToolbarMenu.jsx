import React, { useCallback, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import PopoverMenu, { MenuItem } from './PopoverMenu.jsx';

/**
 * A toolbar drop-down (openspec app-settings): a button showing `label` and the current choice;
 * clicking opens the choices with the current one marked, picking one applies it and closes.
 * `options`: [{ label, value }].
 */
export default function ToolbarMenu({ label, icon: Icon, options, value, onChange, title }) {
  const buttonRef = useRef(null);
  const [at, setAt] = useState(null);
  const close = useCallback(() => setAt(null), []);
  const current = options.find((o) => o.value === value);
  const toggle = () => {
    if (at) {
      close();
      return;
    }
    const r = buttonRef.current.getBoundingClientRect();
    setAt({ x: r.left, y: r.bottom + 4 });
  };
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`btn toolbar-menu-button ${at ? 'active' : ''}`}
        onClick={toggle}
        title={title}
        aria-haspopup="menu"
        aria-expanded={Boolean(at)}
      >
        {Icon && <Icon size={14} />}
        <span className="toolbar-menu-label">{label}:</span>
        <span>{current?.label ?? '—'}</span>
        <ChevronDown size={12} />
      </button>
      {at && (
        <PopoverMenu at={at} onClose={close} label={label}>
          {options.map((o) => (
            <MenuItem
              key={String(o.value)}
              checked={o.value === value}
              onSelect={() => {
                onChange(o.value);
                close();
              }}
            >
              {o.label}
            </MenuItem>
          ))}
        </PopoverMenu>
      )}
    </>
  );
}
