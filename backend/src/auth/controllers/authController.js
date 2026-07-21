import * as authService from '../services/authService.js';
import {
  isValidEmail,
  isStrongPassword,
  isValidName,
} from '../../utils/validators.js';

export const registerUser = async (req, res) => {
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
    console.error('Register error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed',
    });
  }
};

export const loginUser = async (req, res) => {
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
    if (error.message === 'INVALID_CREDENTIALS') {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    if (error.message === 'EMAIL_NOT_VERIFIED') {
      return res.status(403).json({
        success: false,
        message:
          'Please verify your email before logging in. Check your inbox for the verification link.',
        needsVerification: true,
      });
    }

    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed',
    });
  }
};

export const getUserProfile = async (req, res) => {
  try {
    const user = await authService.getUserProfileService(req.userId);

    res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    if (error.message === 'USER_NOT_FOUND') {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch profile',
    });
  }
};

export const updateUserProfile = async (req, res) => {
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
    if (error.message === 'NO_UPDATES') {
      return res.status(400).json({
        success: false,
        message: 'No fields to update',
      });
    }

    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile',
    });
  }
};

export const uploadProfileImage = async (req, res) => {
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
    if (error.message === 'NO_IMAGE_FILE') {
      return res.status(400).json({
        success: false,
        message: 'No image file provided',
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to upload image',
    });
  }
};

export const verifyEmail = async (req, res) => {
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
    if (error.message === 'INVALID_OR_EXPIRED_TOKEN') {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired verification token',
      });
    }

    console.error('Verify email error:', error);
    res.status(500).json({
      success: false,
      message: 'Email verification failed',
    });
  }
};

export const resendVerificationEmail = async (req, res) => {
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
    if (error.message === 'USER_NOT_FOUND') {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    if (error.message === 'ALREADY_VERIFIED') {
      return res.status(400).json({
        success: false,
        message: 'Email already verified',
      });
    }

    console.error('Resend verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send verification email',
    });
  }
};

export const forgotPassword = async (req, res) => {
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
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process password reset request',
    });
  }
};

export const resetPassword = async (req, res) => {
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
    if (error.message === 'INVALID_OR_EXPIRED_TOKEN') {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token',
      });
    }

    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Password reset failed',
    });
  }
};
