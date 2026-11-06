import { useEffect, useState } from 'react';

// Window widths where the layout changes (openspec responsive-layout)
export const SMALL_MAX_PX = 699;
export const MEDIUM_MAX_PX = 1179;

const smallQuery = `(max-width: ${SMALL_MAX_PX}px)`;
const mediumQuery = `(max-width: ${MEDIUM_MAX_PX}px)`;

function currentSize() {
  if (typeof window === 'undefined' || !window.matchMedia) return 'large';
  if (window.matchMedia(smallQuery).matches) return 'small';
  if (window.matchMedia(mediumQuery).matches) return 'medium';
  return 'large';
}

/** 'small' (phone), 'medium' (tablet) or 'large' (desktop), updated live as the window changes. */
export function useLayoutSize() {
  const [size, setSize] = useState(currentSize);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const update = () => setSize(currentSize());
    const queries = [window.matchMedia(smallQuery), window.matchMedia(mediumQuery)];
    queries.forEach((q) => q.addEventListener('change', update));
    return () => queries.forEach((q) => q.removeEventListener('change', update));
  }, []);
  return size;
}
