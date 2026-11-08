#!/usr/bin/env node
// Bridges Claude Desktop (which launches MCP servers as local commands) to the WhtapBot /mcp endpoint.
// Reads JSON-RPC messages from stdin (one per line), POSTs each to the server, writes replies to stdout.
//
//   WHTAPBOT_MCP_URL    e.g. https://whtapbot.tail1f517c.ts.net/mcp  (your machine must be on the tailnet)
//   WHTAPBOT_MCP_TOKEN  the server's MCP_TOKEN
import readline from 'node:readline';

const URL_ = process.env.WHTAPBOT_MCP_URL;
const TOKEN = process.env.WHTAPBOT_MCP_TOKEN;
if (!URL_ || !TOKEN) {
  console.error('Set WHTAPBOT_MCP_URL and WHTAPBOT_MCP_TOKEN.');
  process.exit(1);
}

const out = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
let pending = 0, closed = false;
const maybeExit = () => { if (closed && pending === 0) process.exit(0); };

async function forward(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return out({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
  pending++;
  try {
    const res = await fetch(URL_, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: line,
      signal: AbortSignal.timeout(60_000),
    });
    if (res.status === 202) return;
    const text = await res.text();
    if (!res.ok && !text.trim().startsWith('{"jsonrpc"')) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    for (const r of [].concat(JSON.parse(text))) out(r);
  } catch (err) {
    const ids = [].concat(msg).filter((m) => m?.id !== undefined);
    for (const m of ids) out({ jsonrpc: '2.0', id: m.id, error: { code: -32603, message: `WhtapBot unreachable: ${err.message}` } });
  } finally {
    pending--; maybeExit();
  }
}

readline.createInterface({ input: process.stdin }).on('line', (l) => l.trim() && forward(l)).on('close', () => { closed = true; maybeExit(); });
