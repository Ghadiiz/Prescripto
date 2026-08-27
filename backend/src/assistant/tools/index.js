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
import getDoctor from './getDoctor.js';
import listSpecialities from './listSpecialities.js';
import checkAvailability from './checkAvailability.js';
import suggestSpeciality from './suggestSpeciality.js';
import myAppointments from './myAppointments.js';
import joinWaitlist from './joinWaitlist.js';

export const tools = [
  searchDoctors,
  getDoctor,
  listSpecialities,
  checkAvailability,
  suggestSpeciality,
  myAppointments,
  // THE ONLY WRITE TOOL (rule 2's single exception). Everything above is
  // read-only. Adding another `mutates: true` tool here means changing rule 2,
  // and the 1.8 guardrail suite will fail until someone does so deliberately.
  joinWaitlist,
];

// The read-only subset. mcp/patient-server.js registers THIS, not `tools`:
// over MCP the host drives the model, so the system prompt and agent loop that
// gate the write do not apply, and 4.4 measured hosts widening tool calls
// unprompted. A widened search is harmless; a widened write leaves a row.
export const readOnlyTools = tools.filter((tool) => !tool.mutates);

export const getTool = (name) => tools.find((tool) => tool.name === name);
