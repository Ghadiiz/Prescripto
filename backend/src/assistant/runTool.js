import { tools as patientTools } from './tools/index.js';
import { logToolCall, recordToolOutcome } from './guardrails/auditLog.js';

// The only sanctioned way to execute a tool.
//
// Rule 8 says every tool call is logged. If logging were the caller's
// responsibility it could be forgotten, and there are now three callers: the
// agent loop (2.2), the MCP patient server (4.3) and the doctor server (5.6).
// Routing every execution through here makes the audit row a precondition of
// getting data back.
//
// 5.5 made this a FACTORY rather than adding a second registry to it. The
// registry is bound per PROCESS — patient tools here, doctor tools in the
// doctor server — so there is no role check anywhere in this file and no way
// for data to select which set of tools is reachable. That is rule 6 applied
// to the runner: one audit implementation, two bindings, never one dispatch
// that both roles pass through.

const countResults = (result) => {
  if (Array.isArray(result)) return result.length;
  if (result === null || result === undefined) return 0;
  return 1;
};

// `auditIdentity` exists because a doctor's identity is not `ctx.userId`.
//
// A doctor JWT's `id` is `doctors.id`, a different id space from `users.id`,
// and 5.5's doctor ctx is `{ doctorId, role }` so that a doctor ctx reaching a
// patient tool reads nothing instead of reading the patient who happens to
// share that number. `assistant_audit_log.user_id` is NOT NULL and has no
// foreign key — 003 gave it a `role` ENUM precisely so both id spaces could
// share the column.
//
// Passing the extractor in, rather than branching on `ctx.role` per call,
// keeps that difference bound once at construction where it can be reviewed.
export const createToolRunner = (
  registry,
  auditIdentity = (ctx) => ctx?.userId,
) => {
  const getTool = (name) => registry.find((tool) => tool.name === name);

  return async (ctx, toolName, rawArgs = {}, { sessionId }) => {
    const tool = getTool(toolName);
    const userId = auditIdentity(ctx);

    // An unknown tool name is worth recording: it is either a model error or
    // someone probing for a tool that does not exist.
    if (!tool) {
      await logToolCall({
        sessionId,
        userId,
        role: ctx?.role,
        toolName: String(toolName).slice(0, 64),
        args: null,
        resultCount: null,
      });

      return { error: 'unknown_tool', message: `No tool named "${toolName}".` };
    }

    const parsed = tool.schema.safeParse(rawArgs);

    // Rejected calls are logged with null arguments. The attempt is recorded
    // without storing unvalidated model text in the audit table.
    if (!parsed.success) {
      await logToolCall({
        sessionId,
        userId,
        role: ctx?.role,
        toolName: tool.name,
        args: null,
        resultCount: null,
      });

      return {
        error: 'invalid_arguments',
        message: parsed.error.issues
          .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
          .join('; '),
      };
    }

    // A mutating tool is logged BEFORE it runs, and the order matters.
    //
    // For a read tool, running first is what makes result_count knowable in a
    // single insert, and the return is gated on that insert so no output
    // escapes unlogged. But a WRITE that crashes between the row landing and
    // the log being written would leave a change in the database with no audit
    // trail at all, which rule 8 does not permit.
    //
    // So writes log first with a null result_count, then fill it in. A row
    // left with result_count NULL reads as "attempted, outcome unknown" —
    // which is exactly the state a crash should leave behind, and is
    // distinguishable from the 0 a read returns when it simply found nothing.
    if (tool.mutates) {
      const auditId = await logToolCall({
        sessionId,
        userId,
        role: ctx?.role,
        toolName: tool.name,
        args: parsed.data,
        resultCount: null,
      });

      // `sessionId` is passed on to the handler because the confirmation token
      // for join_waitlist is bound to it. Read tools ignore the third argument.
      const result = await tool.handler(ctx, parsed.data, { sessionId });

      await recordToolOutcome(auditId, countResults(result));

      return result;
    }

    const result = await tool.handler(ctx, parsed.data, { sessionId });

    await logToolCall({
      sessionId,
      userId,
      role: ctx?.role,
      toolName: tool.name,
      args: parsed.data,
      resultCount: countResults(result),
    });

    return result;
  };
};

// The PATIENT runner. Every existing caller — agentLoop, mcp/callTool.js and
// the test suites — imports this and is unaffected by the factory above.
export const runTool = createToolRunner(patientTools);
