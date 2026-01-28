import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import * as userModel from '../models/userModel.js';

export const registerUserService = async (name, email, password) => {
  const existingUser = await userModel.findUserByEmail(email);

  if (existingUser) {
    throw new Error('EMAIL_EXISTS');
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const userId = await userModel.createUser(name, email, hashedPassword);

  const token = jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: '7d',
  });

  return { token };
};

export const loginUserService = async (email, password) => {
  const user = await userModel.findUserByEmail(email);

  if (!user) {
    throw new Error('INVALID_CREDENTIALS');
  }

  const isPasswordValid = await bcrypt.compare(password, user.password);

  if (!isPasswordValid) {
    throw new Error('INVALID_CREDENTIALS');
  }

  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
    expiresIn: '7d',
  });

  return { token };
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
