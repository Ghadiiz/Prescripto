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
