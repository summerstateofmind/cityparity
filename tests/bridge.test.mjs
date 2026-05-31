// End-to-end test for cityparity-mcp stdio bridge.
//
// Spawns a tiny HTTP mock server, then runs the bridge as a child
// process with CITYPARITY_MCP_URL pointed at it. Writes JSON-RPC
// requests to the child's stdin, reads back from stdout, asserts.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN = join(__dirname, '..', 'bin', 'cityparity-mcp.mjs');

/**
 * Start an HTTP server that responds to POST /mcp with a configurable
 * handler. Returns { url, close, requests }.
 */
async function startMockServer(handler) {
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, body, headers: req.headers });
    handler(req, res, body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    close: () => new Promise((resolve) => server.close(resolve)),
    requests,
  };
}

/**
 * Run the bridge with a single input line and a max-wait. Returns the
 * stdout text and stderr text. Closes stdin after writing.
 */
function runBridge(line, env, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [BIN], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`bridge timeout after ${timeoutMs}ms\nstdout: ${stdout}\nstderr: ${stderr}`));
    }, timeoutMs);
    proc.on('close', () => {
      clearTimeout(timer);
      resolve({ stdout, stderr });
    });
    proc.on('error', reject);
    proc.stdin.write(line + '\n');
    // Give the bridge time to flush the request before we close stdin.
    setTimeout(() => proc.stdin.end(), 200);
  });
}

test('bridge forwards a JSON-RPC request and returns the response', async () => {
  const mock = await startMockServer((req, res, body) => {
    const req_ = JSON.parse(body);
    const response = { jsonrpc: '2.0', id: req_.id, result: { ok: true, echoed: req_.method } };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  });
  try {
    const { stdout } = await runBridge(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      { CITYPARITY_MCP_URL: mock.url },
    );
    const lines = stdout.trim().split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.id, 1);
    assert.equal(parsed.result.ok, true);
    assert.equal(parsed.result.echoed, 'tools/list');
    // The upstream got exactly the bytes we sent
    assert.equal(mock.requests.length, 1);
    assert.equal(JSON.parse(mock.requests[0].body).method, 'tools/list');
  } finally {
    await mock.close();
  }
});

test('bridge passes the MCP-Protocol-Version header upstream', async () => {
  const mock = await startMockServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }));
  });
  try {
    await runBridge(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      { CITYPARITY_MCP_URL: mock.url },
    );
    assert.equal(mock.requests[0].headers['mcp-protocol-version'], '2025-06-18');
  } finally {
    await mock.close();
  }
});

test('bridge handles SSE responses by writing one stdout line per data event', async () => {
  const mock = await startMockServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.write('data: ' + JSON.stringify({ jsonrpc: '2.0', id: 1, result: { step: 1 } }) + '\n\n');
    res.write('data: ' + JSON.stringify({ jsonrpc: '2.0', id: 1, result: { step: 2 } }) + '\n\n');
    res.end();
  });
  try {
    const { stdout } = await runBridge(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      { CITYPARITY_MCP_URL: mock.url },
    );
    const lines = stdout.trim().split('\n').filter(Boolean);
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]).result.step, 1);
    assert.equal(JSON.parse(lines[1]).result.step, 2);
  } finally {
    await mock.close();
  }
});

test('bridge surfaces network failures as JSON-RPC errors when request has an id', async () => {
  // Point at a closed port. Connection refused.
  const { stdout } = await runBridge(
    JSON.stringify({ jsonrpc: '2.0', id: 42, method: 'tools/list' }),
    { CITYPARITY_MCP_URL: 'http://127.0.0.1:1/mcp' },
  );
  const lines = stdout.trim().split('\n').filter(Boolean);
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.id, 42);
  assert.equal(parsed.error.code, -32000);
});

test('bridge writes nothing to stdout on 202 Accepted (notifications)', async () => {
  const mock = await startMockServer((req, res) => {
    res.writeHead(202);
    res.end();
  });
  try {
    // Notification: no id field.
    const { stdout } = await runBridge(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      { CITYPARITY_MCP_URL: mock.url },
    );
    assert.equal(stdout.trim(), '');
  } finally {
    await mock.close();
  }
});
