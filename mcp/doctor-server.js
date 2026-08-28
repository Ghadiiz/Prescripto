// MUST be the first import. See stdioGuard.js for why the ordering matters.
import './stdioGuard.js';
// Second, and before any backend import: the backend cannot be loaded
// before its env exists. See env.js.
import './env.js';

import { pathToFileURL } from 'node:url';

import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

// Rule 1: tools are called IN PROCESS, reaching the same service layer the
// doctor panel does rather than making HTTP requests back to our own API.
import { doctorTools } from '../backend/src/assistant/doctorTools/index.js';
import { describeAuth } from './doctor-context.js';
import { callDoctorTool, sessionId } from './doctor-callTool.js';

const NAME = 'prescripto-doctor';
const VERSION = '1.0.0';

// Rule 6, from the other side.
//
// patient-server.js refuses to start if a DOCTOR tool reaches its registry.
// This is the reflection: a PATIENT tool here would mean a doctor's token
// reading a patient's own appointments, or — worse — the one write tool
// running under an identity it was never scoped for.
//
// Named rather than derived from the patient registry on purpose: importing
// tools/index.js here would load the patient tools into the doctor process,
// which is exactly the coupling rule 6 exists to prevent.
const PATIENT_TOOL_NAMES = [
  'search_doctors',
  'get_doctor',
  'list_specialities',
  'check_availability',
  'suggest_speciality',
  'my_appointments',
  'join_waitlist',
];

export const assertDoctorRegistry = (registry) => {
  const smuggled = registry
    .map((tool) => tool.name)
    .filter((name) => PATIENT_TOOL_NAMES.includes(name));

  if (smuggled.length > 0) {
    throw new Error(
      `Rule 6 violation: patient tools found in the doctor registry ` +
        `(${smuggled.join(', ')}). Patient tools belong to ` +
        'mcp/patient-server.js, a separate process with separate auth.',
    );
  }

  // Rule 2's single exception is join_waitlist, a patient tool. Nothing on
  // this side writes, and a write appearing here would reach a host that
  // drives the model itself.
  const writes = registry.filter((tool) => tool.mutates).map((tool) => tool.name);

  if (writes.length > 0) {
    throw new Error(
      `Rule 2 violation: write tool(s) in the doctor registry (${writes.join(', ')}).`,
    );
  }

  return registry;
};

export const createServer = () => {
  assertDoctorRegistry(doctorTools);

  const server = new McpServer({ name: NAME, version: VERSION });

  for (const tool of doctorTools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.schema },
      // Every call goes through callDoctorTool, which means through
      // runDoctorTool, which means an audit row. No tool's handler is
      // reachable from here.
      (args) => callDoctorTool(tool.name, args),
    );
  }

  return server;
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
      `${doctorTools.length} read-only doctor tool(s) registered; session ${sessionId}; ` +
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
// NOT `import.meta.main`: that is undefined on this Node (22.17.0, checked).
// pathToFileURL is what makes the comparison correct on Windows, where argv[1]
// is a drive path and import.meta.url is a file:// URL.
const isEntryPoint =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  main().catch((error) => {
    console.error('Failed to start:', error);
    process.exit(1);
  });
}
