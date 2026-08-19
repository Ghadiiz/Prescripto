import { generate } from './agentService.js';
import { runTool } from './runTool.js';
import { buildToolDefinitions } from './toolDefinitions.js';

// The tool-use loop. Provider-agnostic: it only knows the normalised shape
// agentService returns.

// A hard stop. Without it a model that keeps asking for tools would loop until
// the quota or the request timeout ran out.
export const MAX_ITERATIONS = 5;

const CAP_MESSAGE =
  'I could not finish working that out. Could you rephrase, or ask about one ' +
  'thing at a time?';

export const runConversation = async ({
  ctx,
  sessionId,
  system,
  messages = [],
  signal,
} = {}) => {
  const toolDefinitions = buildToolDefinitions();
  const conversation = [...messages];

  let toolCallsMade = 0;
  let lastText = '';

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration += 1) {
    const response = await generate({
      system,
      messages: conversation,
      tools: toolDefinitions,
      signal,
    });

    if (response.text) lastText = response.text;

    // No tools requested: the model is answering, so we are done.
    if (!response.toolCalls?.length) {
      return {
        text: response.text,
        toolCallsMade,
        iterations: iteration,
        stoppedReason: 'complete',
      };
    }

    // The model asking for tools IS one assistant turn, recorded once with the
    // calls it actually made. Appending an empty assistant message per call
    // would both lose the request and misrepresent one turn as several, so the
    // next request would show results for calls the model cannot see itself
    // making.
    conversation.push({
      role: 'assistant',
      content: response.text ?? '',
      toolCalls: response.toolCalls,
    });

    // Sequential, not parallel: audit rows then land in conversation order,
    // which is what makes the log readable after the fact.
    for (const call of response.toolCalls) {
      // Always via runTool, never tool.handler — that is what makes rule 8's
      // audit row unavoidable.
      //
      // runTool RETURNS { error } for a bad tool name or bad arguments: those
      // are the model's mistakes and get fed back so it can correct itself.
      // It THROWS when the audit write fails, and that must not be caught into
      // a tool result — the turn ends with no model-visible text. Letting it
      // propagate is the entire reason 1.7 chose a throw over an error object.
      const result = await runTool(ctx, call.name, call.args, { sessionId });

      toolCallsMade += 1;

      // One tool result per call, in the order the calls were made.
      // `providerRef` is opaque: carried through so the provider can pair the
      // result with its call, never inspected here.
      conversation.push({
        role: 'tool',
        name: call.name,
        content: JSON.stringify(result),
        ...(call.providerRef ? { providerRef: call.providerRef } : {}),
      });
    }
  }

  // Cap reached. Return whatever the model last said rather than nothing, but
  // do not spend another provider call asking it to summarise — that burns
  // quota exactly when the model is already misbehaving.
  return {
    text: lastText || CAP_MESSAGE,
    toolCallsMade,
    iterations: MAX_ITERATIONS,
    stoppedReason: 'iteration_cap',
  };
};
