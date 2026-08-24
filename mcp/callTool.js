import { randomUUID } from 'node:crypto';

import { runTool } from '../backend/src/assistant/runTool.js';
import { TokenError } from '../backend/src/auth/verifyPatientToken.js';
import { createContext } from './context.js';
import { ensureDatabase } from './database.js';

// The audited bridge between MCP and the Phase 1 tools. This is the whole
// security surface of 4.3.
//
// Two things make it correct, and both are worth stating plainly because both
// are one careless edit away from being wrong:
//
//   1. It calls runTool, NEVER tool.handler. runTool is what writes the audit
//      row rule 8 requires, and routing every execution through it is what
//      makes that row unavoidable — the same reason agentLoop does it.
//
//   2. `args` come from the model and are passed in the `args` position only.
//      `ctx` comes from the verified token, freshly, on every call. There is
//      no code path from one to the other, which is rule 3.

// One session per CONNECTION, minted when this module loads.
//
// 2.7 mints one per HTTP request so a turn's audit rows group together; over
// stdio the closest analogue is the connection, since the protocol exposes no
// conversation boundary. Honest limitation: a host left open for days groups
// every call into one id.
export const sessionId = randomUUID();

const textResult = (payload, isError = false) => ({
  content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  ...(isError ? { isError: true } : {}),
});

export const callTool = async (name, args = {}) => {
  // Rebuilt per call, deliberately. The token file is re-read each time (4.2),
  // so pointing it at a different patient takes effect immediately — and a
  // long-lived server can never serve one patient's data under another's
  // identity because it cached a ctx at startup.
  let ctx;

  try {
    ctx = createContext();
  } catch (error) {
    // An auth problem is reported as a tool error, not thrown: the patient
    // sees "your token expired" and what to do about it, rather than a
    // connection that dies without explanation.
    return textResult(
      { error: error instanceof TokenError ? error.code : 'unauthenticated',
        message: error.message },
      true,
    );
  }

  try {
    await ensureDatabase();
  } catch (error) {
    console.error('Database unavailable:', error.message);

    return textResult(
      {
        error: 'database_unavailable',
        message:
          'Could not reach the Prescripto database. Check that it is running ' +
          'and that backend/.env points at it.',
      },
      true,
    );
  }

  const result = await runTool(ctx, name, args, { sessionId });

  // runTool returns { error, message } for an unknown tool or arguments its
  // schema rejected. Those are the model's mistakes and are surfaced as tool
  // errors so it can correct itself.
  return textResult(result, Boolean(result?.error));
};
