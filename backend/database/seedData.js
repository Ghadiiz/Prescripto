// DEMO DATA — not real records.
//
// Every doctor below is fictional: invented names, invented addresses, a
// shared throwaway password, and stock portraits. The addresses are real
// Amman districts and street names, but the practices at them do not exist.
// Do not treat anything in this file as a real person or a real clinic, and
// never run the seed script against production — it deletes every row first.
//
// `languages` is comma-separated with no spaces, matching the FIND_IN_SET
// convention that migration 002 documents; `area` must stay consistent with
// the district named in `address_line2`.

const specialities = [
  {
    name: 'General physician',
    image:
      'https://res.cloudinary.com/dz0nxuide/image/upload/v1769443159/General_physician_y8pks1.svg',
  },
  {
    name: 'Gynecologist',
    image:
      'https://res.cloudinary.com/dz0nxuide/image/upload/v1769443160/Gynecologist_s1ffsm.svg',
  },
  {
    name: 'Dermatologist',
    image:
      'https://res.cloudinary.com/dz0nxuide/image/upload/v1769443157/Dermatologist_gvtvjm.svg',
  },
  {
    name: 'Pediatricians',
    image:
      'https://res.cloudinary.com/dz0nxuide/image/upload/v1769443162/Pediatricians_hic5pp.svg',
  },
  {
    name: 'Neurologist',
    image:
      'https://res.cloudinary.com/dz0nxuide/image/upload/v1769443161/Neurologist_pkorxz.svg',
  },
  {
    name: 'Gastroenterologist',
    image:
      'https://res.cloudinary.com/dz0nxuide/image/upload/v1769443158/Gastroenterologist_fcairw.svg',
  },
];

const adminUser = {
  name: 'Admin User',
  email: 'admin@prescripto.com',
  password: 'admin123',
};

// Placeholder bio shared by every seeded doctor. Kept verbatim from the
// original seed data — one literal instead of sixteen copies.
const ABOUT =
  'Dr. Davis has a strong commitment to delivering comprehensive medical care, focusing on preventive medicine, early diagnosis, and effective treatment strategies. Dr. Davis has a strong commitment to delivering comprehensive medical care, focusing on preventive medicine, early diagnosis, and effective treatment strategies.';

const ABOUT_JACK =
  'Dr. Jack has a strong commitment to delivering comprehensive medical care, focusing on preventive medicine, early diagnosis, and effective treatment strategies. Dr. Davis has a strong commitment to delivering comprehensive medical care, focusing on preventive medicine, early diagnosis, and effective treatment strategies.';

