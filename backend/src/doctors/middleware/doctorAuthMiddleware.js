import jwt from 'jsonwebtoken';

export const authenticateDoctor = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.',
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.role !== 'doctor') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Not authorized as doctor.',
      });
    }

    req.doctor = {
      id: decoded.id,
      email: decoded.email,
    };

    next();
  } catch (error) {
    console.error('Doctor auth middleware error:', error);

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired. Please login again.',
      });
    }

    res.status(401).json({
      success: false,
      message: 'Invalid token.',
    });
  }
};
