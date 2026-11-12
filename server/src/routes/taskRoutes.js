import { Router } from 'express';
import { body, param } from 'express-validator';
import Project from '../models/Project.js';
import Task from '../models/Task.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validation.js';
import { pagination, paginationInfo, success } from '../utils/api.js';
import { createNotification } from '../utils/notifications.js';
import { canManageProject, isProjectMember } from '../utils/projectAccess.js';

const router = Router();
const statuses = ['To Do', 'In Progress', 'In Review', 'Completed'];
const priorities = ['Low', 'Medium', 'High', 'Critical'];
const safeWorkspacePath = (value) => typeof value === 'string' && value.length > 0 && value.length <= 240 && !value.includes('\\') && !value.includes('\0') && !value.startsWith('/') && !value.split('/').some((part) => !part || part === '.' || part === '..');

router.post('/', authenticate, [body('title').trim().isLength({ min: 2, max: 180 }), body('description').optional().isString().isLength({ max: 3000 }), body('project').isMongoId(), body('priority').optional().isIn(priorities), body('status').optional().isIn(statuses), body('assignedTo').optional({ nullable: true }).isMongoId(), body('deadline').optional({ nullable: true, checkFalsy: true }).isISO8601().toDate(), body('linkedFilePath').optional({ checkFalsy: true }).isString().isLength({ max: 240 }).bail().custom(safeWorkspacePath)], validate, async (req, res) => {
  const project = await Project.findById(req.body.project);
  if (!project || project.moderationStatus !== 'visible') return success(res, 'Project not found.', null, 404);
  if (!isProjectMember(project, req.user._id)) return success(res, 'Only team members can create project tasks.', null, 403);
  if (req.body.assignedTo && !isProjectMember(project, req.body.assignedTo)) return success(res, 'Assignee must be a project member.', null, 422);
  const task = await Task.create({
    title: req.body.title,
    description: req.body.description || '',
    project: project._id,
    createdBy: req.user._id,
    assignedTo: req.body.assignedTo || null,
    priority: req.body.priority || 'Medium',
    status: req.body.status || 'To Do',
    deadline: req.body.deadline || null,
    linkedFilePath: req.body.linkedFilePath || '',
  });
  await task.populate(['assignedTo', 'createdBy', 'project']);
  if (task.assignedTo) await createNotification(req, { recipient: task.assignedTo._id, actor: req.user._id, type: 'task_assigned', task: task._id, project: project._id, message: `You were assigned “${task.title}”.` });
  return success(res, 'Task created.', task, 201);
});

router.get('/project/:projectId', authenticate, [param('projectId').isMongoId()], validate, async (req, res) => {
  const project = await Project.findById(req.params.projectId);
  if (!project || project.moderationStatus !== 'visible') return success(res, 'Project not found.', null, 404);
  if (!isProjectMember(project, req.user._id)) return success(res, 'Only project members can view these tasks.', null, 403);
  const { page, limit, skip } = pagination(req);
  const filter = { project: project._id };
  if (statuses.includes(req.query.status)) filter.status = req.query.status;
  if (priorities.includes(req.query.priority)) filter.priority = req.query.priority;
  if (req.query.assignee === 'me') filter.assignedTo = req.user._id;
  else if (req.query.assignee && /^[a-f\d]{24}$/i.test(String(req.query.assignee))) filter.assignedTo = req.query.assignee;
  const [tasks, total] = await Promise.all([
    Task.find(filter).populate('assignedTo', 'fullName username avatarUrl').populate('createdBy', 'fullName username').sort({ createdAt: 1 }).skip(skip).limit(limit),
    Task.countDocuments(filter),
  ]);
  const allCount = await Task.countDocuments({ project: project._id });
  const completedCount = await Task.countDocuments({ project: project._id, status: 'Completed' });
  return success(res, 'Project tasks loaded.', tasks, 200, { pagination: paginationInfo(page, limit, total), progress: { total: allCount, completed: completedCount, percentage: allCount ? Math.round(completedCount / allCount * 100) : 0 } });
});

router.put('/:id', authenticate, [param('id').isMongoId(), body('title').optional().trim().isLength({ min: 2, max: 180 }), body('description').optional().isString().isLength({ max: 3000 }), body('status').optional().isIn(statuses), body('priority').optional().isIn(priorities), body('assignedTo').optional({ nullable: true }).isMongoId(), body('deadline').optional({ nullable: true, checkFalsy: true }).isISO8601().toDate(), body('linkedFilePath').optional({ checkFalsy: true }).isString().isLength({ max: 240 }).bail().custom(safeWorkspacePath)], validate, async (req, res) => {
  const task = await Task.findById(req.params.id);
  if (!task) return success(res, 'Task not found.', null, 404);
  const project = await Project.findById(task.project);
  if (!project || project.moderationStatus !== 'visible' || !isProjectMember(project, req.user._id)) return success(res, 'You cannot edit this task.', null, 403);
  const manager = canManageProject(project, req.user._id, req.user.role);
  if (!manager && String(task.createdBy) !== String(req.user._id) && String(task.assignedTo) !== String(req.user._id)) return success(res, 'You cannot edit this task.', null, 403);
  const allowed = ['title', 'description', 'status', 'priority', 'deadline', 'linkedFilePath'];
  for (const key of allowed) if (req.body[key] !== undefined) task[key] = req.body[key];
  if (req.body.assignedTo !== undefined) {
    if (req.body.assignedTo && !isProjectMember(project, req.body.assignedTo)) return success(res, 'Assignee must be a project member.', null, 422);
    task.assignedTo = req.body.assignedTo || null;
  }
  await task.save();
  await task.populate(['assignedTo', 'createdBy']);
  if (task.assignedTo) await createNotification(req, { recipient: task.assignedTo._id, actor: req.user._id, type: 'task_updated', task: task._id, project: project._id, message: `Task “${task.title}” was updated.` });
  return success(res, 'Task updated.', task);
});

router.delete('/:id', authenticate, [param('id').isMongoId()], validate, async (req, res) => {
  const task = await Task.findById(req.params.id);
  if (!task) return success(res, 'Task not found.', null, 404);
  const project = await Project.findById(task.project);
  if (!project || project.moderationStatus !== 'visible' || (!canManageProject(project, req.user._id, req.user.role) && String(task.createdBy) !== String(req.user._id))) return success(res, 'You cannot delete this task.', null, 403);
  await Promise.all([task.deleteOne(), (await import('../models/Notification.js')).default.deleteMany({ task: task._id })]);
  return success(res, 'Task deleted.');
});

export default router;
