import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

let connection;

const connectDB = async () => {
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT || 3306,
      ...(process.env.DB_SSL === 'true' && {
        ssl: { rejectUnauthorized: true },
      }),
    });

    console.log('MySQL Doctor Appointment Database Connected...');
  } catch (error) {
    console.error('MySQL Connection Error:', error.message);
    process.exit(1);
  }
};

const getDB = () => {
  if (!connection) {
    throw new Error('Database not initialized. Call connectDB() first.');
  }
  return connection;
};

export { connectDB, getDB };
