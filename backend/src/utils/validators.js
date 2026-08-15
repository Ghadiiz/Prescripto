import validator from 'validator';
import {
  DOCTOR_LANGUAGES,
  DOCTOR_AREAS,
  DOCTOR_GENDERS,
} from '../constants/doctorOptions.js';

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

export const isValidPhone = (phone) => {
  if (phone === undefined || phone === null || phone === '') return true;
  if (typeof phone !== 'string') return false;
  const trimmed = phone.trim();
  if (!/^\+?[\d\s()-]+$/.test(trimmed)) return false;
  const digitCount = (trimmed.match(/\d/g) || []).length;
  return digitCount >= 7 && digitCount <= 15;
};

export const isPositiveNumber = (value) => {
  const num = Number(value);
  return !Number.isNaN(num) && Number.isFinite(num) && num > 0;
};

// The three doctor profile fields below are all nullable columns, so an empty
// value is valid — same convention as isValidPhone above.

export const isValidGender = (gender) => {
  if (gender === undefined || gender === null || gender === '') return true;
  return DOCTOR_GENDERS.includes(gender);
};

export const isValidArea = (area) => {
  if (area === undefined || area === null || area === '') return true;
  return DOCTOR_AREAS.includes(area);
};

// Stored as a comma-separated list with NO spaces, e.g. 'English,Arabic'.
// The format is part of the validation, not just the vocabulary: a stored
// 'English, Arabic' would silently fail FIND_IN_SET('Arabic', languages),
// leaving a doctor that no language filter can ever return.
export const isValidLanguages = (languages) => {
  if (languages === undefined || languages === null || languages === '') {
    return true;
  }
  if (typeof languages !== 'string') return false;

  const parts = languages.split(',');
  return parts.every(
    (part) => part === part.trim() && DOCTOR_LANGUAGES.includes(part),
  );
};
