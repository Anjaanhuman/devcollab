import { Router } from 'express';
import { param } from 'express-validator';
import Notification from '../models/Notification.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validation.js';
import { pagination, paginationInfo, success } from '../utils/api.js';

const router = Router();

router.get('/', authenticate, async (req, res) => {
  const { page, limit, skip } = pagination(req);
  const filter = { recipient: req.user._id };
  if (req.query.unread === 'true') filter.readAt = null;
  const [notifications, total, unread] = await Promise.all([
    Notification.find(filter).populate('actor', 'username fullName avatarUrl').populate('project', 'title').sort({ createdAt: -1 }).skip(skip).limit(limit),
    Notification.countDocuments(filter),
    Notification.countDocuments({ recipient: req.user._id, readAt: null }),
  ]);
  return success(res, 'Notifications loaded.', notifications, 200, { pagination: paginationInfo(page, limit, total), unreadCount: unread });
});

router.put('/read-all', authenticate, async (req, res) => {
  const result = await Notification.updateMany({ recipient: req.user._id, readAt: null }, { $set: { readAt: new Date() } });
  return success(res, 'All notifications marked as read.', { modifiedCount: result.modifiedCount });
});

router.put('/:id/read', authenticate, [param('id').isMongoId()], validate, async (req, res) => {
  const notification = await Notification.findOneAndUpdate({ _id: req.params.id, recipient: req.user._id }, { $set: { readAt: new Date() } }, { new: true });
  if (!notification) return success(res, 'Notification not found.', null, 404);
  return success(res, 'Notification marked as read.', notification);
});

export default router;
