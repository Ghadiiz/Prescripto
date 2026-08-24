// MUST be the first import. See stdioGuard.js for why the ordering matters.
import './stdioGuard.js';
// Second, and before any backend import: the backend cannot be loaded
// before its env exists. See env.js.
import './env.js';

import { pathToFileURL } from 'node:url';

import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

// Rule 1: tools are called IN PROCESS. This import is the whole point of the
// increment — the MCP server reaches the same functions the chat endpoint
// does, rather than making HTTP requests back to our own API. Phase 1 was
// built on the claim that a second transport would mean writing a server, not
// rewriting tools; this is where that gets tested.
import { tools } from '../backend/src/assistant/tools/index.js';
import { describeAuth } from './context.js';

const NAME = 'prescripto-patient';
const VERSION = '1.0.0';

// Rule 6: patient tools and doctor tools live in separate servers, separate
// processes, separate auth. Never one server with a `role` parameter.
//
// A tripwire rather than a duplicate inventory: listing the patient tools here
// would mean editing this file every time 4.3 or a later increment adds one.
// What must never happen is a DOCTOR tool arriving in the patient registry —
// which is a live risk from 5.5, where these four are introduced. If one shows
// up here, this process refuses to start rather than serving it to a patient.
const DOCTOR_TOOL_NAMES = [
  'my_schedule',
  'schedule_gaps',
  'patients_needing_followup',
  'my_stats',
];

export const assertPatientRegistry = (registry) => {
  const smuggled = registry
    .map((tool) => tool.name)
    .filter((name) => DOCTOR_TOOL_NAMES.includes(name));

  if (smuggled.length > 0) {
    throw new Error(
      `Rule 6 violation: doctor tools found in the patient registry ` +
        `(${smuggled.join(', ')}). Doctor tools belong to mcp/doctor-server.js, ` +
        'a separate process with separate auth.',
    );
  }

  return registry;
};

export const createServer = () => {
  assertPatientRegistry(tools);

  // Tools are REGISTERED in 4.3 and identity arrives in 4.2. Until then this
  // server advertises nothing, which is the honest answer for a scaffold — a
  // `tools/list` that returned names it could not actually run would be worse
  // than an empty one.
  return new McpServer({ name: NAME, version: VERSION });
};

const main = async () => {
  const server = createServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);

  // stderr, via the guard — the MCP host surfaces this in its server logs.
  // Status, not a gate. A missing or expired token must not stop the server
  // booting: a host shows a refusing server as a dead entry with nothing
  // explaining why, whereas a running server can return an actionable error
  // from the tool call itself.
  console.error(
    `${NAME} v${VERSION} ready on stdio — ` +
      `${tools.length} patient tool(s) available to register in 4.3; ` +
      `${describeAuth()}.`,
  );

  const shutdown = async () => {
    await server.close().catch(() => {});
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};

// Only start when run directly, so a test can import createServer without
// spawning a transport.
//
// NOT `import.meta.main`: that is undefined on this Node (22.17.0, checked) —
// it arrived later — so the check would silently be falsy and the server would
// exit without ever connecting. pathToFileURL is what makes the comparison
// correct on Windows, where argv[1] is a drive path and import.meta.url is a
// file:// URL.
const isEntryPoint =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  main().catch((error) => {
    console.error('Failed to start:', error);
    process.exit(1);
  });
}
