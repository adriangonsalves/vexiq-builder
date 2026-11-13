import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Links to help pages (openspec in-app-help, design.md section 7). The address follows the guide:
 * `#help` is home, `#help/<page>` a page, `#help/<page>/<section>` a section. Going to a page inside
 * the guide adds a browser history entry, so Back steps back through the pages; Back from the first
 * one (or closing the guide) returns to the address before the guide opened. Nothing else in the app
 * reads the hash. Kept out of the help chunk: it is small and must run when the app opens.
 */

/** `{ page, section }` for a help address (page null = home), or null for any other hash. */
export function parseHelpHash(hash) {
  const m = /^#help(?:\/([^/]*))?(?:\/([^/]*))?\/?$/.exec(hash || '');
  if (!m) return null;
  const dec = (s) => {
    try {
      return s ? decodeURIComponent(s) : null;
    } catch {
      return null;
    }
  };
  return { page: dec(m[1]), section: dec(m[2]) };
}

/** The address for a place in the guide. */
export function helpHash(page, section) {
  if (!page) return '#help';
  return `#help/${encodeURIComponent(page)}${section ? `/${encodeURIComponent(section)}` : ''}`;
}

const urlWithout = () => `${window.location.pathname}${window.location.search}`;

/**
 * `{ open, page, section, openedByLink, openHelp(page?, section?), go(page, section), close() }`.
 * openHelp() with no page reopens the last page of this visit (home the first time).
 */
export function useHelpRoute() {
  const initial = typeof window === 'undefined' ? null : parseHelpHash(window.location.hash);
  const [state, setState] = useState(() => ({ open: Boolean(initial), page: initial?.page ?? null, section: initial?.section ?? null }));
  const openedByLink = useRef(Boolean(initial));
  const stripOnArrival = useRef(false); // closing went back to the link's own entry: take the hash off it
  const last = useRef({ page: initial?.page ?? null });

  useEffect(() => {
    const onHash = () => {
      const place = parseHelpHash(window.location.hash);
      if (stripOnArrival.current) {
        stripOnArrival.current = false;
        if (place) window.history.replaceState(null, '', urlWithout());
        setState((s) => ({ ...s, open: false }));
        return;
      }
      if (place) {
        last.current = { page: place.page };
        setState({ open: true, page: place.page, section: place.section });
      } else {
        setState((s) => (s.open ? { ...s, open: false } : s));
      }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const depth = () => window.history.state?.helpDepth ?? 0;

  const go = useCallback((page, section = null, { replace = false } = {}) => {
    const hash = helpHash(page, section);
    last.current = { page };
    if (hash !== window.location.hash) {
      if (replace) window.history.replaceState({ helpDepth: depth() }, '', hash);
      else window.history.pushState({ helpDepth: depth() + 1 }, '', hash);
    }
    setState({ open: true, page, section });
  }, []);

  const openHelp = useCallback(
    (page, section = null) => {
      const target = page === undefined ? last.current.page : page;
      go(target, target === undefined ? null : section);
    },
    [go]
  );

  const close = useCallback(() => {
    const steps = depth();
    if (!parseHelpHash(window.location.hash)) {
      setState((s) => ({ ...s, open: false }));
      return;
    }
    if (steps > 0) {
      // Back to the entry before the guide's first one; a link's own entry still has its hash
      if (openedByLink.current) stripOnArrival.current = true;
      setState((s) => ({ ...s, open: false }));
      window.history.go(-steps);
    } else {
      window.history.replaceState(null, '', urlWithout());
      setState((s) => ({ ...s, open: false }));
    }
  }, []);

  return { ...state, openedByLink: openedByLink.current, openHelp, go, close };
}
