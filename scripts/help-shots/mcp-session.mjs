/**
 * A private vexiq MCP server for making the help pictures' example builds (openspec in-app-help,
 * task 4.2): its own assembly and settings files in a temporary folder, and an app port nothing
 * listens on, so the user's own build (public/assembly-state.json, the dev app on 5173) is never touched.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const NO_APP_PORT = 9; // the discard port: nothing answers, so nothing is sent to a running app

export async function startMcp() {
  const dir = fs.mkdtempSync(path.join(process.env.VEXIQ_TMP || os.tmpdir(), 'vexiq-help-builds-'));
  const statePath = path.join(dir, 'assembly-state.json');
  const settingsPath = path.join(dir, 'app-settings.json');
  const server = spawn(process.execPath, [path.join(ROOT, 'mcp', 'vexiq-mcp-server.mjs')], {
    cwd: ROOT,
    env: { ...process.env, VEXIQ_STATE_PATH: statePath, VEXIQ_SETTINGS_PATH: settingsPath, VEXIQ_APP_PORT: String(NO_APP_PORT) },
    stdio: ['pipe', 'pipe', 'inherit']
  });
  let nextId = 1;
  const pending = new Map();
  let buf = '';
  server.stdout.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      pending.get(msg.id)?.(msg);
      pending.delete(msg.id);
    }
  });
  const rpc = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => reject(new Error(`timeout: ${method}`)), 120000);
      pending.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
      server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'help-builds', version: '1' } });
  server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

  /** Calls a tool and returns its parsed reply (throws on a tool error unless `allowError`). */
  const call = async (name, args = {}, { allowError = false } = {}) => {
    const msg = await rpc('tools/call', { name, arguments: args });
    if (msg.error) throw new Error(`${name}: ${JSON.stringify(msg.error)}`);
    const text = msg.result?.content?.find((c) => c.type === 'text')?.text;
    let data = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // plain text reply
    }
    if (msg.result?.isError && !allowError) throw new Error(`${name}: ${text}`);
    return data;
  };
  const state = () => JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const stop = () => {
    server.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { call, state, stop, statePath };
}
