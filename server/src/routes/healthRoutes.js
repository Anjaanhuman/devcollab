import { Router } from 'express';
import mongoose from 'mongoose';

const router = Router();

router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'DEVCOLLAB API is running.',
    data: {
      status: 'ok',
      database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
    },
  });
});

export default router;
