import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

let connection;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const connectDB = async (retries = 10, delayMs = 5000) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: process.env.DB_PORT || 3306,
        ...(process.env.DB_SSL === 'true' && {
          ssl: { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' },
        }),
      });

      console.log('MySQL Doctor Appointment Database Connected...');
      return;
    } catch (error) {
      console.error(
        `MySQL Connection Error (attempt ${attempt}/${retries}): ${error.message}`,
      );
      if (attempt === retries) {
        console.error('Could not connect to MySQL after multiple attempts. Exiting.');
        process.exit(1);
      }
      await sleep(delayMs);
    }
  }
};

const getDB = () => {
  if (!connection) {
    throw new Error('Database not initialized. Call connectDB() first.');
  }
  return connection;
};

export { connectDB, getDB };
