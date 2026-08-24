import { verifyPatientToken, TokenError } from '../verifyPatientToken.js';

// HTTP's view of the shared identity check. The verification itself lives in
// verifyPatientToken.js so the MCP server (4.2) reaches the same answer with
// no request to read a header from; this file only maps the outcome onto
// status codes.
//
// The mapping is unchanged from before the extraction: 401 for a missing,
// expired or malformed token, 403 for a valid signature belonging to someone
// who is not a patient. The endpoint tests assert each of those.
const STATUS_BY_CODE = {
  no_token: {
    status: 401,
    message: 'No token provided. Authorization denied.',
  },
  expired: {
    status: 401,
    message: 'Token has expired. Please login again.',
  },
  invalid: {
    status: 401,
    message: 'Invalid token. Authorization denied.',
  },
  wrong_role: {
    status: 403,
    message: 'Access denied. Not authorized as patient.',
  },
};

const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const ctx = verifyPatientToken(token);

    req.userId = ctx.userId;
    next();
  } catch (error) {
    // `misconfigured` deliberately has no entry: JWT_SECRET being absent is
    // our fault, not the caller's, and it falls through to the 500 below
    // rather than telling a patient their token is bad.
    const mapped = STATUS_BY_CODE[error.code];

    if (error instanceof TokenError && mapped) {
      return res
        .status(mapped.status)
        .json({ success: false, message: mapped.message });
    }

    // Anything else is ours, not the caller's — a missing JWT_SECRET, say.
    console.error('Auth middleware error:', error);

    res.status(500).json({
      success: false,
      message: 'Authentication failed',
    });
  }
};

export { authMiddleware };
