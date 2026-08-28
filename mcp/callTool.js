import { randomUUID } from 'node:crypto';

import { runTool } from '../backend/src/assistant/runTool.js';
import { TokenError } from '../backend/src/auth/TokenError.js';
import { createContext } from './context.js';
import { ensureDatabase } from './database.js';

// The audited bridge between MCP and the tools. This is the whole security
// surface of 4.3, and of 5.6's doctor server.
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
//
// 5.6 made this a FACTORY for the same reason 5.5 did it to runTool: there are
// now two servers, and the context builder and runner are bound per PROCESS
// rather than chosen per call. Nothing a model sends selects which pair it
// gets.

const textResult = (payload, isError = false) => ({
  content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  ...(isError ? { isError: true } : {}),
});

export const createCallTool = ({ createContext: buildContext, runTool: run }) => {
  // One session per CONNECTION, minted when the binding is created.
  //
  // 2.7 mints one per HTTP request so a turn's audit rows group together; over
  // stdio the closest analogue is the connection, since the protocol exposes
  // no conversation boundary. Honest limitation: a host left open for days
  // groups every call into one id.
  //
  // Each binding gets its OWN id, so a machine running both servers does not
  // file a doctor's calls and a patient's under the same session.
  const sessionId = randomUUID();

  const callTool = async (name, args = {}) => {
    // Rebuilt per call, deliberately. The token file is re-read each time
    // (4.2), so pointing it at a different account takes effect immediately —
    // and a long-lived server can never serve one person's data under
    // another's identity because it cached a ctx at startup.
    let ctx;

    try {
      ctx = buildContext();
    } catch (error) {
      // An auth problem is reported as a tool error, not thrown: the user sees
      // "your token expired" and what to do about it, rather than a connection
      // that dies without explanation.
      return textResult(
        {
          error: error instanceof TokenError ? error.code : 'unauthenticated',
          message: error.message,
        },
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

    const result = await run(ctx, name, args, { sessionId });

    // runTool returns { error, message } for an unknown tool or arguments its
    // schema rejected. Those are the model's mistakes and are surfaced as tool
    // errors so it can correct itself.
    return textResult(result, Boolean(result?.error));
  };

  return { callTool, sessionId };
};

// The PATIENT binding. patient-server.js imports these two names, unchanged.
const patient = createCallTool({ createContext, runTool });

export const callTool = patient.callTool;
export const sessionId = patient.sessionId;
