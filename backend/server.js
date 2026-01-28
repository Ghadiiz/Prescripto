import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectDB } from './src/config/mysql.js';
import { connectCloudinary } from './src/config/cloudinary.js';
import authRoutes from './src/auth/routes/authRoutes.js';
import doctorRoutes from './src/doctors/routes/doctorRoutes.js';

dotenv.config();

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

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}...`);
});
