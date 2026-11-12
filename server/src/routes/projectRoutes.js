import { Router } from 'express';
import { body, param } from 'express-validator';
import CollaborationRequest from '../models/CollaborationRequest.js';
import Project from '../models/Project.js';
import User from '../models/User.js';
import Workspace from '../models/Workspace.js';
import { authenticate, optionalAuthentication } from '../middleware/auth.js';
import { validate } from '../middleware/validation.js';
import { pagination, paginationInfo, success, escapeRegex, isValidObjectId } from '../utils/api.js';
import { createNotification } from '../utils/notifications.js';
import { canManageProject, isProjectMember, projectRole } from '../utils/projectAccess.js';
import { cleanupProject } from '../services/projectCleanup.js';
import { ensureWorkspaceForProject } from '../services/ensureWorkspaceForProject.js';
import { deleteRunnerWorkspace, workspaceRunnerConfigured } from '../services/workspaceRunner.js';

const router = Router();
const cleanList = (value) => (Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [])
  .map((entry) => String(entry).trim().slice(0, 50)).filter(Boolean).slice(0, 30);
const projectFields = ['title', 'description', 'category', 'difficulty', 'maxTeamSize', 'deadline', 'githubRepo', 'visibility', 'status'];
const githubRepoRule = body('githubRepo').optional({ checkFalsy: true }).isLength({ max: 300 }).bail().custom((value) => /^(?:https:\/\/github\.com\/)?[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/i.test(value)).withMessage('Enter a GitHub repository URL or owner/name.');

function canSee(project, user) {
  return project.moderationStatus === 'visible' && (project.visibility === 'public' || (user && isProjectMember(project, user._id)));
}

router.get('/github/metadata', optionalAuthentication, async (req, res) => {
  const fullName = String(req.query.repo || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/$/, '');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) return success(res, 'Enter a GitHub repository in owner/name format.', null, 422);
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'DEVCOLLAB' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(`https://api.github.com/repos/${fullName}`, { headers, signal: AbortSignal.timeout(8000) });
  if (!response.ok) return success(res, response.status === 404 ? 'GitHub repository not found.' : 'GitHub metadata is temporarily unavailable.', null, response.status === 404 ? 404 : 502);
  const repo = await response.json();
  return success(res, 'GitHub repository loaded.', { fullName: repo.full_name, description: repo.description, url: repo.html_url, language: repo.language, topics: repo.topics, stars: repo.stargazers_count, forks: repo.forks_count });
});

router.get('/', optionalAuthentication, async (req, res) => {
  const { page, limit, skip } = pagination(req);
  const access = req.user ? [{ visibility: 'public' }, { owner: req.user._id }, { 'members.user': req.user._id }] : [{ visibility: 'public' }];
  const filter = { moderationStatus: 'visible', $or: access };
  if (req.query.q) {
    const search = new RegExp(escapeRegex(String(req.query.q).trim().slice(0, 80)), 'i');
    filter.$and = [{ $or: [{ title: search }, { description: search }, { requiredSkills: search }, { techStack: search }] }];
  }
  if (req.query.skill) filter.requiredSkills = new RegExp(escapeRegex(String(req.query.skill).slice(0, 40)), 'i');
  if (req.query.tech) filter.techStack = new RegExp(escapeRegex(String(req.query.tech).slice(0, 40)), 'i');
  if (['Planning', 'Active', 'Completed', 'Archived'].includes(req.query.status)) filter.status = req.query.status;
  const [projects, total] = await Promise.all([
    Project.find(filter).populate('owner', 'fullName username avatarUrl').populate('members.user', 'fullName username avatarUrl').sort({ createdAt: -1 }).skip(skip).limit(limit),
    Project.countDocuments(filter),
  ]);
  return success(res, 'Projects loaded.', projects, 200, { pagination: paginationInfo(page, limit, total) });
});

