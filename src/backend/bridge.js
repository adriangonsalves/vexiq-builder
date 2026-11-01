/**
 * The app's backend in development (openspec static-lite-site): the Vite dev server's bridge
 * (vite.config.js), shared with the MCP server. The build is saved to public/assembly-state.json,
 * smart actions and explode plans run on the server, settings are shared through
 * public/app-settings.json, and an event stream brings changes from the assistant and other tabs.
 */
export const hasAssistant = true;

/** The saved state (with its history), or null when there is none or the server can't be reached. */
export async function loadState() {
  try {
    const res = await fetch('/api/assembly');
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/**
 * Saves the browser's state. Resolves to `{ conflict: true, state }` when another writer saved
 * first (the saved state comes back), otherwise to null. Never rejects (offline is ignored).
 */
export async function saveState(payload, { clientId }) {
  try {
    const res = await fetch('/api/assembly', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-mcp-source': 'browser', 'x-client-id': clientId },
      body: JSON.stringify(payload)
    });
    if (res.status !== 409) return null;
    const { state } = await res.json();
    return { conflict: true, state };
  } catch {
    return null;
  }
}

/** A smart action's reply; a change is recorded as one history step by the server. */
export async function runAction(action, state, params = {}) {
  const res = await fetch('/api/assembly/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, state, params })
  });
  const data = await res.json().catch(() => null);
  if (!data) throw new Error(`the server replied ${res.status}`);
  return data;
}

/** The explode plan for the parts and direction (progress comes through the event stream). */
export async function explodePlan(instances, mode) {
  const data = await runAction('explode_plan', { instances }, { mode });
  if (!data.ok || !data.plan) throw new Error(data.error || 'no plan came back');
  return data.plan;
}

/** The settings shared with the MCP server, or null. */
export async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export function saveSettings(settings, { clientId }) {
  fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Client-Id': clientId },
    body: JSON.stringify(settings)
  }).catch(() => {});
}

/**
 * Listens to the event stream: `onOpen`, `onError`, and `onMessage(msg)` with each parsed message
 * (state changes, settings, explode progress, screenshot requests). Returns a function that stops.
 */
export function subscribe({ onOpen, onError, onMessage }) {
  const es = new EventSource('/api/assembly/events');
  es.onopen = () => onOpen?.();
  es.onerror = () => onError?.();
  es.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return; // ignore malformed SSE
    }
    onMessage(msg);
  };
  return () => es.close();
}

/** Answers the MCP server's screenshot request. */
export function sendScreenshot(reply) {
  fetch('/api/assembly/screenshot-result', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reply)
  }).catch(() => {});
}
