import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { fileURLToPath } from 'node:url';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import healthRoutes from './routes/healthRoutes.js';
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import projectRoutes from './routes/projectRoutes.js';
import requestRoutes from './routes/requestRoutes.js';
import taskRoutes from './routes/taskRoutes.js';
import messageRoutes from './routes/messageRoutes.js';
import snippetRoutes from './routes/snippetRoutes.js';
import communityRoutes from './routes/communityRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import reportRoutes from './routes/reportRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import workspaceRoutes from './routes/workspaceRoutes.js';

const app = express();
const allowedOrigins = (process.env.CLIENT_ORIGIN || process.env.RENDER_EXTERNAL_URL || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(cookieParser());
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false, skip: (req) => /^\/workspaces\/[^/]+\/ports\/\d+\/proxy(?:\/|$)/.test(req.path) }));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 25, standardHeaders: 'draft-8', legacyHeaders: false }));
app.use('/api/health', healthRoutes);
app.use('/api', (req, res, next) => {
  if (mongoose.connection.readyState === 1) return next();
  return res.status(503).json({ success: false, message: 'Database is unavailable. Configure MONGODB_URI and restart the API.', data: null });
});
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/workspaces', workspaceRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/snippets', snippetRoutes);
app.use('/api/posts', communityRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/admin', adminRoutes);
if (process.env.NODE_ENV === 'production') {
  const clientBuildDirectory = fileURLToPath(new URL('../../client/dist/', import.meta.url));
  app.use(express.static(clientBuildDirectory, { index: false }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path === '/api' || req.path.startsWith('/api/')) return next();
    return res.sendFile('index.html', { root: clientBuildDirectory }, (error) => error && next(error));
  });
}
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
