import { getDB } from '../../config/mysql.js';
import fs from 'fs';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import * as userModel from '../models/userModel.js';
import cloudinary from '../../config/cloudinary.js';
import crypto from 'crypto';
import {
  sendVerificationEmail,
  sendPasswordResetEmail,
} from '../../utils/emailService.js';

export const registerUserService = async (userData) => {
  const db = getDB();
  try {
    const [existingUser] = await db.query(
      'SELECT * FROM users WHERE email = ?',
      [userData.email],
    );

    if (existingUser.length > 0) {
      return { alreadyExists: true };
    }

    const hashedPassword = await bcrypt.hash(userData.password, 10);

    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const [result] = await db.query(
      `INSERT INTO users 
       (name, email, password, phone, address_line1, address_line2, gender, dob, 
        is_verified, verification_token, verification_token_expires) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, FALSE, ?, ?)`,
      [
        userData.name,
        userData.email,
        hashedPassword,
        userData.phone,
        userData.address_line1,
        userData.address_line2,
        userData.gender,
        userData.dob,
        verificationToken,
        verificationTokenExpires,
      ],
    );

    const token = jwt.sign(
      { id: result.insertId, email: userData.email, role: 'patient' },
      process.env.JWT_SECRET,
      { expiresIn: '7d' },
    );

    try {
      await sendVerificationEmail(
        userData.email,
        userData.name,
        verificationToken,
      );
    } catch (emailError) {
      console.error('Failed to send verification email:', emailError);
    }

    return {
      token,
      userId: result.insertId,
      needsVerification: true,
    };
  } catch (error) {
    throw error;
  }
};

export const loginUserService = async (email, password) => {
  const db = getDB();
  try {
    const [users] = await db.query('SELECT * FROM users WHERE email = ?', [
      email,
    ]);

    if (users.length === 0) {
      throw new Error('INVALID_CREDENTIALS');
    }

    const user = users[0];

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      throw new Error('INVALID_CREDENTIALS');
    }

    if (!user.is_verified) {
      throw new Error('EMAIL_NOT_VERIFIED');
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' },
    );

    return {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        address: {
          line1: user.address_line1,
          line2: user.address_line2,
        },
        gender: user.gender,
        dob: user.dob,
        image: user.image,
      },
    };
  } catch (error) {
    throw error;
  }
};

export const getUserProfileService = async (userId) => {
  const user = await userModel.findUserById(userId);

  if (!user) {
    throw new Error('USER_NOT_FOUND');
  }

  return {
    _id: user.id.toString(),
    name: user.name,
    email: user.email,
    phone: user.phone,
    address: {
      line1: user.address_line1,
      line2: user.address_line2,
    },
    gender: user.gender,
    dob: user.dob,
    image: user.image,
  };
};

export const updateUserProfileService = async (userId, data) => {
  const { name, phone, address_line1, address_line2, gender, dob } = data;

  const updates = [];
  const values = [];

  if (name) {
    updates.push('name = ?');
    values.push(name);
  }
  if (phone !== undefined) {
    updates.push('phone = ?');
    values.push(phone);
  }
  if (address_line1 !== undefined) {
    updates.push('address_line1 = ?');
    values.push(address_line1);
  }
  if (address_line2 !== undefined) {
    updates.push('address_line2 = ?');
    values.push(address_line2);
  }
  if (gender) {
    updates.push('gender = ?');
    values.push(gender);
  }
  if (dob) {
    updates.push('dob = ?');
    values.push(dob);
  }

  if (updates.length === 0) {
    throw new Error('NO_UPDATES');
  }

  const user = await userModel.updateUser(userId, updates, values);

  return {
    _id: user.id.toString(),
    name: user.name,
    email: user.email,
    phone: user.phone,
    address: {
      line1: user.address_line1,
      line2: user.address_line2,
    },
    gender: user.gender,
    dob: user.dob,
    image: user.image,
  };
};

export const uploadUserProfileImageService = async (userId, file) => {
  if (!file) {
    throw new Error('NO_IMAGE_FILE');
  }

  const imageUpload = await cloudinary.uploader.upload(file.path, {
    resource_type: 'image',
  });

  try {
    fs.unlinkSync(file.path);
  } catch (e) {
    console.error('Temp file cleanup failed:', e.message);
  }

  const imageUrl = imageUpload.secure_url;

  await userModel.updateUserImage(userId, imageUrl);

  const user = await userModel.findUserById(userId);

  return {
    _id: user.id.toString(),
    name: user.name,
    email: user.email,
    phone: user.phone,
    address: {
      line1: user.address_line1,
      line2: user.address_line2,
    },
    gender: user.gender,
    dob: user.dob,
    image: user.image,
  };
};

export const verifyEmailService = async (token) => {
  const db = getDB();
  try {
    const [users] = await db.query(
      'SELECT * FROM users WHERE verification_token = ? AND verification_token_expires > NOW()',
      [token],
    );

    if (users.length === 0) {
      throw new Error('INVALID_OR_EXPIRED_TOKEN');
    }

    const user = users[0];

    await db.query(
      'UPDATE users SET is_verified = TRUE, verification_token = NULL, verification_token_expires = NULL WHERE id = ?',
      [user.id],
    );

    return {
      success: true,
      message: 'Email verified successfully',
    };
  } catch (error) {
    throw error;
  }
};

export const resendVerificationEmailService = async (email) => {
  const db = getDB();
  try {
    const [users] = await db.query('SELECT * FROM users WHERE email = ?', [
      email,
    ]);

    if (users.length === 0) {
      throw new Error('USER_NOT_FOUND');
    }

    const user = users[0];

    if (user.is_verified) {
      throw new Error('ALREADY_VERIFIED');
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await db.query(
      'UPDATE users SET verification_token = ?, verification_token_expires = ? WHERE id = ?',
      [verificationToken, verificationTokenExpires, user.id],
    );

    await sendVerificationEmail(user.email, user.name, verificationToken);

    return {
      success: true,
      message: 'Verification email sent',
    };
  } catch (error) {
    throw error;
  }
};

export const forgotPasswordService = async (email) => {
  const db = getDB();
  try {
    const [users] = await db.query('SELECT * FROM users WHERE email = ?', [
      email,
    ]);

    if (users.length === 0) {
      return {
        success: true,
        message: 'If an account exists, a password reset email has been sent',
      };
    }

    const user = users[0];

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpires = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    await db.query(
      'UPDATE users SET reset_password_token = ?, reset_password_token_expires = ? WHERE id = ?',
      [resetToken, resetTokenExpires, user.id],
    );

    await sendPasswordResetEmail(user.email, user.name, resetToken);

    return {
      success: true,
      message: 'If an account exists, a password reset email has been sent',
    };
  } catch (error) {
    throw error;
  }
};

export const resetPasswordService = async (token, newPassword) => {
  const db = getDB();
  try {
    const [users] = await db.query(
      'SELECT * FROM users WHERE reset_password_token = ? AND reset_password_token_expires > NOW()',
      [token],
    );

    if (users.length === 0) {
      throw new Error('INVALID_OR_EXPIRED_TOKEN');
    }

    const user = users[0];

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await db.query(
      'UPDATE users SET password = ?, reset_password_token = NULL, reset_password_token_expires = NULL WHERE id = ?',
      [hashedPassword, user.id],
    );

    return {
      success: true,
      message: 'Password reset successful',
    };
  } catch (error) {
    throw error;
  }
};
