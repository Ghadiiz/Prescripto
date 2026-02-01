import * as authService from '../services/authService.js';

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

    const userData = {
      name,
      email,
      password,
      phone: phone || null,
      address_line1: address_line1 || null,
      address_line2: address_line2 || null,
      gender: gender || null,
      dob: dob || null,
    };

    const result = await authService.registerUserService(userData);

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      token: result.token,
    });
  } catch (error) {
    if (error.message === 'EMAIL_EXISTS') {
      return res.status(400).json({
        success: false,
        message: 'Email already registered',
      });
    }

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
    });
  } catch (error) {
    if (error.message === 'INVALID_CREDENTIALS') {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
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
