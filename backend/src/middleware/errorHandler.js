import { AppError } from '../utils/AppError.js';

export const notFound = (req, res, next) => {
  res.status(404).json({ success: false, message: 'Route not found' });
};

export const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);

  if (err instanceof AppError || err.isOperational) {
    return res.status(err.statusCode || 400).json({ success: false, message: err.message });
  }

  res.status(500).json({ success: false, message: 'Something went wrong. Please try again later.' });
};
