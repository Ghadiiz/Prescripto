import * as authService from '../services/authService.js';
import {
  isValidEmail,
  isStrongPassword,
  isValidName,
} from '../../utils/validators.js';

export const registerUser = async (req, res, next) => {
  try {
    const {
      name,
      email,
      password,
      phone,
      address_line1,
      address_line2,
      gender,
      dob,
    } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, and password are required',
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address',
      });
    }

    if (!isStrongPassword(password)) {
      return res.status(400).json({
        success: false,
        message:
          'Password must be at least 8 characters and include a letter and a number',
      });
    }

    if (!isValidName(name)) {
      return res.status(400).json({
        success: false,
        message: 'Name must be between 2 and 100 characters',
      });
    }

    const userData = {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password,
      phone: phone || null,
      address_line1: address_line1 || null,
      address_line2: address_line2 || null,
      gender: gender || null,
      dob: dob || null,
    };

    const result = await authService.registerUserService(userData);

    if (result.alreadyExists) {
      return res.status(201).json({
        success: true,
        message:
          'Registration successful! Please check your email to verify your account.',
        token: null,
        needsVerification: true,
      });
    }

    res.status(201).json({
      success: true,
      message:
        'Registration successful! Please check your email to verify your account.',
      token: result.token,
      needsVerification: true,
    });
  } catch (error) {
    next(error);
  }
};

export const loginUser = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required',
      });
    }

    const result = await authService.loginUserService(email, password);

    res.status(200).json({
      success: true,
      message: 'Login successful',
      token: result.token,
      user: result.user,
    });
  } catch (error) {
    next(error);
  }
};

export const getUserProfile = async (req, res, next) => {
  try {
    const user = await authService.getUserProfileService(req.userId);

    res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    next(error);
  }
};

export const updateUserProfile = async (req, res, next) => {
  try {
    const user = await authService.updateUserProfileService(
      req.userId,
      req.body,
    );

    res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    next(error);
  }
};

export const uploadProfileImage = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided',
      });
    }

    const user = await authService.uploadUserProfileImageService(
      req.userId,
      req.file,
    );

    res.status(200).json({
      success: true,
      message: 'Profile image uploaded successfully',
      user,
    });
  } catch (error) {
    next(error);
  }
};

export const verifyEmail = async (req, res, next) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Verification token is required',
      });
    }

    await authService.verifyEmailService(token);

    res.status(200).json({
      success: true,
      message: 'Email verified successfully! You can now login.',
    });
  } catch (error) {
    next(error);
  }
};

export const resendVerificationEmail = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required',
      });
    }

    await authService.resendVerificationEmailService(email);

    res.status(200).json({
      success: true,
      message: 'Verification email sent! Please check your inbox.',
    });
  } catch (error) {
    next(error);
  }
};

export const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required',
      });
    }

    const result = await authService.forgotPasswordService(email);

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const resetPassword = async (req, res, next) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({
        success: false,
        message: 'Token and new password are required',
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters long',
      });
    }

    await authService.resetPasswordService(token, password);

    res.status(200).json({
      success: true,
      message:
        'Password reset successful! You can now login with your new password.',
    });
  } catch (error) {
    next(error);
  }
};
