// Smoke check for the patient MCP server. Run with `npm run smoke`.
//
// Speaks real JSON-RPC to patient-server.js over a real stdio pipe, so it
// exercises the transport rather than mocking it — no Claude Desktop needed.
//
// The assertion that matters is stdout PURITY: every line the server writes to
// stdout must parse as JSON, because on this transport stdout IS the protocol.
// Verified load-bearing by removing stdioGuard.js's import, which makes this
// exit 1 with a dotenv banner as the offender.
//
// This file is the only automated check the mcp/ package has — there is no
// test runner here, the same gap docs/agent-plan.md records for frontend/.

import { spawn } from 'node:child_process';

const child = spawn(process.execPath, ['patient-server.js'], {
  cwd: import.meta.dirname,
  stdio: ['pipe', 'pipe', 'pipe'],
});

const stdoutLines = [];
const stderrChunks = [];
let buffer = '';

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';
  for (const line of lines) if (line.trim()) stdoutLines.push(line);
});
child.stderr.on('data', (chunk) => stderrChunks.push(chunk.toString()));

const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);

const waitFor = (id, timeoutMs = 8000) =>
  new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = setInterval(() => {
      for (const line of stdoutLines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.id === id) {
            clearInterval(poll);
            return resolve(parsed);
          }
        } catch {
          /* purity is asserted separately, below */
        }
      }
      if (Date.now() - started > timeoutMs) {
        clearInterval(poll);
        reject(new Error(`timed out waiting for id ${id}`));
      }
    }, 50);
  });

const results = {};

try {
  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'probe', version: '0.0.0' },
    },
  });

  const initialize = await waitFor(1);
  results.initialize = {
    ok: Boolean(initialize.result),
    serverInfo: initialize.result?.serverInfo,
    protocolVersion: initialize.result?.protocolVersion,
    error: initialize.error ?? null,
  };

  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });

  const list = await waitFor(2);
  results.toolsList = {
    ok: Boolean(list.result),
    toolCount: list.result?.tools?.length ?? null,
    tools: list.result?.tools?.map((t) => t.name) ?? null,
    error: list.error ?? null,
  };
} catch (error) {
  results.failure = error.message;
} finally {
  child.kill('SIGTERM');
}

// The assertion that matters most.
const unparseable = stdoutLines.filter((line) => {
  try {
    JSON.parse(line);
    return false;
  } catch {
    return true;
  }
});

results.stdoutPurity = {
  totalLines: stdoutLines.length,
  unparseableLines: unparseable.length,
  offenders: unparseable.slice(0, 3),
  verdict: unparseable.length === 0 ? 'CLEAN' : 'CORRUPTED',
};

results.stderrSaw = stderrChunks.join('').trim().split('\n').slice(0, 4);

console.log(JSON.stringify(results, null, 1));
process.exit(results.stdoutPurity.verdict === 'CLEAN' && !results.failure ? 0 : 1);
