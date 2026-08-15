// Allowed values for the doctor profile fields the assistant searches on.
//
// DOCTOR_GENDERS must stay in step with the `gender` ENUM added by migration
// 001, and DOCTOR_AREAS with the districts the seed script uses — a value that
// is valid here but absent there is a doctor no search filter will return.

export const DOCTOR_LANGUAGES = ['English', 'Arabic', 'French'];

export const DOCTOR_AREAS = [
  'Abdali',
  'Shmeisani',
  'Sweifieh',
  'Khalda',
  'Jabal Amman',
];

export const DOCTOR_GENDERS = ['Male', 'Female'];
