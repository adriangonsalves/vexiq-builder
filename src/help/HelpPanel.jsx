import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock, Home, Link as LinkIcon, Search, X } from 'lucide-react';
import { renderMarkdown } from './renderPage.js';
import { buildIndex, search } from './search.js';
import { HELP_GROUPS, SHOTS, relatedPages, sitePages } from './content.js';
import { START_PAGE } from './pageList.js';
import { helpIcon } from './icons.js';
import { locateControl } from './controls.js';
import { helpHash } from './useHelpRoute.js';
import './help.css';

/**
 * The Help guide (openspec in-app-help): home page, pages with closed More sections, pictures with
 * numbered markers, Mouse / Touch wording, search and Show me. Loaded with React.lazy the first time
 * Help opens, together with every page's text (src/help/content.js).
 *
 * The open page comes from the address (useHelpRoute in App.jsx): `route` = { page, section } and
 * `go(page, section)` moves to another place. Show me chips find their control with locateControl and
 * hand it to `onFlash`; a control that isn't on screen gets its one-line hint here instead.
 */

const BASE = import.meta.env?.BASE_URL ?? '/';
// The last page of this visit and where it was scrolled, for reopening the guide where it was
const memory = { page: undefined, scrollTop: 0, open: [] };

function useSiteContent(hasAssistant) {
  return useMemo(() => {
    const pages = sitePages({ hasAssistant });
    const byId = new Map(pages.map((p) => [p.id, p]));
    return { pages, byId, index: buildIndex(pages) };
  }, [hasAssistant]);
}

