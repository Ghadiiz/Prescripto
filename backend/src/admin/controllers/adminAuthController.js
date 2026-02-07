import * as adminAuthService from '../services/adminAuthService.js';

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required',
      });
    }

    const result = await adminAuthService.loginAdmin(email, password);

    res.status(200).json({
      success: true,
      message: 'Admin login successful',
      data: result,
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(401).json({
      success: false,
      message: error.message || 'Login failed',
    });
  }
};

export const createAdmin = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, and password are required',
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters long',
      });
    }

    await adminAuthService.createAdmin({ name, email, password });

    res.status(201).json({
      success: true,
      message: 'Admin created successfully! Email sent with login credentials.',
    });
  } catch (error) {
    if (error.message === 'EMAIL_EXISTS') {
      return res.status(400).json({
        success: false,
        message: 'An admin with this email already exists',
      });
    }

    console.error('Create admin error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create admin',
    });
  }
};

export const getProfile = async (req, res) => {
  try {
    const admin = await adminAuthService.getAdminProfile(req.adminId);

    res.status(200).json({
      success: true,
      admin,
    });
  } catch (error) {
    console.error('Get admin profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch profile',
    });
  }
};

export const updateProfile = async (req, res) => {
  try {
    const { name, email } = req.body;

    const admin = await adminAuthService.updateAdminProfile(req.adminId, {
      name,
      email,
    });

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      admin,
    });
  } catch (error) {
    if (error.message === 'EMAIL_EXISTS') {
      return res.status(400).json({
        success: false,
        message: 'Email already in use',
      });
    }

    console.error('Update admin profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile',
    });
  }
};

export const changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Old password and new password are required',
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 8 characters long',
      });
    }

    await adminAuthService.changeAdminPassword(
      req.adminId,
      oldPassword,
      newPassword,
    );

    res.status(200).json({
      success: true,
      message: 'Password changed successfully',
    });
  } catch (error) {
    if (error.message === 'INVALID_PASSWORD') {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect',
      });
    }

    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to change password',
    });
  }
};
