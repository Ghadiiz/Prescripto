import validator from 'validator';

export const isValidEmail = (email) => {
  return typeof email === 'string' && email.length > 0 && validator.isEmail(email);
};

export const isStrongPassword = (password) => {
  if (typeof password !== 'string') return false;

  return validator.isStrongPassword(password, {
    minLength: 8,
    minLowercase: 0,
    minUppercase: 0,
    minNumbers: 1,
    minSymbols: 0,
  }) && /[a-zA-Z]/.test(password);
};

export const isValidName = (name) => {
  if (typeof name !== 'string') return false;

  const trimmed = name.trim();
  return trimmed.length >= 2 && trimmed.length <= 100;
};
