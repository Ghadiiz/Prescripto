import { readFileSync } from 'node:fs';

import { verifyDoctorToken } from '../backend/src/doctors/verifyDoctorToken.js';
import { TokenError } from '../backend/src/auth/TokenError.js';

// Where rule 3 lives on the doctor transport. The mirror of context.js.
//
// Over HTTP, ctx comes from a verified Authorization header. A stdio server
// has no request, so the token comes from a file the operator controls — and
// then goes through exactly the same verifyDoctorToken the HTTP middleware
// uses. There is no parameter anywhere in this path that a model could
// influence: the tools registered in doctor-server.js receive the ctx built
// here, and they have no identity argument to offer instead.

// A SEPARATE variable from the patient server's PRESCRIPTO_TOKEN_FILE, and
// deliberately with NO fallback to it.
//
// Sharing one variable would mean the two servers fight over one file, and
// swapping a token would flip both identities at once. Falling back would be
// worse: a doctor server quietly reading a patient's token file fails with
// `wrong_role` and looks like a bad token rather than a missing setting.
export const DOCTOR_TOKEN_FILE_VAR = 'PRESCRIPTO_DOCTOR_TOKEN_FILE';

// Read on EVERY call rather than cached at startup. Doctor tokens expire after
// 7 days, and re-reading means refreshing one is a matter of rewriting the
// file — no editing the host's JSON config, no restarting the server.
const readToken = () => {
  const path = process.env[DOCTOR_TOKEN_FILE_VAR];

  if (!path) {
    throw new TokenError(
      'no_token',
      `${DOCTOR_TOKEN_FILE_VAR} is not set. Point it at a file containing a ` +
        "doctor's access token. Note this is a DIFFERENT variable from the " +
        'patient server\'s PRESCRIPTO_TOKEN_FILE — the two servers do not ' +
        'share an identity.',
    );
  }

  let contents;

  try {
    contents = readFileSync(path, 'utf8');
  } catch (error) {
    throw new TokenError(
      'no_token',
      `Could not read the token file at ${path} (${error.code}).`,
    );
  }

  // Trailing newlines are what you get from `echo "$TOKEN" > file`, and an
  // untrimmed token fails verification with a misleading "invalid" error.
  const token = contents.trim();

  if (!token) {
    throw new TokenError('no_token', `The token file at ${path} is empty.`);
  }

  return token;
};

// The messages a doctor actually sees when something is wrong. Each says what
// to DO — none of them contains the token.
const GUIDANCE = {
  no_token: (detail) => detail,
  expired: () =>
    'Your access token has expired. Sign in to the Prescripto doctor panel ' +
    `again and write the new token to the file named by ${DOCTOR_TOKEN_FILE_VAR}.`,
  invalid: () =>
    'That token could not be verified. Make sure the file contains a complete, ' +
    'current Prescripto doctor access token and nothing else.',
  wrong_role: () =>
    'That token belongs to a patient or admin account. This server serves ' +
    'doctor tools only — the patient tools are a separate server with its own ' +
    'token file.',
  misconfigured: () =>
    'The server cannot verify tokens: JWT_SECRET is not available. Check that ' +
    'backend/.env exists and is readable.',
};

export const createDoctorContext = () => {
  const token = readToken();

  try {
    return verifyDoctorToken(token);
  } catch (error) {
    if (error instanceof TokenError) {
      const guidance = GUIDANCE[error.code];
      throw new TokenError(
        error.code,
        guidance ? guidance(error.message) : error.message,
      );
    }

    // Anything that is not a TokenError is unexpected here; surface it as a
    // server problem rather than implying the token was at fault.
    throw new TokenError(
      'misconfigured',
      `Token verification failed: ${error.message}`,
    );
  }
};

// For the startup log line. Never throws and never returns the token.
export const describeAuth = () => {
  try {
    const ctx = createDoctorContext();
    return `authenticated as doctor #${ctx.doctorId}`;
  } catch (error) {
    return `not authenticated — ${error.message}`;
  }
};
