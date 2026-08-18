import { getTool } from './tools/index.js';
import { logToolCall } from './guardrails/auditLog.js';

// The only sanctioned way to execute a tool.
//
// Rule 8 says every tool call is logged. If logging were the caller's
// responsibility it could be forgotten, and there will be two callers: the
// agent loop (2.2) and the MCP server (4.3). Routing every execution through
// here makes the audit row a precondition of getting data back.

const countResults = (result) => {
  if (Array.isArray(result)) return result.length;
  if (result === null || result === undefined) return 0;
  return 1;
};

export const runTool = async (ctx, toolName, rawArgs = {}, { sessionId }) => {
  const tool = getTool(toolName);

  // An unknown tool name is worth recording: it is either a model error or
  // someone probing for a tool that does not exist.
  if (!tool) {
    await logToolCall({
      sessionId,
      userId: ctx?.userId,
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
      userId: ctx?.userId,
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

  // Run, then log, then return. The return is gated on the insert succeeding,
  // so no output escapes unlogged; running first is what makes result_count
  // knowable in a single write. Safe only because every tool is read-only —
  // when join_waitlist (5.3) lands, a mutating tool must log BEFORE it writes.
  const result = await tool.handler(ctx, parsed.data);

  await logToolCall({
    sessionId,
    userId: ctx?.userId,
    role: ctx?.role,
    toolName: tool.name,
    args: parsed.data,
    resultCount: countResults(result),
  });

  return result;
};
