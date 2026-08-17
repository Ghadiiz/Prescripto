// The PATIENT tool registry.
//
// Patient-scoped only. The doctor tools from 5.5 get their own registry and
// their own server (mcp/doctor-server.js, 5.6) — a separate process with
// separate auth. Never append a doctor tool here and gate it on ctx.role:
// rule 6 exists to keep one mistake in this file from spanning both roles.
//
// Every tool the assistant can call is registered here and nowhere else. This
// is the list the 1.8 guardrail tests iterate (no identity key in any schema,
// no write tool registered), the list 2.2 turns into tool definitions for the
// provider, and the list 4.3 exposes over MCP.
//
// See README.md in this directory for the descriptor shape and the rules each
// tool must satisfy.

import searchDoctors from './searchDoctors.js';

export const tools = [searchDoctors];

export const getTool = (name) => tools.find((tool) => tool.name === name);
