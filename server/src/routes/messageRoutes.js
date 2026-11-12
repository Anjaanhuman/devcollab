import { Router } from 'express';
import { param } from 'express-validator';
import Message from '../models/Message.js';
import Project from '../models/Project.js';
import User from '../models/User.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validation.js';
import { pagination, paginationInfo, success } from '../utils/api.js';
import { isProjectMember } from '../utils/projectAccess.js';

const router = Router();
const conversationKey = (a, b) => [String(a), String(b)].sort().join(':');

router.get('/people', authenticate, async (req, res) => {
  const users = await User.find({ _id: { $ne: req.user._id }, suspendedAt: null }).select('fullName username avatarUrl lastSeenAt').sort({ fullName: 1 }).limit(100);
  return success(res, 'Message contacts loaded.', users);
});

router.get('/direct/:userId', authenticate, [param('userId').isMongoId()], validate, async (req, res) => {
  const recipient = await User.findOne({ _id: req.params.userId, suspendedAt: null }).select('_id');
  if (!recipient || String(recipient._id) === String(req.user._id)) return success(res, 'Conversation not found.', null, 404);
  const conversationId = conversationKey(req.user._id, recipient._id);
  const { page, limit, skip } = pagination(req);
  const [messages, total] = await Promise.all([
    Message.find({ conversationId }).populate('sender', 'username fullName avatarUrl').populate('recipient', 'username fullName avatarUrl').sort({ createdAt: -1 }).skip(skip).limit(limit),
    Message.countDocuments({ conversationId }),
  ]);
  await Message.updateMany({ conversationId, recipient: req.user._id, readBy: { $ne: req.user._id } }, { $addToSet: { readBy: req.user._id } });
  return success(res, 'Direct conversation loaded.', messages.reverse(), 200, { pagination: paginationInfo(page, limit, total) });
});

router.get('/project/:projectId', authenticate, [param('projectId').isMongoId()], validate, async (req, res) => {
  const project = await Project.findById(req.params.projectId).select('owner members moderationStatus');
  if (!project || project.moderationStatus !== 'visible' || !isProjectMember(project, req.user._id)) return success(res, 'Project channel not found.', null, 404);
  const { page, limit, skip } = pagination(req);
  const [messages, total] = await Promise.all([
    Message.find({ project: project._id }).populate('sender', 'username fullName avatarUrl').sort({ createdAt: -1 }).skip(skip).limit(limit),
    Message.countDocuments({ project: project._id }),
  ]);
  await Message.updateMany({ project: project._id, sender: { $ne: req.user._id }, readBy: { $ne: req.user._id } }, { $addToSet: { readBy: req.user._id } });
  return success(res, 'Project conversation loaded.', messages.reverse(), 200, { pagination: paginationInfo(page, limit, total) });
});

export { conversationKey };
export default router;
