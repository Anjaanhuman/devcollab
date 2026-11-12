import { Router } from 'express';
import { body, param } from 'express-validator';
import Snippet from '../models/Snippet.js';
import { authenticate, optionalAuthentication } from '../middleware/auth.js';
import { validate } from '../middleware/validation.js';
import { escapeRegex, pagination, paginationInfo, success } from '../utils/api.js';

const router = Router();
const cleanTags = (value) => (Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []).map((item) => String(item).trim().slice(0, 40)).filter(Boolean).slice(0, 20);

router.get('/', optionalAuthentication, async (req, res) => {
  const { page, limit, skip } = pagination(req);
  const filter = req.user ? { $or: [{ visibility: 'public' }, { author: req.user._id }] } : { visibility: 'public' };
  if (req.query.q) {
    const search = new RegExp(escapeRegex(String(req.query.q).slice(0, 80)), 'i');
    filter.$and = [{ $or: [{ title: search }, { description: search }, { tags: search }] }];
  }
  if (req.query.tag) filter.tags = new RegExp(escapeRegex(String(req.query.tag).slice(0, 40)), 'i');
  const [snippets, total] = await Promise.all([
    Snippet.find(filter).populate('author', 'username fullName avatarUrl').sort({ createdAt: -1 }).skip(skip).limit(limit),
    Snippet.countDocuments(filter),
  ]);
  return success(res, 'Code snippets loaded.', snippets, 200, { pagination: paginationInfo(page, limit, total) });
});

router.post('/', authenticate, [body('title').trim().isLength({ min: 2, max: 120 }), body('code').isString().isLength({ min: 1, max: 100000 }), body('language').optional().isString().isLength({ max: 40 }), body('visibility').optional().isIn(['public', 'private'])], validate, async (req, res) => {
  const snippet = await Snippet.create({ title: req.body.title, description: req.body.description || '', code: req.body.code, language: req.body.language || 'javascript', tags: cleanTags(req.body.tags), visibility: req.body.visibility || 'public', author: req.user._id });
  await snippet.populate('author', 'username fullName avatarUrl');
  return success(res, 'Snippet created.', snippet, 201);
});

router.get('/:id', optionalAuthentication, [param('id').isMongoId()], validate, async (req, res) => {
  const snippet = await Snippet.findById(req.params.id).populate('author', 'username fullName avatarUrl');
  if (!snippet || (snippet.visibility === 'private' && String(snippet.author._id) !== String(req.user?._id))) return success(res, 'Snippet not found.', null, 404);
  return success(res, 'Snippet loaded.', snippet);
});

router.put('/:id', authenticate, [param('id').isMongoId(), body('title').optional().trim().isLength({ min: 2, max: 120 }), body('code').optional().isString().isLength({ min: 1, max: 100000 }), body('visibility').optional().isIn(['public', 'private'])], validate, async (req, res) => {
  const snippet = await Snippet.findById(req.params.id);
  if (!snippet) return success(res, 'Snippet not found.', null, 404);
  if (String(snippet.author) !== String(req.user._id) && req.user.role !== 'admin') return success(res, 'You cannot edit this snippet.', null, 403);
  for (const key of ['title', 'description', 'code', 'language', 'visibility']) if (req.body[key] !== undefined) snippet[key] = req.body[key];
  if (req.body.tags !== undefined) snippet.tags = cleanTags(req.body.tags);
  await snippet.save();
  await snippet.populate('author', 'username fullName avatarUrl');
  return success(res, 'Snippet updated.', snippet);
});

router.delete('/:id', authenticate, [param('id').isMongoId()], validate, async (req, res) => {
  const snippet = await Snippet.findById(req.params.id);
  if (!snippet) return success(res, 'Snippet not found.', null, 404);
  if (String(snippet.author) !== String(req.user._id) && req.user.role !== 'admin') return success(res, 'You cannot delete this snippet.', null, 403);
  await snippet.deleteOne();
  return success(res, 'Snippet deleted.');
});

export default router;
