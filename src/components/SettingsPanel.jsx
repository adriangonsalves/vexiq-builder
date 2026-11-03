import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import OfflineSection from './OfflineSection.jsx';

/** One labeled on/off switch row. */
function SwitchRow({ label, hint, checked, onChange }) {
  return (
    <label className="settings-row">
      <span className="settings-row-text">
        <span className="settings-row-label">{label}</span>
        {hint && <span className="settings-row-hint">{hint}</span>}
      </span>
      <input type="checkbox" role="switch" className="settings-switch" checked={Boolean(checked)} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/**
 * The Settings panel (openspec app-settings): Display (shadows, AO), History, Assistant (MCP) and
 * Advanced options. History's choice and the Assistant section only show with advanced options on,
 * and the Assistant section only where there is an assistant (`hasAssistant`; not the static site).
 * On the static site, `offline` (from useOffline) adds the Offline section (openspec offline-app);
 * `focusSection: 'offline'` scrolls to it when the panel opens.
 * Every change applies at once; closing (button, Esc, a click outside) changes nothing.
 */
export default function SettingsPanel({
  open,
  onClose,
  settings,
  onChange,
  hasAssistant = true,
  offline = null,
  focusSection = null,
  shadows,
  setShadows,
  ambientOcclusion,
  setAmbientOcclusion,
  environmentReflections = true,
  setEnvironmentReflections,
  reflectionIntensity = 0.75,
  setReflectionIntensity
}) {
  const ref = useRef(null);
  const offlineRef = useRef(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    if (open && focusSection === 'offline') offlineRef.current?.scrollIntoView({ block: 'start' });
  }, [open, focusSection]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    const onCloseEvent = () => onClose();
    // A click on the backdrop (outside the panel) closes it, also where closedby isn't supported
    const onClick = (event) => {
      if (event.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      const inside = r.top <= event.clientY && event.clientY <= r.bottom && r.left <= event.clientX && event.clientX <= r.right;
      if (!inside) dialog.close();
    };
    dialog.addEventListener('close', onCloseEvent);
    dialog.addEventListener('click', onClick);
    return () => {
      dialog.removeEventListener('close', onCloseEvent);
      dialog.removeEventListener('click', onClick);
    };
  }, [onClose]);

  return (
    <dialog ref={ref} closedby="any" className="settings-dialog" aria-labelledby="settingsTitle">
      <div className="settings-header">
        <strong id="settingsTitle">Settings</strong>
        <button type="button" className="icon-btn" onClick={() => ref.current?.close()} aria-label="Close settings" title="Close (Esc)">
          <X size={16} />
        </button>
      </div>
      <div className="settings-body">
        <section className="settings-section">
          <h3>Display</h3>
          <SwitchRow label="Shadows" hint="Soft shadows from the main light" checked={shadows} onChange={setShadows} />
          <SwitchRow
            label="Ambient occlusion"
            hint="Darkens creases and inside corners (uses more graphics power)"
            checked={ambientOcclusion}
            onChange={setAmbientOcclusion}
          />
          <SwitchRow
            label="Environment reflections"
            hint="Studio lighting and reflections on metal shafts and surfaces"
            checked={environmentReflections}
            onChange={setEnvironmentReflections}
          />
          <div className={`settings-slider-row ${!environmentReflections ? 'is-disabled' : ''}`}>
            <label className="settings-slider-label">
              <span className="settings-row-text">
                <span className="settings-row-label">Reflection brightness</span>
                <span className="settings-row-hint">Intensity of environment highlights ({Math.round((reflectionIntensity ?? 0.75) * 100)}%)</span>
              </span>
              <div className="settings-slider-wrap">
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.05"
                  value={reflectionIntensity ?? 0.75}
                  disabled={!environmentReflections}
                  onChange={(e) => setReflectionIntensity?.(Number(e.target.value))}
                />
                <span className="settings-slider-val">{Math.round((reflectionIntensity ?? 0.75) * 100)}%</span>
              </div>
            </label>
          </div>
        </section>

        <section className="settings-section">
          <h3>History</h3>
          {settings.advanced ? (
            <>
              <label className="settings-choice">
                <input type="radio" name="history-mode" checked={settings.history === 'linear'} onChange={() => onChange({ history: 'linear' })} />
                <span>
                  <span className="settings-row-label">Linear</span>
                  <span className="settings-row-hint">Undo and redo as usual; a change after undo drops the undone steps</span>
                </span>
              </label>
              <label className="settings-choice">
                <input type="radio" name="history-mode" checked={settings.history === 'branches'} onChange={() => onChange({ history: 'branches' })} />
                <span>
                  <span className="settings-row-label">Keep branches</span>
                  <span className="settings-row-hint">A change after undo starts a branch; the undone steps stay in the timeline</span>
                </span>
              </label>
            </>
          ) : (
            <p className="settings-note">Undo and redo as usual. A change after undo drops the undone steps.</p>
          )}
        </section>

        {settings.advanced && hasAssistant && (
          <section className="settings-section">
            <h3>Assistant (MCP)</h3>
            <SwitchRow
              label="Let the assistant change the build"
              hint="Off: the AI assistant can still look at the build, but can't change it"
              checked={settings.mcpEnabled}
              onChange={(v) => onChange({ mcpEnabled: v })}
            />
          </section>
        )}

        {offline?.supported && <OfflineSection offline={offline} sectionRef={offlineRef} />}

        <section className="settings-section">
          <h3>Advanced options</h3>
          <SwitchRow
            label="Show advanced options"
            hint="Smart assembly tools, part metadata, history branches and assistant settings"
            checked={settings.advanced}
            onChange={(v) => onChange({ advanced: v })}
          />
        </section>
      </div>
    </dialog>
  );
}
