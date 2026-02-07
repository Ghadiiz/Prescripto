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
    about:
      'Dr. Davis has a strong commitment to delivering comprehensive medical care, focusing on preventive medicine, early diagnosis, and effective treatment strategies. Dr. Davis has a strong commitment to delivering comprehensive medical care, focusing on preventive medicine, early diagnosis, and effective treatment strategies.',
    fees: 50,
    address_line1: '17th Cross, Richmond',
    address_line2: 'Circle, Ring Road, London',
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
    about:
      'Dr. Davis has a strong commitment to delivering comprehensive medical care, focusing on preventive medicine, early diagnosis, and effective treatment strategies. Dr. Davis has a strong commitment to delivering comprehensive medical care, focusing on preventive medicine, early diagnosis, and effective treatment strategies.',
    fees: 60,
    address_line1: '27th Cross, Richmond',
    address_line2: 'Circle, Ring Road, London',
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
    about:
      'Dr. Davis has a strong commitment to delivering comprehensive medical care, focusing on preventive medicine, early diagnosis, and effective treatment strategies. Dr. Davis has a strong commitment to delivering comprehensive medical care, focusing on preventive medicine, early diagnosis, and effective treatment strategies.',
    fees: 30,
    address_line1: '37th Cross, Richmond',
    address_line2: 'Circle, Ring Road, London',
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
    about:
      'Dr. Davis has a strong commitment to delivering comprehensive medical care, focusing on preventive medicine, early diagnosis, and effective treatment strategies. Dr. Davis has a strong commitment to delivering comprehensive medical care, focusing on preventive medicine, early diagnosis, and effective treatment strategies.',
    fees: 40,
    address_line1: '47th Cross, Richmond',
    address_line2: 'Circle, Ring Road, London',
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
    about:
      'Dr. Davis has a strong commitment to delivering comprehensive medical care, focusing on preventive medicine, early diagnosis, and effective treatment strategies. Dr. Davis has a strong commitment to delivering comprehensive medical care, focusing on preventive medicine, early diagnosis, and effective treatment strategies.',
    fees: 50,
    address_line1: '57th Cross, Richmond',
    address_line2: 'Circle, Ring Road, London',
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
    about:
      'Dr. Davis has a strong commitment to delivering comprehensive medical care, focusing on preventive medicine, early diagnosis, and effective treatment strategies. Dr. Davis has a strong commitment to delivering comprehensive medical care, focusing on preventive medicine, early diagnosis, and effective treatment strategies.',
    fees: 50,
    address_line1: '57th Cross, Richmond',
    address_line2: 'Circle, Ring Road, London',
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
    about:
      'Dr. Davis has a strong commitment to delivering comprehensive medical care, focusing on preventive medicine, early diagnosis, and effective treatment strategies. Dr. Davis has a strong commitment to delivering comprehensive medical care, focusing on preventive medicine, early diagnosis, and effective treatment strategies.',
    fees: 50,
    address_line1: '17th Cross, Richmond',
    address_line2: 'Circle, Ring Road, London',
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
    about:
      'Dr. Davis has a strong commitment to delivering comprehensive medical care, focusing on preventive medicine, early diagnosis, and effective treatment strategies. Dr. Davis has a strong commitment to delivering comprehensive medical care, focusing on preventive medicine, early diagnosis, and effective treatment strategies.',
    fees: 60,
    address_line1: '27th Cross, Richmond',
    address_line2: 'Circle, Ring Road, London',
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
    about:
      'Dr. Davis has a strong commitment to delivering comprehensive medical care, focusing on preventive medicine, early diagnosis, and effective treatment strategies. Dr. Davis has a strong commitment to delivering comprehensive medical care, focusing on preventive medicine, early diagnosis, and effective treatment strategies.',
    fees: 30,
    address_line1: '37th Cross, Richmond',
    address_line2: 'Circle, Ring Road, London',
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
    about:
      'Dr. Davis has a strong commitment to delivering comprehensive medical care, focusing on preventive medicine, early diagnosis, and effective treatment strategies. Dr. Davis has a strong commitment to delivering comprehensive medical care, focusing on preventive medicine, early diagnosis, and effective treatment strategies.',
    fees: 40,
    address_line1: '47th Cross, Richmond',
    address_line2: 'Circle, Ring Road, London',
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
    about:
      'Dr. Davis has a strong commitment to delivering comprehensive medical care, focusing on preventive medicine, early diagnosis, and effective treatment strategies. Dr. Davis has a strong commitment to delivering comprehensive medical care, focusing on preventive medicine, early diagnosis, and effective treatment strategies.',
    fees: 50,
    address_line1: '57th Cross, Richmond',
    address_line2: 'Circle, Ring Road, London',
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
    about:
      'Dr. Davis has a strong commitment to delivering comprehensive medical care, focusing on preventive medicine, early diagnosis, and effective treatment strategies. Dr. Davis has a strong commitment to delivering comprehensive medical care, focusing on preventive medicine, early diagnosis, and effective treatment strategies.',
    fees: 50,
    address_line1: '57th Cross, Richmond',
    address_line2: 'Circle, Ring Road, London',
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
    about:
      'Dr. Davis has a strong commitment to delivering comprehensive medical care, focusing on preventive medicine, early diagnosis, and effective treatment strategies. Dr. Davis has a strong commitment to delivering comprehensive medical care, focusing on preventive medicine, early diagnosis, and effective treatment strategies.',
    fees: 50,
    address_line1: '17th Cross, Richmond',
    address_line2: 'Circle, Ring Road, London',
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
    about:
      'Dr. Davis has a strong commitment to delivering comprehensive medical care, focusing on preventive medicine, early diagnosis, and effective treatment strategies. Dr. Davis has a strong commitment to delivering comprehensive medical care, focusing on preventive medicine, early diagnosis, and effective treatment strategies.',
    fees: 60,
    address_line1: '27th Cross, Richmond',
    address_line2: 'Circle, Ring Road, London',
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
    about:
      'Dr. Davis has a strong commitment to delivering comprehensive medical care, focusing on preventive medicine, early diagnosis, and effective treatment strategies. Dr. Davis has a strong commitment to delivering comprehensive medical care, focusing on preventive medicine, early diagnosis, and effective treatment strategies.',
    fees: 30,
    address_line1: '37th Cross, Richmond',
    address_line2: 'Circle, Ring Road, London',
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
    about:
      'Dr. Jack has a strong commitment to delivering comprehensive medical care, focusing on preventive medicine, early diagnosis, and effective treatment strategies. Dr. Davis has a strong commitment to delivering comprehensive medical care, focusing on preventive medicine, early diagnosis, and effective treatment strategies.',
    fees: 30,
    address_line1: '37th Cross, Richmond',
    address_line2: 'Circle, Ring Road, London',
    available: true,
  },
];

export { specialities, doctors, adminUser };
