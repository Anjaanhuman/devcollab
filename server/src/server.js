import 'dotenv/config';
import { createServer } from 'node:http';
import app from './app.js';
import { connectDatabase } from './config/database.js';
import { attachSocketServer } from './socket.js';

const port = Number.parseInt(process.env.PORT || '5000', 10);

try {
  await connectDatabase();
  const httpServer = createServer(app);
  const allowedOrigins = (process.env.CLIENT_ORIGIN || process.env.RENDER_EXTERNAL_URL || 'http://localhost:5173').split(',').map((origin) => origin.trim()).filter(Boolean);
  const io = attachSocketServer(httpServer, allowedOrigins);
  app.set('io', io);
  httpServer.listen(port, '0.0.0.0', () => console.info(`DEVCOLLAB API listening on port ${port}`));
} catch (error) {
  console.error('Could not connect to MongoDB; API startup stopped.', error.message);
  process.exitCode = 1;
}
