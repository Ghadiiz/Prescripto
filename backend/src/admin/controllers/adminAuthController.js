import * as adminAuthService from '../services/adminAuthService.js';

export const login = async (req, res, next) => {
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
    next(error);
  }
};

export const createAdmin = async (req, res, next) => {
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
    next(error);
  }
};

export const getProfile = async (req, res, next) => {
  try {
    const admin = await adminAuthService.getAdminProfile(req.adminId);

    res.status(200).json({
      success: true,
      admin,
    });
  } catch (error) {
    next(error);
  }
};

export const updateProfile = async (req, res, next) => {
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
    next(error);
  }
};

export const changePassword = async (req, res, next) => {
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
    next(error);
  }
};
