import mysql from 'mysql2/promise';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import { specialities, doctors } from './seedData.js';

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

    console.log('Clearing existing data...');
    await connection.query('DELETE FROM appointments');
    await connection.query('DELETE FROM doctors');
    await connection.query('DELETE FROM specialities');
    await connection.query('DELETE FROM users');
    console.log('Existing data cleared\n');

    console.log('Inserting specialities...');
    for (const speciality of specialities) {
      await connection.query(
        'INSERT INTO specialities (name, image) VALUES (?, ?)',
        [speciality.name, speciality.image],
      );
      console.log(`Added: ${speciality.name}`);
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
        (name, email, password, image, speciality_id, degree, experience, about, fees, address_line1, address_line2, available)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        ],
      );
      console.log(`Added: ${doctor.name} (${doctor.speciality})`);
    }
    console.log(`Inserted ${doctors.length} doctors\n`);

    console.log('DATABASE SEEDED SUCCESSFULLY!\n');
  } catch (error) {
    console.error('Seeding error:', error.message);
  } finally {
    if (connection) {
      await connection.end();
      console.log('Database connection closed');
    }
    process.exit();
  }
};

seedDatabase();
