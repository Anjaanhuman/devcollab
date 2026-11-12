import { Router } from 'express';
import CollaborationRequest from '../models/CollaborationRequest.js';
import Message from '../models/Message.js';
import Notification from '../models/Notification.js';
import Project from '../models/Project.js';
import Task from '../models/Task.js';
import { authenticate } from '../middleware/auth.js';
import { success } from '../utils/api.js';

const router = Router();

router.get('/', authenticate, async (req, res) => {
  const userId = req.user._id;
  const [memberProjectIds, managedProjectIds] = await Promise.all([
    Project.find({ $or: [{ owner: userId }, { 'members.user': userId }] }).distinct('_id'),
    Project.find({ $or: [{ owner: userId }, { members: { $elemMatch: { user: userId, role: 'Team Leader' } } }] }).distinct('_id'),
  ]);
  const [createdProjects, joinedProjects, activeProjects, completedProjects, createdTasks, assignedTasks, taskStatuses, unreadNotifications, pendingRequests] = await Promise.all([
    Project.countDocuments({ owner: userId }),
    Project.countDocuments({ 'members.user': userId, owner: { $ne: userId } }),
    Project.countDocuments({ $or: [{ owner: userId }, { 'members.user': userId }], status: 'Active' }),
    Project.countDocuments({ $or: [{ owner: userId }, { 'members.user': userId }], status: 'Completed' }),
    Task.countDocuments({ createdBy: userId }),
    Task.countDocuments({ assignedTo: userId }),
    Task.aggregate([
      { $match: { $or: [{ createdBy: userId }, { assignedTo: userId }] } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Notification.countDocuments({ recipient: userId, readAt: null }),
    CollaborationRequest.countDocuments({ status: 'pending', project: { $in: managedProjectIds } }),
  ]);
  const completedTasks = taskStatuses.find((entry) => entry._id === 'Completed')?.count || 0;
  const totalTasks = taskStatuses.reduce((sum, entry) => sum + entry.count, 0);
  const tasks = await Task.find({ $or: [{ createdBy: userId }, { assignedTo: userId }] }).populate('project', 'title').sort({ updatedAt: -1 }).limit(6).select('title status updatedAt project');
  const projects = await Project.find({ $or: [{ owner: userId }, { 'members.user': userId }] }).sort({ updatedAt: -1 }).limit(6).select('title status updatedAt');
  const recentActivity = [
    ...tasks.map((task) => ({ id: String(task._id), kind: 'task', title: task.title, detail: `${task.status}${task.project?.title ? ` · ${task.project.title}` : ''}`, at: task.updatedAt })),
    ...projects.map((project) => ({ id: String(project._id), kind: 'project', title: project.title, detail: `Project · ${project.status}`, at: project.updatedAt })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 8);
  const unreadFilter = { sender: { $ne: userId }, readBy: { $ne: userId }, $or: [{ recipient: userId }, { project: { $in: memberProjectIds } }] };
  const [unreadMessages, unreadMessagePreview] = await Promise.all([
    Message.countDocuments(unreadFilter),
    Message.find(unreadFilter).populate('sender', 'username fullName avatarUrl').populate('project', 'title').sort({ createdAt: -1 }).limit(5).select('sender project body createdAt'),
  ]);
  return success(res, 'Dashboard loaded.', {
    metrics: { createdProjects, joinedProjects, activeProjects, completedProjects, createdTasks, assignedTasks, completedTasks, pendingTasks: totalTasks - completedTasks, completionPercent: totalTasks ? Math.round(completedTasks / totalTasks * 100) : 0, unreadNotifications, unreadMessages, pendingRequests },
    recentActivity,
    unreadMessagePreview,
  });
});

export default router;
