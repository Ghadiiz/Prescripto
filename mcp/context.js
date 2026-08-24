import { readFileSync } from 'node:fs';

import {
  verifyPatientToken,
  TokenError,
} from '../backend/src/auth/verifyPatientToken.js';

// Where rule 3 lives on this transport.
//
// Over HTTP, ctx comes from a verified Authorization header. A stdio server
// has no request, so the token comes from a file the operator controls — and
// then goes through exactly the same verifyPatientToken the HTTP middleware
// uses. There is no parameter anywhere in this path that a model could
// influence: the tools registered in 4.3 receive the ctx built here, and they
// have no identity argument to offer instead.

export const TOKEN_FILE_VAR = 'PRESCRIPTO_TOKEN_FILE';

// Read on EVERY call rather than cached at startup. Patient tokens expire
// after 7 days, and re-reading means refreshing one is a matter of rewriting
// the file — no editing the host's JSON config, no restarting the server.
const readToken = () => {
  const path = process.env[TOKEN_FILE_VAR];

  if (!path) {
    throw new TokenError(
      'no_token',
      `${TOKEN_FILE_VAR} is not set. Point it at a file containing a ` +
        "patient's access token.",
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

// The messages a patient actually sees when something is wrong. Each says what
// to DO — none of them contains the token.
const GUIDANCE = {
  no_token: (detail) => detail,
  expired: () =>
    'Your access token has expired. Sign in to Prescripto again and write the ' +
    `new token to the file named by ${TOKEN_FILE_VAR}.`,
  invalid: () =>
    'That token could not be verified. Make sure the file contains a complete, ' +
    'current Prescripto access token and nothing else.',
  wrong_role: () =>
    'That token belongs to a doctor or admin account. This server serves ' +
    'patient tools only.',
  misconfigured: () =>
    'The server cannot verify tokens: JWT_SECRET is not available. Check that ' +
    'backend/.env exists and is readable.',
};

export const createContext = () => {
  const token = readToken();

  try {
    return verifyPatientToken(token);
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
    throw new TokenError('misconfigured', `Token verification failed: ${error.message}`);
  }
};

// For the startup log line. Never throws and never returns the token.
export const describeAuth = () => {
  try {
    const ctx = createContext();
    return `authenticated as patient #${ctx.userId}`;
  } catch (error) {
    return `not authenticated — ${error.message}`;
  }
};
