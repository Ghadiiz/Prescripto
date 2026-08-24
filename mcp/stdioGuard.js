// stdout belongs to the protocol. Nothing else may touch it.
//
// On a stdio MCP transport, JSON-RPC frames and any stray print share one
// stream, so a single log line corrupts the connection. In Claude Desktop that
// surfaces as an unexplained "server disconnected" with nothing useful in the
// logs.
//
// This is not hypothetical. Importing the backend writes three lines to stdout
// before a single request is handled — measured:
//
//   [dotenv@17.2.3] injecting env (17) from .env -- tip: …
//   [dotenv@17.2.3] injecting env (0) from .env -- tip: …
//   MySQL Doctor Appointment Database Connected...
//
// Two of those come from dotenv (which the backend calls in several modules)
// and one from connectDB's console.log. Both are silenced below.
//
// WHY THIS IS ITS OWN MODULE, imported first rather than written at the top of
// patient-server.js: `import` statements are hoisted, so every imported module
// body executes before any top-level statement in the importing file. Written
// inline these assignments would run AFTER the backend had already printed.
// ESM evaluates imports in order, so being the first import is what makes this
// work.
//
// Diagnostics are not lost — they go to stderr, which the MCP host shows in
// its server logs.

process.env.DOTENV_CONFIG_QUIET = 'true';

console.log = console.error;
console.info = console.error;
console.debug = console.error;
console.warn = console.error;
