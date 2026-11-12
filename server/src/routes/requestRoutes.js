import { Router } from 'express';
import { body, param } from 'express-validator';
import CollaborationRequest from '../models/CollaborationRequest.js';
import Project from '../models/Project.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validation.js';
import { success } from '../utils/api.js';
import { createNotification } from '../utils/notifications.js';
import { canManageProject, isProjectMember } from '../utils/projectAccess.js';

const router = Router();

router.put('/:requestId', authenticate, [param('requestId').isMongoId(), body('status').isIn(['accepted', 'rejected'])], validate, async (req, res) => {
  const request = await CollaborationRequest.findById(req.params.requestId).populate('requester', 'fullName username');
  if (!request) return success(res, 'Join request not found.', null, 404);
  const project = await Project.findById(request.project);
  if (!project || project.moderationStatus !== 'visible') return success(res, 'Project not found.', null, 404);
  if (!canManageProject(project, req.user._id, req.user.role)) return success(res, 'You cannot respond to this request.', null, 403);
  if (request.status !== 'pending') return success(res, 'This request has already been handled.', null, 409);
  if (req.body.status === 'accepted') {
    if (project.members.length >= project.maxTeamSize) return success(res, 'This project has reached its team size limit.', null, 409);
    if (!isProjectMember(project, request.requester._id)) project.members.push({ user: request.requester._id, role: 'Developer' });
    await project.save();
  }
  request.status = req.body.status;
  request.respondedBy = req.user._id;
  request.respondedAt = new Date();
  await request.save();
  await createNotification(req, { recipient: request.requester._id, actor: req.user._id, type: req.body.status === 'accepted' ? 'request_approved' : 'request_rejected', project: project._id, message: req.body.status === 'accepted' ? `Your request to join ${project.title} was accepted.` : `Your request to join ${project.title} was declined.` });
  return success(res, `Join request ${req.body.status}.`, request);
});

export default router;
