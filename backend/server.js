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

dotenv.config();

const REQUIRED_ENV_VARS = ['JWT_SECRET', 'DB_HOST', 'DB_USER', 'DB_NAME'];
const missingEnvVars = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);

if (missingEnvVars.length > 0) {
  console.error(`FATAL: Missing required environment variables: ${missingEnvVars.join(', ')}`);
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

connectDB();
connectCloudinary();

app.get('/', (req, res) => {
  res.send('Prescripto API is running...');
});

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
