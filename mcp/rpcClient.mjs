import { spawn } from 'node:child_process';

// The JSON-RPC-over-stdio plumbing both smoke checks use.
//
// Lifted out of smoke.mjs in 5.6, when the doctor server needed the same
// client. What rule 6 keeps separate is processes, auth and registries — not
// test utilities. Two copies of a protocol client would drift, and a bug in
// the copy would look like a bug in the server it was checking.
//
// Everything role-specific — which script to spawn, which env var carries the
// token, what to assert — stays in the caller.

// Spawns a server with a SCRUBBED environment and speaks real JSON-RPC to it
// over a real pipe.
//
// The scrubbing is the load-bearing part: passing `{...process.env}` would
// hand the child the values this process already loaded from backend/.env, and
// the check would pass even with env.js removed — which is exactly what
// happened the first time the patient smoke was written.
export const startServer = ({ script, env = {}, cwd, scrub = [] }) => {
  const childEnv = { ...process.env, ...env };
  for (const key of scrub) delete childEnv[key];

  const child = spawn(process.execPath, [script], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: childEnv,
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

  let nextId = 1;

  const rpc = (method, params = {}) => {
    const id = nextId++;
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`,
    );

    return new Promise((resolve, reject) => {
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
            /* purity is asserted separately */
          }
        }
        if (Date.now() - started > 20000) {
          clearInterval(poll);
          reject(new Error(`timed out waiting for ${method}`));
        }
      }, 50);
    });
  };

  const callTool = async (name, args = {}) => {
    const response = await rpc('tools/call', { name, arguments: args });
    const text = response.result?.content?.[0]?.text;

    // Our own results are JSON, but a schema rejection comes back as the SDK's
    // plain-text "Input validation error: …" — so parsing is best-effort. The
    // first version of this helper assumed JSON and crashed on exactly the
    // case it was written to check.
    let parsed = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }

    return {
      isError: response.result?.isError ?? false,
      parsed,
      text: text ?? null,
      protocolError: response.error ?? null,
    };
  };

  const initialize = async (clientName) => {
    await rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: clientName, version: '0.0.0' },
    });
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
    );
  };

  const stop = async () => {
    child.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 250));
  };

  // stdout IS the protocol on this transport, so a single stray print corrupts
  // the connection. Load-bearing: removing stdioGuard.js's import makes this
  // report CORRUPTED with a dotenv banner as the offender.
  const stdoutPurity = () => {
    const unparseable = stdoutLines.filter((line) => {
      try {
        JSON.parse(line);
        return false;
      } catch {
        return true;
      }
    });

    return {
      totalLines: stdoutLines.length,
      unparseableLines: unparseable.length,
      offenders: unparseable.slice(0, 2),
      verdict: unparseable.length === 0 ? 'CLEAN' : 'CORRUPTED',
    };
  };

  return {
    child,
    rpc,
    callTool,
    initialize,
    stop,
    stdoutPurity,
    stderr: () => stderrChunks.join(''),
  };
};

// Everything backend/.env supplies, so a server must find and load that file
// itself.
export const BACKEND_ENV_KEYS = [
  'JWT_SECRET',
  'DB_HOST',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
];
