import { Router } from 'express';
import { body } from 'express-validator';
import Project from '../models/Project.js';
import Post from '../models/Post.js';
import Report from '../models/Report.js';
import Snippet from '../models/Snippet.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validation.js';
import { success } from '../utils/api.js';

const router = Router();
const models = { Project, Post, Snippet };

router.post('/', authenticate, [body('targetType').isIn(['Project', 'Post', 'Snippet']), body('target').isMongoId(), body('reason').trim().isLength({ min: 5, max: 1000 })], validate, async (req, res) => {
  const Model = models[req.body.targetType];
  const target = await Model.findById(req.body.target).select('_id');
  if (!target) return success(res, 'Reported content not found.', null, 404);
  const existing = await Report.findOne({ targetType: req.body.targetType, target: target._id, reporter: req.user._id });
  if (existing) return success(res, 'You have already reported this item.', existing, 409);
  const report = await Report.create({ targetType: req.body.targetType, target: target._id, reporter: req.user._id, reason: req.body.reason });
  return success(res, 'Report submitted for review.', report, 201);
});

export default router;
