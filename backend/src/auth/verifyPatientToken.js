import jwt from 'jsonwebtoken';

import { TokenError } from './TokenError.js';

// Moved to its own module in 5.6, when doctors/verifyDoctorToken.js became the
// second thrower. Re-exported here so every existing importer of
// `{ TokenError }` from this file keeps working unchanged.
export { TokenError };

// The single definition of "a verified patient", shared by every transport.
//
// Rule 3 says identity comes from `ctx`, built from a verified JWT, and never
// from a tool argument. That guarantee is only as good as the number of places
// it is implemented: HTTP had this logic inline in authMiddleware, and the MCP
// server (4.2) needs the same answer with no request to read a header from.
// Two copies would be two chances to get it wrong.
//
// This returns the CTX ITSELF rather than a decoded payload, deliberately.
// Callers do not get to decide what identity means or which claim to trust —
// they receive `{ userId, role }` or an error, and nothing else.

export const verifyPatientToken = (token) => {
  if (!token) {
    throw new TokenError('no_token', 'No token provided.');
  }

  // Checked BEFORE jwt.verify, because that call cannot tell us apart from a
  // forged token: with no secret it throws JsonWebTokenError("secret or public
  // key must be provided") — the same class a bad signature produces. Left to
  // that, a server misconfiguration is reported to the caller as "your token
  // is invalid" and someone spends an afternoon on the wrong problem.
  if (!process.env.JWT_SECRET) {
    throw new TokenError(
      'misconfigured',
      'JWT_SECRET is not set, so no token can be verified.',
    );
  }

  let decoded;

  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new TokenError('expired', 'Token has expired.');
    }

    if (error.name === 'JsonWebTokenError') {
      throw new TokenError('invalid', 'Token is invalid.');
    }

    // A missing JWT_SECRET lands here rather than being mistaken for a bad
    // token — the distinction matters, because one is the caller's problem and
    // the other is the operator's.
    throw error;
  }

  // A doctor's or admin's token is a valid signature for the wrong person. The
  // patient tools are scoped by ctx.userId, so letting one through would mean
  // reading someone's appointments under a doctor's identity.
  if (decoded.role !== 'patient') {
    throw new TokenError('wrong_role', 'Not authorized as patient.');
  }

  return { userId: decoded.id, role: 'patient' };
};

export default verifyPatientToken;
