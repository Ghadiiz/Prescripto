import jwt from 'jsonwebtoken';

import { TokenError } from '../auth/TokenError.js';

// The single definition of "a verified doctor", shared by every transport.
//
// The mirror of auth/verifyPatientToken.js, and it exists for the same reason:
// the HTTP middleware had this logic inline, and the MCP doctor server (5.6)
// needs the same answer with no request to read a header from. Two copies
// would be two chances to get it wrong.
//
// This returns the CTX ITSELF rather than a decoded payload, deliberately.
// Callers do not get to decide what identity means or which claim to trust —
// they receive `{ doctorId, role }` or an error, and nothing else.

export { TokenError };

export const verifyDoctorToken = (token) => {
  if (!token) {
    throw new TokenError('no_token', 'No token provided.');
  }

  // Checked BEFORE jwt.verify, and this is the bug 5.5 filed as a Known Issue.
  //
  // With no secret, jsonwebtoken throws JsonWebTokenError("secret or public
  // key must be provided") — the SAME class a bad signature produces. The
  // previous middleware mapped that to "Invalid token", so a server missing
  // its JWT_SECRET told the doctor their credentials were bad and someone
  // spends an afternoon on the wrong problem. 4.2 fixed exactly this on the
  // patient side; this is the doctor half.
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

    throw error;
  }

  // A patient's or admin's token is a valid signature for the wrong person.
  // The doctor tools are scoped by ctx.doctorId, so letting one through would
  // mean reading a doctor's schedule under a patient's identity.
  if (decoded.role !== 'doctor') {
    throw new TokenError('wrong_role', 'Not authorized as doctor.');
  }

  // `doctorId`, not `userId` — a doctor JWT's `id` claim is `doctors.id`, a
  // different id space from `users.id`. See doctorTools/README.md; the field
  // name is what makes a cross-role mistake return nothing instead of
  // returning the wrong person's rows.
  return { doctorId: decoded.id, role: 'doctor' };
};

export default verifyDoctorToken;