router.post('/', authenticate, [
  body('title').trim().isLength({ min: 3, max: 120 }),
  body('description').trim().isLength({ min: 20, max: 5000 }),
  body('difficulty').optional().isIn(['Beginner', 'Intermediate', 'Advanced']),
  body('maxTeamSize').optional().isInt({ min: 1, max: 50 }).toInt(),
  body('visibility').optional().isIn(['public', 'private']),
  body('deadline').optional({ checkFalsy: true }).isISO8601().toDate(),
  githubRepoRule,
], validate, async (req, res) => {
  const project = await Project.create({
    ...Object.fromEntries(projectFields.filter((field) => req.body[field] !== undefined).map((field) => [field, req.body[field]])),
    owner: req.user._id,
    members: [{ user: req.user._id, role: 'Owner' }],
    requiredSkills: cleanList(req.body.requiredSkills),
    techStack: cleanList(req.body.techStack),
  });
  await ensureWorkspaceForProject(project);
  await project.populate(['owner', 'members.user']);
  return success(res, 'Project created.', project, 201);
});

router.get('/:id', optionalAuthentication, [param('id').isMongoId()], validate, async (req, res) => {
  const project = await Project.findById(req.params.id).populate('owner', 'fullName username avatarUrl').populate('members.user', 'fullName username avatarUrl skills');
  if (!project || !canSee(project, req.user)) return success(res, 'Project not found.', null, 404);
  return success(res, 'Project loaded.', project);
});

router.put('/:id', authenticate, [
  param('id').isMongoId(),
  body('title').optional().trim().isLength({ min: 3, max: 120 }),
  body('description').optional().trim().isLength({ min: 20, max: 5000 }),
  body('category').optional().isString().isLength({ max: 60 }),
  body('difficulty').optional().isIn(['Beginner', 'Intermediate', 'Advanced']),
  body('maxTeamSize').optional().isInt({ min: 1, max: 50 }).toInt(),
  body('visibility').optional().isIn(['public', 'private']),
  body('status').optional().isIn(['Planning', 'Active', 'Completed', 'Archived']),
  body('deadline').optional({ checkFalsy: true }).isISO8601().toDate(),
  githubRepoRule,
], validate, async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) return success(res, 'Project not found.', null, 404);
  if (!canManageProject(project, req.user._id, req.user.role)) return success(res, 'Only project owners and team leaders can update this project.', null, 403);
  if (req.body.maxTeamSize !== undefined && req.body.maxTeamSize < project.members.length) return success(res, 'Team size cannot be smaller than the current number of members.', null, 409);
  for (const field of projectFields) if (req.body[field] !== undefined) project[field] = req.body[field];
  if (req.body.requiredSkills !== undefined) project.requiredSkills = cleanList(req.body.requiredSkills);
  if (req.body.techStack !== undefined) project.techStack = cleanList(req.body.techStack);
  await project.save();
  await project.populate(['owner', 'members.user']);
  return success(res, 'Project updated.', project);
});

router.delete('/:id', authenticate, [param('id').isMongoId()], validate, async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) return success(res, 'Project not found.', null, 404);
  if (String(project.owner) !== String(req.user._id) && req.user.role !== 'admin') return success(res, 'Only the project owner can delete this project.', null, 403);
  const workspace = await Workspace.findOne({ projectId: project._id }).select('_id');
  if (workspace && workspaceRunnerConfigured()) await deleteRunnerWorkspace(workspace._id).catch((error) => console.warn('Could not clean up the project runner containers.', error.message));
  await cleanupProject(project._id);
  await project.deleteOne();
  const io = req.app.get('io');
  if (workspace) {
    io?.invalidateWorkspace?.(workspace._id);
    const workspaceSockets = await io?.in(`workspace:${workspace._id}`).fetchSockets() || [];
    for (const socket of workspaceSockets) {
      for (const room of socket.rooms) if (room === `workspace:${workspace._id}` || room.startsWith(`workspace-file:${workspace._id}:`)) await socket.leave(room);
    }
  }
  const projectSockets = await io?.in(`project:${project._id}`).fetchSockets() || [];
  for (const socket of projectSockets) await socket.leave(`project:${project._id}`);
  return success(res, 'Project and its tasks, messages, requests, and project notifications were deleted.');
});

