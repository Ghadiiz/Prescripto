// The one error class both token verifiers throw.
//
// Extracted from verifyPatientToken.js in 5.6, when a second verifier arrived
// (doctors/verifyDoctorToken.js). Two copies would be two `instanceof` checks
// that silently stop matching each other — and every transport keys its own
// vocabulary off `code`, so the class has to be shared for the mapping to be
// shared.
//
// verifyPatientToken.js re-exports this, so its existing importers did not
// change.
export class TokenError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TokenError';
    // Lets each transport map to its own vocabulary — HTTP statuses in the
    // middlewares, a readable tool error over MCP — without re-deriving the
    // cause.
    this.code = code;
  }
}

export default TokenError;
