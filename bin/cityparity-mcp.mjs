#!/usr/bin/env node
// cityparity-mcp: stdio to Streamable HTTP MCP bridge.
//
// Reads line-delimited JSON-RPC messages from stdin, forwards each as a
// POST to the configured MCP HTTP endpoint, and pipes the response back
// to stdout. For MCP clients that only support stdio transport (older
// Claude Desktop, some Cursor configs); modern clients can hit the HTTP
// endpoint directly.
//
// Env vars:
//   CITYPARITY_MCP_URL     override the upstream MCP endpoint
//                          (default: https://mcp.cityparity.com/mcp)
//   CITYPARITY_MCP_DEBUG   if set, log request/response framing to stderr

import { createInterface } from 'node:readline';

const SERVER_URL = process.env.CITYPARITY_MCP_URL || 'https://mcp.cityparity.com/mcp';
const DEBUG = !!process.env.CITYPARITY_MCP_DEBUG;
const PROTOCOL_VERSION = '2025-06-18';

function debugLog(msg) {
  if (DEBUG) process.stderr.write(`[cityparity-mcp] ${msg}\n`);
}

function writeStdout(jsonString) {
  // Each MCP stdio message is a single JSON value followed by a newline.
  process.stdout.write(jsonString + '\n');
}

function emitError(originalLine, err) {
  // Try to surface the error to the client as a JSON-RPC error if we can
  // identify the request id; otherwise log to stderr.
  try {
    const req = JSON.parse(originalLine);
    if (req && req.id !== undefined && req.id !== null) {
      writeStdout(JSON.stringify({
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32000, message: `cityparity-mcp bridge error: ${err.message ?? String(err)}` },
      }));
      return;
    }
  } catch { /* not parseable, fall through */ }
  process.stderr.write(`cityparity-mcp bridge error: ${err.message ?? String(err)}\n`);
}

async function forward(line) {
  let res;
  try {
    res = await fetch(SERVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'MCP-Protocol-Version': PROTOCOL_VERSION,
        'User-Agent': 'cityparity-mcp/0.1.0',
      },
      body: line,
    });
  } catch (e) {
    emitError(line, e);
    return;
  }

  debugLog(`<- ${res.status} ${res.headers.get('Content-Type') ?? ''}`);

  // 202 Accepted = notification or response-only message; nothing to relay.
  if (res.status === 202) return;

  const contentType = (res.headers.get('Content-Type') || '').toLowerCase();

  // SSE response: each `data:` line is one JSON-RPC message. Stream them
  // to stdout as they arrive so the client can react incrementally.
  if (contentType.includes('text/event-stream')) {
    if (!res.body) {
      emitError(line, new Error('Empty SSE body'));
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        // Normalize CRLF → LF so the split below behaves identically
        // across servers (the SSE spec allows CR, LF, or CRLF).
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const parts = buffer.split('\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          // SSE spec: `data:value` and `data: value` (with optional
          // single space) are equivalent. Match both.
          if (part.startsWith('data:')) {
            const payload = part.slice(5).replace(/^ /, '').trim();
            if (payload) writeStdout(payload);
          }
        }
      }
    } catch (e) {
      emitError(line, e);
    }
    return;
  }

  // JSON response: forward as-is.
  if (contentType.includes('application/json') || contentType.includes('+json')) {
    try {
      const text = await res.text();
      if (text.trim()) writeStdout(text.trim());
    } catch (e) {
      emitError(line, e);
    }
    return;
  }

  // Anything else (HTML error page from Cloudflare, plain text 502,
  // unexpected content-type): don't forward the body verbatim. That
  // would write non-JSON garbage to stdout and break the MCP client's
  // parser. Synthesize a JSON-RPC error keyed to the request id so the
  // client surfaces something sensible.
  emitError(line, new Error(`upstream returned ${res.status} with Content-Type "${contentType}"; body suppressed`));
}

// Safety net so a stray bug doesn't terminate the bridge process (Node
// defaults unhandledRejection to crash). The per-line .catch at the
// call site handles the common path; these catch anything that escapes
// from setTimeout or setImmediate.
process.on('unhandledRejection', (err) => {
  process.stderr.write(`cityparity-mcp unhandled rejection: ${err?.message ?? String(err)}\n`);
});
process.on('uncaughtException', (err) => {
  process.stderr.write(`cityparity-mcp uncaught exception: ${err?.message ?? String(err)}\n`);
});

const rl = createInterface({ input: process.stdin, terminal: false });

// Track in-flight forwards so we don't exit while a request is still
// waiting on the upstream. Without this, MCP clients that send a request
// then close stdin would lose the response because the bridge process
// would exit before stdout is flushed.
const inflight = new Set();

rl.on('line', (line) => {
  if (!line.trim()) return;
  debugLog(`-> ${line.slice(0, 200)}${line.length > 200 ? '…' : ''}`);
  // Fire-and-forget per request. JSON-RPC permits interleaved responses;
  // ids preserve correlation. The .catch keeps an inner bug from
  // terminating the bridge for subsequent requests.
  const p = forward(line).catch((e) => emitError(line, e));
  inflight.add(p);
  p.finally(() => inflight.delete(p));
});

async function gracefulExit() {
  if (inflight.size > 0) await Promise.allSettled([...inflight]);
  process.exit(0);
}

process.stdin.on('close', gracefulExit);
process.stdin.on('end', gracefulExit);