router.post('/:id/join', authenticate, [param('id').isMongoId(), body('message').optional().isString().isLength({ max: 1000 })], validate, async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project || project.moderationStatus !== 'visible' || project.visibility !== 'public') return success(res, 'Project not found.', null, 404);
  if (isProjectMember(project, req.user._id)) return success(res, 'You are already a project member.', null, 409);
  if (project.members.length >= project.maxTeamSize) return success(res, 'This project has reached its team size limit.', null, 409);
  const request = await CollaborationRequest.create({ project: project._id, requester: req.user._id, message: req.body.message || '' });
  await createNotification(req, { recipient: project.owner, actor: req.user._id, type: 'join_request', project: project._id, message: `${req.user.fullName} requested to join ${project.title}.` });
  return success(res, 'Join request sent.', request, 201);
});

router.post('/:id/invites', authenticate, [param('id').isMongoId(), body('userId').isMongoId()], validate, async (req, res) => {
  const [project, invitee] = await Promise.all([Project.findById(req.params.id), User.findOne({ _id: req.body.userId, suspendedAt: null })]);
  if (!project || !invitee) return success(res, 'Project or developer not found.', null, 404);
  if (!canManageProject(project, req.user._id, req.user.role)) return success(res, 'You cannot invite members to this project.', null, 403);
  if (isProjectMember(project, invitee._id)) return success(res, 'That developer is already a member.', null, 409);
  if (project.members.length >= project.maxTeamSize) return success(res, 'This project has reached its team size limit.', null, 409);
  project.members.push({ user: invitee._id, role: 'Developer' });
  await project.save();
  await createNotification(req, { recipient: invitee._id, actor: req.user._id, type: 'project_invite', project: project._id, message: `You were invited to join ${project.title}.` });
  return success(res, 'Developer invited.', { projectId: project._id, member: { id: invitee._id, username: invitee.username } }, 201);
});

router.put('/:id/members/:userId', authenticate, [param('id').isMongoId(), param('userId').isMongoId()], validate, async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) return success(res, 'Project not found.', null, 404);
  if (!canManageProject(project, req.user._id, req.user.role)) return success(res, 'You cannot manage this project team.', null, 403);
  const member = project.members.find((entry) => String(entry.user) === req.params.userId);
  if (!member) return success(res, 'Team member not found.', null, 404);
  if (String(project.owner) === req.params.userId) return success(res, 'The project owner role cannot be changed here.', null, 409);
  if (req.body.action === 'remove') {
    project.members = project.members.filter((entry) => String(entry.user) !== req.params.userId);
  } else if (req.body.action === 'setRole' && ['Team Leader', 'Developer', 'Contributor'].includes(req.body.role)) {
    member.role = req.body.role;
  } else if (req.body.action === 'setWorkspaceRole' && ['editor', 'viewer'].includes(req.body.role)) {
    member.workspaceRole = req.body.role;
  } else {
    return success(res, 'Choose a valid member action and role.', null, 422);
  }
  await project.save();
  if (req.body.action === 'remove') {
    const io = req.app.get('io');
    const workspace = await Workspace.findOne({ projectId: project._id }).select('_id');
    const userSockets = await io?.in(`user:${req.params.userId}`).fetchSockets() || [];
    for (const socket of userSockets) {
      await socket.leave(`project:${project._id}`);
      if (workspace) {
        await socket.leave(`workspace:${workspace._id}`);
        for (const room of socket.rooms) if (room.startsWith(`workspace-file:${workspace._id}:`)) await socket.leave(room);
      }
    }
  }
  return success(res, 'Project team updated.', project.members);
});

router.get('/:id/requests', authenticate, [param('id').isMongoId()], validate, async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) return success(res, 'Project not found.', null, 404);
  if (!canManageProject(project, req.user._id, req.user.role)) return success(res, 'You cannot view this project’s join requests.', null, 403);
  const { page, limit, skip } = pagination(req);
  const filter = { project: project._id, status: 'pending' };
  const [requests, total] = await Promise.all([
    CollaborationRequest.find(filter).populate('requester', 'fullName username avatarUrl skills').sort({ createdAt: -1 }).skip(skip).limit(limit),
    CollaborationRequest.countDocuments(filter),
  ]);
  return success(res, 'Join requests loaded.', requests, 200, { pagination: paginationInfo(page, limit, total) });
});

export default router;
