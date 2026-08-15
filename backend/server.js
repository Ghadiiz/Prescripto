import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectDB } from './src/config/mysql.js';
import { connectCloudinary } from './src/config/cloudinary.js';
import authRoutes from './src/auth/routes/authRoutes.js';
import doctorRoutes from './src/doctors/routes/doctorRoutes.js';
import appointmentRoutes from './src/appointments/routes/appointmentRoutes.js';
import adminRoutes from './src/admin/routes/adminRoutes.js';
import doctorPanelsRoutes from './src/doctors/routes/doctorPanelRoutes.js';
import { notFound, errorHandler } from './src/middleware/errorHandler.js';
import { databaseReady } from './src/middleware/databaseReady.js';
import { AppError } from './src/utils/AppError.js';

dotenv.config();

const REQUIRED_ENV_VARS = ['JWT_SECRET', 'DB_HOST', 'DB_USER', 'DB_NAME'];
const missingEnvVars = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);

if (missingEnvVars.length > 0) {
  console.error(`FATAL: Missing required environment variables: ${missingEnvVars.join(', ')}`);
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

const allowedOrigins = (
  process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:5174'
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new AppError('Not allowed by CORS', 403));
    },
  }),
);
app.use(express.json());

connectDB();
connectCloudinary();

// Not gated by databaseReady: this is what platform port detection and uptime
// pings hit, and it touches no database, so it answers as soon as we listen.
app.get('/', (req, res) => {
  res.send('Prescripto API is running...');
});

// Everything below needs the database. connectDB() above is intentionally not
// awaited so the port binds immediately; this gate covers the window until it
// resolves, answering 503 instead of letting getDB() throw into a 500.
app.use('/api', databaseReady);

app.use('/api/auth', authRoutes);
app.use('/api/doctors', doctorRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/doctor', doctorPanelsRoutes);

app.use(notFound);
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}...`);
});
