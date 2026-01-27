const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { connectCloudinary } = require('./config/cloudinary');
const { connectDB } = require('./config/mysql');
const doctorRoutes = require('./routes/doctorRoutes');

const app = express();

const PORT = process.env.PORT || 3000;

connectCloudinary();
connectDB();

app.use(express.json());
app.use(cors());

app.get('/', (req, res) => {
  res.json({ message: 'API is working' });
});

app.use('/api/doctors', doctorRoutes);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}...`);
});
