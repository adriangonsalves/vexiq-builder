import { useEffect, useState } from 'react';

const NONE = { alt: false, shift: false, mod: false };

/** True while the user is typing in a text field (keys there aren't shortcuts). */
const typing = () => {
  const el = document.activeElement;
  return Boolean(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable));
};

/**
 * Which modifier keys are held now ({ alt, shift, mod }; mod is Ctrl or Cmd), for lighting the context
 * bar's buttons while their key is held (openspec context-toolbar). Keys pressed while typing in a
 * field don't count, and leaving the window lets go of them all. Only for showing: the 3D view reads
 * the keys from its own events.
 */
export function useHeldKeys() {
  const [held, setHeld] = useState(NONE);
  useEffect(() => {
    const update = (e) => {
      const next = typing() ? NONE : { alt: e.altKey, shift: e.shiftKey, mod: e.ctrlKey || e.metaKey };
      setHeld((cur) => (cur.alt === next.alt && cur.shift === next.shift && cur.mod === next.mod ? cur : next));
    };
    const release = () => setHeld(NONE);
    window.addEventListener('keydown', update, true);
    window.addEventListener('keyup', update, true);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', update, true);
      window.removeEventListener('keyup', update, true);
      window.removeEventListener('blur', release);
    };
  }, []);
  return held;
}
