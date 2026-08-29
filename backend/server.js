import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectDB } from './src/config/mysql.js';
import { closeRedis } from './src/config/redis.js';
import { createWaitlistWorker, closeWaitlistWorker } from './src/queue/waitlistWorker.js';
import { closeWaitlistQueue } from './src/queue/waitlistQueue.js';
import { connectCloudinary } from './src/config/cloudinary.js';
import { API_ROUTES } from './src/routes.js';
import { mountApiDocs } from './src/docs/serveDocs.js';
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

// ABOVE the readiness gate, deliberately (6.3).
//
// The docs are a static document and touch no database. Mounted below the gate
// they would answer 503 for the whole cold-boot window -- up to ~50 seconds on
// Render while a sleeping managed database wakes -- which is exactly when
// someone is most likely to be loading them to check whether the API is alive.
mountApiDocs(app);

// Everything below needs the database. connectDB() above is intentionally not
// awaited so the port binds immediately; this gate covers the window until it
// resolves, answering 503 instead of letting getDB() throw into a 500.
app.use('/api', databaseReady);

// Mounted from the shared table in src/routes.js, which the documentation
// coverage test also walks -- so a router added here is a router that test
// checks for documentation.
for (const { prefix, router } of API_ROUTES) {
  app.use(prefix, router);
}

app.use(notFound);
app.use(errorHandler);

const server = app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}...`);
});

// The waitlist worker runs IN THIS PROCESS (6.2).
//
// Not a design preference — Render's Background Workers are a paid service
// type and this project is on the free tier, which offers web services only.
// The worker is also a standalone entry point (`npm run worker`), so moving it
// to a real background service later is a start command rather than a rewrite.
//
// The limitation worth knowing: a free Render web service SPINS DOWN when
// idle, and a spun-down process works no queue. Jobs wait in Redis until the
// next request wakes the service. For this job that is a delayed badge, not a
// lost notification — which is still strictly better than 5.4, where a failed
// notification was gone for good.
//
// Returns null with no REDIS_URL, and the notifier falls back to notifying
// inline, so nothing here is required for the app to work.
const waitlistWorker = createWaitlistWorker();

if (waitlistWorker) {
  console.log('Waitlist notification worker started in-process.');
}

// The server had no shutdown handling before 6.2. It needs some now: a worker
// killed mid-job leaves that job stalled until BullMQ's lock expires, where
// closing it cleanly returns the job to the queue immediately.
const shutdown = async (signal) => {
  console.log(`${signal} received, shutting down...`);

  server.close();

  try {
    await closeWaitlistWorker(waitlistWorker);
    await closeWaitlistQueue();
    await closeRedis();
  } catch (error) {
    console.error(`Error during shutdown: ${error.message}`);
  }

  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