function InputSwitch({ input, onInput }) {
  return (
    <div className="help-switch" role="group" aria-label="Wording for">
      {[
        ['mouse', 'Mouse'],
        ['touch', 'Touch']
      ].map(([value, label]) => (
        <button key={value} type="button" className={input === value ? 'on' : ''} aria-pressed={input === value} onClick={() => onInput(value)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function SearchBox({ query, setQuery, inputRef }) {
  return (
    <label className="help-search">
      <Search size={16} aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        value={query}
        placeholder="Search help"
        aria-label="Search help"
        onChange={(e) => setQuery(e.target.value)}
      />
    </label>
  );
}

function Results({ results, query, onOpen, onHome }) {
  if (!results.length) {
    return (
      <div className="help-results-empty" role="status">
        <p>Nothing found for “{query.trim()}”.</p>
        <button type="button" className="help-link-btn" onClick={onHome}>
          Go to the help home page
        </button>
      </div>
    );
  }
  return (
    <ul className="help-results" aria-label="Search results">
      {results.map((r) => (
        <li key={`${r.page}#${r.section || ''}`}>
          <button type="button" className="help-result" onClick={() => onOpen(r.page, r.section)}>
            <span className="help-result-title">
              {r.title}
              {r.sectionTitle && <span className="help-result-section"> › {r.sectionTitle}</span>}
            </span>
            {r.snippet && <span className="help-result-snippet">{r.snippet}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** A picture as large as the window allows, with its markers; a tap anywhere, Esc or × closes it. */
function Enlarged({ shot, onClose }) {
  const closeRef = useRef(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  return (
    <div className="help-enlarged" role="dialog" aria-modal="true" aria-label={shot.alt || 'Picture'} onClick={onClose}>
      <div className="help-enlarged-frame" style={shot.w && shot.h ? { aspectRatio: `${shot.w} / ${shot.h}` } : undefined}>
        <img src={shot.src} alt={shot.alt} />
        {shot.marks.map((m) => (
          <span key={m.n} className="help-mark" style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%` }}>
            {m.n}
          </span>
        ))}
      </div>
      <button ref={closeRef} type="button" className="help-enlarged-close" aria-label="Close picture" onClick={onClose}>
        <X size={22} />
      </button>
    </div>
  );
}

function Card({ page, onOpen, big = false, startShot = null }) {
  const Icon = helpIcon(page.meta.icon);
  return (
    <button type="button" className={`help-card${big ? ' help-card-big' : ''}`} onClick={() => onOpen(page.id)}>
      {big && startShot && (
        <img
          className="help-card-img"
          src={`${BASE}help/shots/${startShot.name}.webp`}
          alt=""
          width={SHOTS[startShot.name]?.w}
          height={SHOTS[startShot.name]?.h}
          loading="lazy"
        />
      )}
      <span className="help-card-icon" aria-hidden="true">
        <Icon size={big ? 22 : 18} />
      </span>
      <span className="help-card-text">
        <strong>{page.meta.title}</strong>
        {big && (
          <span className="help-card-time">
            <Clock size={13} aria-hidden="true" /> about 5 minutes
          </span>
        )}
        <span className="help-card-summary">{page.meta.summary}</span>
      </span>
    </button>
  );
}

function HomePage({ pages, onOpen }) {
  const start = pages.find((p) => p.id === START_PAGE);
  const groups = HELP_GROUPS.map((g) => ({ ...g, pages: pages.filter((p) => p.meta.group === g.id && p.id !== START_PAGE) })).filter(
    (g) => g.pages.length
  );
  return (
    <div className="help-home">
      {start && (
        <section aria-label="Start here">
          <Card page={start} big startShot={start.shots[0]} onOpen={onOpen} />
        </section>
      )}
      {groups.map((g) => (
        <section key={g.id} className="help-group" aria-labelledby={`help-group-${g.id}`}>
          <h2 id={`help-group-${g.id}`}>{g.title}</h2>
          <div className="help-cards">
            {g.pages.map((p) => (
              <Card key={p.id} page={p} onOpen={onOpen} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Html({ html, className }) {
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

function PageView({ page, pages, input, openSections, onToggleSection, neighbours, onOpen, titleRef }) {
  const opts = { input, shots: SHOTS, base: BASE };
  // `pages` is already the site's list, so a developer page is not in it where the assistant is missing
  const related = relatedPages(pages, page, 3, { hasAssistant: true });
  return (
    <article className="help-page" aria-labelledby="help-page-title">
      <h1 id="help-page-title" ref={titleRef} tabIndex={-1}>
        {page.meta.title}
      </h1>
      <Html className="help-top" html={renderMarkdown(page.top, opts)} />
      {page.sections.length > 0 && (
        <div className="help-mores">
          {page.sections.map((s) => (
            <details
              key={s.id}
              id={`help-sec-${s.id}`}
              className="help-more"
              data-section={s.id}
              open={openSections.has(s.id)}
              onToggle={(e) => onToggleSection(s.id, e.currentTarget.open)}
            >
              <summary>
                <h2>{s.title}</h2>
              </summary>
              <Html className="help-more-body" html={renderMarkdown(s.body, opts)} />
            </details>
          ))}
        </div>
      )}
      {(neighbours.prev || neighbours.next) && (
        <nav className="help-prevnext" aria-label="More pages in this group">
          {neighbours.prev ? (
            <button type="button" className="help-prev" onClick={() => onOpen(neighbours.prev.id)}>
              <ChevronLeft size={16} aria-hidden="true" />
              <span>
                <small>Previous</small>
                {neighbours.prev.meta.title}
              </span>
            </button>
          ) : (
            <span />
          )}
          {neighbours.next && (
            <button type="button" className="help-next" onClick={() => onOpen(neighbours.next.id)}>
              <span>
                <small>Next</small>
                {neighbours.next.meta.title}
              </span>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          )}
        </nav>
      )}
      {related.length > 0 && (
        <nav className="help-related" aria-labelledby="help-related-title">
          <h2 id="help-related-title">Related pages</h2>
          <ul>
            {related.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => onOpen(r.id)}>
                  {r.meta.title}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </article>
  );
}

export default function HelpPanel({ route, go, onClose, input, onInput, hasAssistant, onFlash, why = null }) {
  const { pages, byId, index } = useSiteContent(hasAssistant);
  const page = route.page ? byId.get(route.page) : null;
  const [query, setQuery] = useState('');
  const [openSections, setOpenSections] = useState(() => new Set());
  const [enlarged, setEnlarged] = useState(null);
  const [hint, setHint] = useState(null);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef(null);
  const bodyRef = useRef(null);
  const titleRef = useRef(null);
  const searchRef = useRef(null);
  const shownRef = useRef(undefined); // the page id shown last, to tell a new page from a re-render

  // A link to a page this site doesn't have (or a section it doesn't have) shows the home page
  useEffect(() => {
    if (route.page && !page) go(null, null, { replace: true });
    else if (page && route.section && !page.sections.some((s) => s.id === route.section)) go(page.id, null, { replace: true });
  }, [route.page, route.section, page, go]);

  const results = useMemo(() => (query.trim() ? search(index, query) : []), [index, query]);

  // A new page opens with its More sections closed, except the one a link points at, which is
  // opened and scrolled to the top; reopening the guide on the same page puts it back where it was
  useLayoutEffect(() => {
    const id = page?.id ?? null;
    const body = bodyRef.current;
    const isNew = shownRef.current !== id;
    const first = shownRef.current === undefined;
    shownRef.current = id;
    if (route.section) {
      setOpenSections((s) => (s.has(route.section) && !isNew ? s : new Set(isNew ? [route.section] : [...s, route.section])));
      requestAnimationFrame(() => {
        const el = rootRef.current?.querySelector(`#help-sec-${CSS.escape(route.section)}`);
        if (el && body) body.scrollTop += el.getBoundingClientRect().top - body.getBoundingClientRect().top;
      });
      return;
    }
    if (!isNew) return;
    const back = first && memory.page === id;
    setOpenSections(new Set(back ? memory.open : []));
    if (!body) return;
    if (back) requestAnimationFrame(() => (body.scrollTop = memory.scrollTop));
    else body.scrollTop = 0;
    if (!first) titleRef.current?.focus({ preventScroll: true });
  }, [page?.id, route.section]);

  useEffect(() => {
    memory.page = page?.id ?? null;
    memory.open = [...openSections];
  }, [page?.id, openSections]);

  // Keyboard focus moves into the guide when it opens
  useEffect(() => {
    if (!rootRef.current?.contains(document.activeElement)) rootRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!hint) return undefined;
    const t = setTimeout(() => setHint(null), 6000);
    return () => clearTimeout(t);
  }, [hint]);

  const openPlace = useCallback(
    (id, section = null) => {
      setQuery('');
      setHint(null);
      go(id, section);
    },
    [go]
  );

  const neighbours = useMemo(() => {
    if (!page) return {};
    const same = pages.filter((p) => p.meta.group === page.meta.group);
    const i = same.findIndex((p) => p.id === page.id);
    return { prev: same[i - 1] || null, next: same[i + 1] || null };
  }, [page, pages]);

  const toggleSection = useCallback((id, open) => {
    setOpenSections((s) => {
      if (s.has(id) === open) return s;
      const next = new Set(s);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  // Pictures can be selected and reached by keyboard
  useEffect(() => {
    rootRef.current?.querySelectorAll('figure.help-shot').forEach((fig) => {
      fig.setAttribute('tabindex', '0');
      fig.setAttribute('role', 'button');
      const alt = fig.querySelector('img')?.getAttribute('alt') || 'picture';
      fig.setAttribute('aria-label', `Show larger: ${alt}`);
    });
  });

  const enlarge = (fig) => {
    const img = fig.querySelector('img');
    const name = fig.dataset.shot;
    const entry = SHOTS[name] || {};
    setEnlarged({ src: img?.getAttribute('src'), alt: img?.getAttribute('alt') || '', w: entry.w, h: entry.h, marks: entry.marks || [], from: fig });
  };
  const closeEnlarged = () => {
    const from = enlarged?.from;
    setEnlarged(null);
    requestAnimationFrame(() => from?.focus?.());
  };

  const showMe = (name) => {
    const found = locateControl(name);
    if (found.element) {
      setHint(null);
      onFlash(found.element);
    } else {
      setHint(found.hint);
    }
  };

  // Chips, links inside the guide and pictures, in the rendered page text
  const onBodyClick = (e) => {
    const chip = e.target.closest('.help-chip');
    if (chip) {
      e.preventDefault();
      showMe(chip.dataset.control);
      return;
    }
    const link = e.target.closest('a[data-help-page]');
    if (link) {
      e.preventDefault();
      openPlace(link.dataset.helpPage, link.dataset.helpSection || null);
      return;
    }
    const fig = e.target.closest('figure.help-shot');
    if (fig) enlarge(fig);
  };
  const onBodyKeyDown = (e) => {
    const fig = e.target.closest?.('figure.help-shot');
    if (fig && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      enlarge(fig);
    }
  };

  // Keys pressed in the guide belong to the guide: Esc closes it (after a picture shown large, and
  // a search being typed), ? closes it, and none of them reach the app's own shortcuts
  const onKeyDown = (e) => {
    e.stopPropagation();
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
    if (e.key === 'Escape') {
      e.preventDefault();
      if (enlarged) closeEnlarged();
      else if (typing && query) setQuery('');
      else onClose();
    } else if (e.key === '?' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      onClose();
    }
  };

  const copyLink = async () => {
    const url = `${window.location.origin}${window.location.pathname}${window.location.search}${helpHash(page?.id ?? null, null)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this link:', url);
    }
  };

  const closeButton = (
    <button type="button" className="help-icon-btn" aria-label="Close help" title="Close help (Esc)" onClick={onClose}>
      <X size={20} />
    </button>
  );

  return (
    <div className="help-root" ref={rootRef} tabIndex={-1} aria-label="Help" onKeyDown={onKeyDown}>
      <header className="help-head">
        {page ? (
          <>
            <button type="button" className="help-icon-btn" aria-label="Help home" title="Help home" onClick={() => openPlace(null)}>
              <Home size={20} />
            </button>
            <span className="help-head-title" aria-hidden="true">
              {page.meta.title}
            </span>
            <button type="button" className="help-icon-btn" aria-label="Copy link" title="Copy a link to this page" onClick={copyLink}>
              <LinkIcon size={18} />
            </button>
          </>
        ) : (
          <span className="help-head-title help-head-home">Help</span>
        )}
        {closeButton}
      </header>
      <div className="help-tools">
        <SearchBox query={query} setQuery={setQuery} inputRef={searchRef} />
        <InputSwitch input={input} onInput={onInput} />
      </div>
      {copied && (
        <div className="help-toast" role="status">
          Link copied
        </div>
      )}
      <div
        className="help-body"
        ref={bodyRef}
        onClick={onBodyClick}
        onKeyDown={onBodyKeyDown}
        onScroll={(e) => {
          memory.scrollTop = e.currentTarget.scrollTop;
        }}
      >
        {!query.trim() && page && why?.reason && why.page === page.id && (why.section || null) === (route.section || null) && (
          <p className="help-because" role="status">
            <span>Because you're {why.reason}.</span>{' '}
            <button type="button" className="help-because-home" onClick={() => openPlace(null)}>
              Help home
            </button>
          </p>
        )}
        {query.trim() ? (
          <Results results={results} query={query} onOpen={openPlace} onHome={() => openPlace(null)} />
        ) : page ? (
          <PageView
            page={page}
            pages={pages}
            input={input}
            openSections={openSections}
            onToggleSection={toggleSection}
            neighbours={neighbours}
            onOpen={openPlace}
            titleRef={titleRef}
          />
        ) : (
          <>
            <h1 className="help-visually-hidden">Help</h1>
            <HomePage pages={pages} onOpen={openPlace} />
          </>
        )}
      </div>
      {hint && (
        <div className="help-hint" role="status">
          <span>{hint}</span>
          <button type="button" className="help-icon-btn" aria-label="Close message" onClick={() => setHint(null)}>
            <X size={16} />
          </button>
        </div>
      )}
      {enlarged && <Enlarged shot={enlarged} onClose={closeEnlarged} />}
    </div>
  );
}
