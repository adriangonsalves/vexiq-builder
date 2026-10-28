/**
 * App settings (openspec app-settings): kept in one file (public/app-settings.json, served by the
 * Vite bridge at /api/settings) so the app, its bridge and the MCP server share them. Not part of
 * the build. Shadows and AO are viewport settings and live with the build's viewport instead.
 * Pure, so the browser, the bridge and the MCP server use the same rules.
 */

export const HISTORY_MODES = ['linear', 'branches'];

export const DEFAULT_SETTINGS = Object.freeze({
  advanced: false, // show the advanced tools and settings
  history: 'linear', // 'linear': a change after undo drops the undone steps; 'branches': keeps them
  mcpEnabled: true // the assistant (MCP) may change the build
});

/** `raw` with unknown keys dropped and bad values replaced by the defaults. */
export function normalizeSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    advanced: typeof s.advanced === 'boolean' ? s.advanced : DEFAULT_SETTINGS.advanced,
    history: HISTORY_MODES.includes(s.history) ? s.history : DEFAULT_SETTINGS.history,
    mcpEnabled: typeof s.mcpEnabled === 'boolean' ? s.mcpEnabled : DEFAULT_SETTINGS.mcpEnabled
  };
}

/** True when a change after undo should drop the undone steps. */
export const isLinearHistory = (settings) => normalizeSettings(settings).history !== 'branches';

export const MCP_OFF_MESSAGE =
  "The assistant is turned off in the app's Settings (Assistant). Turn it on there to make changes.";
