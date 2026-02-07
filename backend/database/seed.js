import mysql from 'mysql2/promise';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import { specialities, doctors, adminUser } from './seedData.js';

dotenv.config();

const seedDatabase = async () => {
  let connection;

  try {
    console.log('Connecting to database...');
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT || 3306,
    });
    console.log('Connected to database\n');

    console.log('Disabling foreign key checks...');
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');

    console.log('Clearing existing data...');
    await connection.query('DELETE FROM appointments');
    await connection.query('DELETE FROM doctors');
    await connection.query('DELETE FROM specialities');
    await connection.query('DELETE FROM users');
    console.log('Existing data cleared\n');

    await connection.query('SET FOREIGN_KEY_CHECKS = 1');

    console.log('Inserting admin user...');
    const hashedAdminPassword = await bcrypt.hash(adminUser.password, 10);
    await connection.query(
      `INSERT INTO users (name, email, password, role, is_verified) 
       VALUES (?, ?, ?, ?, ?)`,
      [adminUser.name, adminUser.email, hashedAdminPassword, 'admin', 1],
    );
    console.log(`Added admin: ${adminUser.email}\n`);

    console.log('Inserting specialities with fixed IDs...');
    const specialityIdMap = {
      'General physician': 7,
      Gynecologist: 8,
      Dermatologist: 9,
      Pediatricians: 10,
      Neurologist: 11,
      Gastroenterologist: 12,
    };

    for (const speciality of specialities) {
      const fixedId = specialityIdMap[speciality.name];
      await connection.query(
        'INSERT INTO specialities (id, name, image) VALUES (?, ?, ?)',
        [fixedId, speciality.name, speciality.image],
      );
      console.log(`Added: ${speciality.name} (ID: ${fixedId})`);
    }
    console.log(`Inserted ${specialities.length} specialities\n`);

    console.log('Fetching speciality IDs...');
    const [specialityRows] = await connection.query(
      'SELECT id, name FROM specialities',
    );
    const specialityMap = {};
    specialityRows.forEach((row) => {
      specialityMap[row.name] = row.id;
      console.log(`  ${row.name} → ID: ${row.id}`);
    });
    console.log('Speciality map created\n');

    console.log('Inserting doctors...');
    for (const doctor of doctors) {
      const hashedPassword = await bcrypt.hash(doctor.password, 10);
      const specialityId = specialityMap[doctor.speciality];

      await connection.query(
        `INSERT INTO doctors
        (name, email, password, image, speciality_id, degree, experience, about, fees, address_line1, address_line2, available, is_verified, verification_token, verification_token_expires)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          doctor.name,
          doctor.email,
          hashedPassword,
          doctor.image,
          specialityId,
          doctor.degree,
          doctor.experience,
          doctor.about,
          doctor.fees,
          doctor.address_line1,
          doctor.address_line2,
          doctor.available,
          1,
          null,
          null,
        ],
      );
      console.log(`Added: ${doctor.name} (${doctor.speciality})`);
    }
    console.log(`Inserted ${doctors.length} doctors\n`);

    console.log('DATABASE SEEDED SUCCESSFULLY!\n');
    console.log('═══════════════════════════════════');
    console.log('ADMIN LOGIN CREDENTIALS:');
    console.log('Email: admin@prescripto.com');
    console.log('Password: admin123');
    console.log('═══════════════════════════════════');
    console.log('DOCTOR LOGIN (any seeded doctor):');
    console.log('Email: richard@example.com');
    console.log('Password: doctor123');
    console.log('═══════════════════════════════════\n');
  } catch (error) {
    console.error('Seeding error:', error.message);
    console.error('Full error:', error);
  } finally {
    if (connection) {
      await connection.end();
      console.log('Database connection closed');
    }
    process.exit();
  }
};

seedDatabase();