const doctors = [
  {
    name: 'Dr. Richard James',
    email: 'richard@example.com',
    password: 'doctor123',
    image:
      'https://res.cloudinary.com/dz0nxuide/image/upload/v1769443081/doc1_fmmbw9.png',
    speciality: 'General physician',
    degree: 'MBBS',
    experience: '4 Years',
    experience_years: 4,
    languages: 'English,Arabic',
    gender: 'Male',
    about: ABOUT,
    fees: 50,
    address_line1: 'Building 12, Al-Shareef Nasser Ben Jamil St',
    address_line2: 'Abdali, Amman',
    area: 'Abdali',
    available: true,
  },
  {
    name: 'Dr. Emily Larson',
    email: 'emily@example.com',
    password: 'doctor123',
    image:
      'https://res.cloudinary.com/dz0nxuide/image/upload/v1769443081/doc2_wrwrvd.png',
    speciality: 'Gynecologist',
    degree: 'MBBS',
    experience: '3 Years',
    experience_years: 3,
    languages: 'English,Arabic,French',
    gender: 'Female',
    about: ABOUT,
    fees: 60,
    address_line1: 'Building 8, Abdul Hameed Sharaf St',
    address_line2: 'Shmeisani, Amman',
    area: 'Shmeisani',
    available: true,
  },
  {
    name: 'Dr. Sarah Patel',
    email: 'sarah@example.com',
    password: 'doctor123',
    image:
      'https://res.cloudinary.com/dz0nxuide/image/upload/v1769443082/doc3_mzeohx.png',
    speciality: 'Dermatologist',
    degree: 'MBBS',
    experience: '1 Years',
    experience_years: 1,
    languages: 'English,Arabic',
    gender: 'Female',
    about: ABOUT,
    fees: 30,
    address_line1: 'Building 24, Al-Wakalat St',
    address_line2: 'Sweifieh, Amman',
    area: 'Sweifieh',
    available: true,
  },
  {
    name: 'Dr. Christopher Lee',
    email: 'christopher@example.com',
    password: 'doctor123',
    image:
      'https://res.cloudinary.com/dz0nxuide/image/upload/v1769443082/doc4_v1zjik.png',
    speciality: 'Pediatricians',
    degree: 'MBBS',
    experience: '2 Years',
    experience_years: 2,
    languages: 'English',
    gender: 'Male',
    about: ABOUT,
    fees: 40,
    address_line1: 'Building 5, Wasfi Al-Tal St',
    address_line2: 'Khalda, Amman',
    area: 'Khalda',
    available: true,
  },
  {
    name: 'Dr. Jennifer Garcia',
    email: 'jennifer@example.com',
    password: 'doctor123',
    image:
      'https://res.cloudinary.com/dz0nxuide/image/upload/v1769443083/doc5_f80ujr.png',
    speciality: 'Neurologist',
    degree: 'MBBS',
    experience: '4 Years',
    experience_years: 4,
    languages: 'English,Arabic',
    gender: 'Female',
    about: ABOUT,
    fees: 50,
    address_line1: 'Building 31, Rainbow St',
    address_line2: 'Jabal Amman, Amman',
    area: 'Jabal Amman',
    available: true,
  },
  {
    name: 'Dr. Andrew Williams',
    email: 'andrew@example.com',
    password: 'doctor123',
    image:
      'https://res.cloudinary.com/dz0nxuide/image/upload/v1769443084/doc6_symo4a.png',
    speciality: 'Neurologist',
    degree: 'MBBS',
    experience: '4 Years',
    experience_years: 4,
    languages: 'Arabic',
    gender: 'Male',
    about: ABOUT,
    fees: 50,
    address_line1: 'Building 40, Sulayman Al-Nabulsi St',
    address_line2: 'Abdali, Amman',
    area: 'Abdali',
    available: true,
  },
  {
    name: 'Dr. Christopher Davis',
    email: 'chrisdavis@example.com',
    password: 'doctor123',
    image:
      'https://res.cloudinary.com/dz0nxuide/image/upload/v1769443085/doc7_uocoyu.png',
    speciality: 'General physician',
    degree: 'MBBS',
    experience: '4 Years',
    experience_years: 4,
    languages: 'English,Arabic',
    gender: 'Male',
    about: ABOUT,
    fees: 50,
    address_line1: 'Building 17, Queen Noor St',
    address_line2: 'Shmeisani, Amman',
    area: 'Shmeisani',
    available: true,
  },
  {
    name: 'Dr. Timothy White',
    email: 'timothy@example.com',
    password: 'doctor123',
    image:
      'https://res.cloudinary.com/dz0nxuide/image/upload/v1769443087/doc8_sc1jhu.png',
    speciality: 'Gynecologist',
    degree: 'MBBS',
    experience: '3 Years',
    experience_years: 3,
    languages: 'English,Arabic',
    gender: 'Male',
    about: ABOUT,
    fees: 60,
    address_line1: 'Building 3, Ali Nasouh Al-Taher St',
    address_line2: 'Sweifieh, Amman',
    area: 'Sweifieh',
    available: true,
  },
  {
    name: 'Dr. Ava Mitchell',
    email: 'ava@example.com',
    password: 'doctor123',
    image:
      'https://res.cloudinary.com/dz0nxuide/image/upload/v1769443088/doc9_xz3ooq.png',
    speciality: 'Dermatologist',
    degree: 'MBBS',
    experience: '1 Years',
    experience_years: 1,
    languages: 'Arabic',
    gender: 'Female',
    about: ABOUT,
    fees: 30,
    address_line1: 'Building 19, Iyad Bin Ghanem St',
    address_line2: 'Khalda, Amman',
    area: 'Khalda',
    available: true,
  },
  {
    name: 'Dr. Jeffrey King',
    email: 'jeffrey@example.com',
    password: 'doctor123',
    image:
      'https://res.cloudinary.com/dz0nxuide/image/upload/v1769443088/doc10_rezcke.png',
    speciality: 'Pediatricians',
    degree: 'MBBS',
    experience: '2 Years',
    experience_years: 2,
    languages: 'English,Arabic',
    gender: 'Male',
    about: ABOUT,
    fees: 40,
    address_line1: 'Building 22, Zahran St',
    address_line2: 'Jabal Amman, Amman',
    area: 'Jabal Amman',
    available: true,
  },
  {
    name: 'Dr. Zoe Kelly',
    email: 'zoe@example.com',
    password: 'doctor123',
    image:
      'https://res.cloudinary.com/dz0nxuide/image/upload/v1769443089/doc11_dd4hnd.png',
    speciality: 'Neurologist',
    degree: 'MBBS',
    experience: '4 Years',
    experience_years: 4,
    languages: 'English,Arabic,French',
    gender: 'Female',
    about: ABOUT,
    fees: 50,
    address_line1: 'Building 6, Al-Istethmar St',
    address_line2: 'Abdali, Amman',
    area: 'Abdali',
    available: true,
  },
  {
    name: 'Dr. Patrick Harris',
    email: 'patrick@example.com',
    password: 'doctor123',
    image:
      'https://res.cloudinary.com/dz0nxuide/image/upload/v1769443091/doc12_mme0qx.png',
    speciality: 'Neurologist',
    degree: 'MBBS',
    experience: '4 Years',
    experience_years: 4,
    languages: 'Arabic',
    gender: 'Male',
    about: ABOUT,
    fees: 50,
    address_line1: 'Building 14, Ishaq Al-Qatoub St',
    address_line2: 'Shmeisani, Amman',
    area: 'Shmeisani',
    available: true,
  },
  {
    name: 'Dr. Chloe Evans',
    email: 'chloe@example.com',
    password: 'doctor123',
    image:
      'https://res.cloudinary.com/dz0nxuide/image/upload/v1769443092/doc13_nwcdau.png',
    speciality: 'General physician',
    degree: 'MBBS',
    experience: '4 Years',
    experience_years: 4,
    languages: 'English,Arabic',
    gender: 'Female',
    about: ABOUT,
    fees: 50,
    address_line1: 'Building 27, Abdul Rahim Al-Haj Mohammad St',
    address_line2: 'Sweifieh, Amman',
    area: 'Sweifieh',
    available: true,
  },
  {
    name: 'Dr. Ryan Martinez',
    email: 'ryan@example.com',
    password: 'doctor123',
    image:
      'https://res.cloudinary.com/dz0nxuide/image/upload/v1769443093/doc14_eqs5ij.png',
    speciality: 'Gynecologist',
    degree: 'MBBS',
    experience: '3 Years',
    experience_years: 3,
    languages: 'English,Arabic',
    gender: 'Male',
    about: ABOUT,
    fees: 60,
    address_line1: 'Building 9, Khalil Al-Sakakini St',
    address_line2: 'Khalda, Amman',
    area: 'Khalda',
    available: true,
  },
  {
    name: 'Dr. Amelia Hill',
    email: 'amelia@example.com',
    password: 'doctor123',
    image:
      'https://res.cloudinary.com/dz0nxuide/image/upload/v1769443099/doc15_fbzdj9.png',
    speciality: 'Dermatologist',
    degree: 'MBBS',
    experience: '1 Years',
    experience_years: 1,
    languages: 'English',
    gender: 'Female',
    about: ABOUT,
    fees: 30,
    address_line1: 'Building 2, Fawzi Al-Qawuqji St',
    address_line2: 'Jabal Amman, Amman',
    area: 'Jabal Amman',
    available: true,
  },
  {
    name: 'Dr. Jack Hill',
    email: 'jack@example.com',
    password: 'doctor123',
    image:
      'https://res.cloudinary.com/dz0nxuide/image/upload/v1769443100/doc16_rgde2x.webp',
    speciality: 'Gastroenterologist',
    degree: 'MBBS',
    experience: '1 Years',
    experience_years: 1,
    languages: 'English,Arabic',
    gender: 'Male',
    about: ABOUT_JACK,
    fees: 30,
    address_line1: 'Building 33, King Hussein Business Park',
    address_line2: 'Abdali, Amman',
    area: 'Abdali',
    available: true,
  },
];

export { specialities, doctors, adminUser };
