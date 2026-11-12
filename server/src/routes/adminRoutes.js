import { Router } from 'express';
import { body, param } from 'express-validator';
import CollaborationRequest from '../models/CollaborationRequest.js';
import Comment from '../models/Comment.js';
import Notification from '../models/Notification.js';
import Post from '../models/Post.js';
import Project from '../models/Project.js';
import Report from '../models/Report.js';
import Snippet from '../models/Snippet.js';
import Task from '../models/Task.js';
import User from '../models/User.js';
import { cleanupProject } from '../services/projectCleanup.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validation.js';
import { pagination, paginationInfo, success } from '../utils/api.js';

const router = Router();
router.use(authenticate, requireRole('admin'));

router.get('/stats', async (req, res) => {
  const [users, activeUsers, suspendedUsers, projects, activeProjects, tasks, posts, snippets, openReports, pendingRequests] = await Promise.all([
    User.countDocuments(), User.countDocuments({ suspendedAt: null }), User.countDocuments({ suspendedAt: { $ne: null } }),
    Project.countDocuments(), Project.countDocuments({ status: 'Active' }), Task.countDocuments(), Post.countDocuments(), Snippet.countDocuments(),
    Report.countDocuments({ status: 'open' }), CollaborationRequest.countDocuments({ status: 'pending' }),
  ]);
  return success(res, 'Platform metrics loaded.', { users, activeUsers, suspendedUsers, projects, activeProjects, tasks, posts, snippets, openReports, pendingRequests });
});

router.get('/users', async (req, res) => {
  const { page, limit, skip } = pagination(req);
  const filter = {};
  if (req.query.status === 'suspended') filter.suspendedAt = { $ne: null };
  else if (req.query.status === 'active') filter.suspendedAt = null;
  const [users, total] = await Promise.all([User.find(filter).select('fullName username email role suspendedAt createdAt').sort({ createdAt: -1 }).skip(skip).limit(limit), User.countDocuments(filter)]);
  return success(res, 'User management list loaded.', users, 200, { pagination: paginationInfo(page, limit, total) });
});

router.put('/users/:id/suspension', [param('id').isMongoId(), body('suspended').isBoolean()], validate, async (req, res) => {
  if (String(req.params.id) === String(req.user._id)) return success(res, 'You cannot suspend your own admin account.', null, 409);
  const user = await User.findById(req.params.id).select('+sessionVersion');
  if (!user) return success(res, 'User not found.', null, 404);
  if (user.role === 'admin') return success(res, 'Admin accounts cannot be suspended through this endpoint.', null, 409);
  user.suspendedAt = req.body.suspended ? (user.suspendedAt || new Date()) : null;
  user.sessionVersion += 1;
  await user.save();
  if (req.body.suspended) req.app.get('io')?.in(`user:${user._id}`).disconnectSockets(true);
  return success(res, req.body.suspended ? 'User suspended.' : 'User restored.', { id: user._id, username: user.username, suspendedAt: user.suspendedAt });
});

router.get('/projects', async (req, res) => {
  const { page, limit, skip } = pagination(req);
  const [projects, total] = await Promise.all([Project.find().populate('owner', 'username fullName').sort({ createdAt: -1 }).skip(skip).limit(limit), Project.countDocuments()]);
  return success(res, 'Project moderation list loaded.', projects, 200, { pagination: paginationInfo(page, limit, total) });
});

router.put('/projects/:id/moderation', [param('id').isMongoId(), body('moderationStatus').isIn(['visible', 'hidden'])], validate, async (req, res) => {
  const project = await Project.findByIdAndUpdate(req.params.id, { $set: { moderationStatus: req.body.moderationStatus } }, { new: true, runValidators: true });
  if (!project) return success(res, 'Project not found.', null, 404);
  if (req.body.moderationStatus === 'hidden') req.app.get('io')?.in(`project:${project._id}`).socketsLeave(`project:${project._id}`);
  return success(res, `Project ${req.body.moderationStatus === 'hidden' ? 'hidden' : 'restored'}.`, project);
});

router.get('/reports', async (req, res) => {
  const { page, limit, skip } = pagination(req);
  const filter = req.query.status && ['open', 'reviewed', 'dismissed'].includes(req.query.status) ? { status: req.query.status } : {};
  const [reports, total] = await Promise.all([Report.find(filter).populate('reporter', 'username fullName').populate('target').sort({ createdAt: -1 }).skip(skip).limit(limit), Report.countDocuments(filter)]);
  return success(res, 'Reported content loaded.', reports, 200, { pagination: paginationInfo(page, limit, total) });
});

router.put('/reports/:id', [param('id').isMongoId(), body('status').isIn(['reviewed', 'dismissed'])], validate, async (req, res) => {
  const report = await Report.findByIdAndUpdate(req.params.id, { $set: { status: req.body.status, reviewedBy: req.user._id, reviewedAt: new Date() } }, { new: true, runValidators: true }).populate('reporter', 'username fullName').populate('target');
  if (!report) return success(res, 'Report not found.', null, 404);
  if (req.body.status === 'reviewed') {
    const target = await (report.targetType === 'Project' ? Project : report.targetType === 'Post' ? Post : Snippet).findById(report.target._id);
    if (target && 'moderationStatus' in target) {
      target.moderationStatus = 'hidden';
      await target.save();
      if (report.targetType === 'Project') req.app.get('io')?.in(`project:${target._id}`).socketsLeave(`project:${target._id}`);
    }
    if (report.targetType === 'Snippet') await Snippet.findByIdAndDelete(report.target._id);
    if (report.targetType === 'Post') await Promise.all([Comment.deleteMany({ post: report.target._id }), Notification.deleteMany({ post: report.target._id })]);
    if (report.targetType === 'Project') await cleanupProject(report.target._id);
  }
  return success(res, 'Report updated.', report);
});

export default router;
