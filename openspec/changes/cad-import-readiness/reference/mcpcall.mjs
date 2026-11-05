// Minimal stdio client for the vexiq MCP server: node mcpcall.mjs <tool> <args.json> [out.json]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const ROOT = '/Users/adriangonsalves/projects/vexiq_builder';
const [,, tool, argsPath, outPath] = process.argv;
const args = JSON.parse(fs.readFileSync(argsPath, 'utf8'));
const srv = spawn('node', ['mcp/vexiq-mcp-server.mjs'], { cwd: ROOT, stdio: ['pipe', 'pipe', 'inherit'] });
let buf = '', pending = new Map(), nextId = 1;
srv.stdout.on('data', (d) => {
  buf += d; let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line); pending.get(msg.id)?.(msg); pending.delete(msg.id);
  }
});
const call = (method, params) => new Promise((res) => { const id = nextId++; pending.set(id, res); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'flop-builder', version: '1' } });
const r = await call('tools/call', { name: tool, arguments: args });
const text = r.result?.content?.[0]?.text ?? JSON.stringify(r);
if (outPath) fs.writeFileSync(outPath, text);
console.log(text.length > 4000 ? text.slice(0, 4000) + '\n...[truncated]' : text);
srv.kill();
