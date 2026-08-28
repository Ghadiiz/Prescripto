import { verifyDoctorToken } from '../verifyDoctorToken.js';
import { TokenError } from '../../auth/TokenError.js';

// HTTP's view of the shared doctor identity check. The verification itself
// lives in verifyDoctorToken.js so the MCP doctor server (5.6) reaches the same
// answer with no request to read a header from; this file only maps the
// outcome onto status codes.
//
// The mapping preserves what this middleware returned before 5.6 — 401 for a
// missing, expired or malformed token, 403 for a valid signature belonging to
// someone who is not a doctor — with one deliberate change, which is the point
// of the rewrite: a missing JWT_SECRET no longer reports "Invalid token".
const STATUS_BY_CODE = {
  no_token: {
    status: 401,
    message: 'Access denied. No token provided.',
  },
  expired: {
    status: 401,
    message: 'Token expired. Please login again.',
  },
  invalid: {
    status: 401,
    message: 'Invalid token.',
  },
  wrong_role: {
    status: 403,
    message: 'Access denied. Not authorized as doctor.',
  },
};

export const authenticateDoctor = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const ctx = verifyDoctorToken(token);

    // `id` is kept because all eight controller uses read `req.doctor.id`.
    //
    // `email` is NOT kept. It was copied off the token claim and nothing ever
    // read it (grepped across src/), and the verifier returns identity only —
    // a caller that wants the doctor's email should read the row it belongs to.
    req.doctor = { id: ctx.doctorId };

    next();
  } catch (error) {
    // `misconfigured` deliberately has no entry: JWT_SECRET being absent is
    // our fault, not the caller's, and it falls through to the 500 below
    // rather than telling a doctor their token is bad.
    const mapped = STATUS_BY_CODE[error.code];

    if (error instanceof TokenError && mapped) {
      return res
        .status(mapped.status)
        .json({ success: false, message: mapped.message });
    }

    // Anything else is ours, not the caller's — a missing JWT_SECRET, say.
    console.error('Doctor auth middleware error:', error);

    res.status(500).json({
      success: false,
      message: 'Authentication failed',
    });
  }
};
