import {
  loadConversation,
  saveConversation,
  purgeExpiredConversations,
} from './models/conversationQueries.js';

// Conversation history: the last 10 turns per (user_id, role), replayed as
// context on the next turn.
//
// A TURN is one user message plus the assistant's final text reply. Only that
// human-readable exchange is stored — never the intermediate tool-call
// requests, tool results, or providerRef/thoughtSignature plumbing. Four
// reasons, in increasing order of importance:
//
//   1. those internals would push "10 turns" well past 20 messages;
//   2. they would persist doctor and appointment data into a second table;
//   3. they would put provider-specific tokens in our database, breaking the
//      rule that only agentService.js knows which provider is in use;
//   4. replaying a stored tool result would feed back STALE AVAILABILITY —
//      "22 slots free" captured last week, presented as current. Rule 7 says
//      availability is never a promise, and not storing it makes the mistake
//      structurally impossible.
//
// Verified live: text-only history sent with tool definitions attached is
// accepted by the provider and still carries the thread — the model resolved
// "the one in Khalda" from it. The thoughtSignature requirement applies to
// functionCall parts, and stored history contains none.

export const MAX_TURNS = 10;
const MAX_MESSAGES = MAX_TURNS * 2;
export const RETENTION_DAYS = 30;

export const loadHistory = async (ctx) =>
  loadConversation(ctx.userId, ctx.role);

// Appends one turn and trims to the most recent MAX_TURNS.
export const appendTurn = (history, userText, assistantText) => {
  const appended = [
    ...history,
    { role: 'user', content: String(userText ?? '') },
    { role: 'assistant', content: String(assistantText ?? '') },
  ];

  return appended.slice(-MAX_MESSAGES);
};

// Retention runs here rather than on a schedule: it needs no cron, and the
// table stays bounded for as long as anyone is chatting. Exported separately
// so 6.2's BullMQ worker can also call it on a timer once that exists.
export const saveHistory = async (ctx, messages) => {
  await saveConversation(ctx.userId, ctx.role, messages);
  await purgeExpiredConversations(RETENTION_DAYS);
};

export { purgeExpiredConversations };
