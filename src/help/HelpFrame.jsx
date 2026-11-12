import React, { Component, Suspense, lazy, useEffect, useRef, useState } from 'react';
import { CircleHelp, X } from 'lucide-react';

/**
 * Where the Help guide sits (openspec in-app-help): the frame is in the app's first load, the guide
 * itself (HelpPanel, marked, every page) loads the first time it opens. While it loads the frame says
 * "Loading help…"; if it can't load (no connection and not downloaded for offline use) it says so
 * with Try again, and the app keeps working.
 *
 * Normally the frame is a column beside the 3D view (or the whole screen on a phone). Opened from a
 * question mark in a dialog that blocks the rest of the page (Bend sheet, Load…, Settings), it is a
 * modal dialog on top of that one instead, so it can be used; closing it leaves that dialog as it was.
 */

function Message({ children, onClose }) {
  return (
    <div className="help-frame-message">
      <div className="help-frame-head">
        <span>Help</span>
        <button type="button" className="help-frame-close" aria-label="Close help" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      <div className="help-frame-body">{children}</div>
    </div>
  );
}

class HelpBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(err) {
    this.props.onFail?.();
    console.warn('Help could not be loaded:', err);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Message onClose={this.props.onClose}>
        <p role="alert">Help couldn’t be loaded. Check the connection, then try again.</p>
        <button type="button" className="btn btn-outline help-frame-retry" onClick={this.props.onRetry}>
          Try again
        </button>
      </Message>
    );
  }
}

function ModalShell({ onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="help-panel help-modal"
      aria-label="Help"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      {children}
    </dialog>
  );
}

// One lazy component for the visit, so reopening the guide doesn't wait again; a new one after a
// failed load, since React keeps a failed one failed
const loadPanel = () => lazy(() => import('./HelpPanel.jsx'));
let Panel = loadPanel();
let panelFailed = false;

export default function HelpFrame({ modal = false, onClose, ...panelProps }) {
  const [attempt, setAttempt] = useState(0);
  const retry = () => {
    if (panelFailed) Panel = loadPanel();
    panelFailed = false;
    setAttempt((a) => a + 1);
  };
  const body = (
    <HelpBoundary key={attempt} onClose={onClose} onRetry={retry} onFail={() => (panelFailed = true)}>
      <Suspense
        fallback={
          <Message onClose={onClose}>
            <p role="status">
              <CircleHelp size={16} aria-hidden="true" /> Loading help…
            </p>
          </Message>
        }
      >
        <Panel onClose={onClose} {...panelProps} />
      </Suspense>
    </HelpBoundary>
  );
  if (modal) return <ModalShell onClose={onClose}>{body}</ModalShell>;
  return (
    <aside className="help-panel" aria-label="Help">
      {body}
    </aside>
  );
}
