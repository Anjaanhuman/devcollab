import { Router } from 'express';
import { body, param } from 'express-validator';
import Comment from '../models/Comment.js';
import Post from '../models/Post.js';
import { authenticate, optionalAuthentication } from '../middleware/auth.js';
import { validate } from '../middleware/validation.js';
import { escapeRegex, pagination, paginationInfo, success } from '../utils/api.js';
import { createNotification } from '../utils/notifications.js';

const router = Router();
const cleanTags = (value) => (Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []).map((item) => String(item).trim().slice(0, 40)).filter(Boolean).slice(0, 20);

router.get('/', optionalAuthentication, async (req, res) => {
  const { page, limit, skip } = pagination(req);
  const filter = { moderationStatus: 'visible' };
  if (req.query.tag) filter.tags = new RegExp(escapeRegex(String(req.query.tag).slice(0, 40)), 'i');
  if (req.query.q) {
    const search = new RegExp(escapeRegex(String(req.query.q).slice(0, 80)), 'i');
    filter.$or = [{ title: search }, { body: search }, { tags: search }];
  }
  const [posts, total] = await Promise.all([
    Post.find(filter).populate('author', 'username fullName avatarUrl').sort({ createdAt: -1 }).skip(skip).limit(limit),
    Post.countDocuments(filter),
  ]);
  return success(res, 'Community posts loaded.', posts.map((post) => ({ ...post.toObject(), likeCount: post.likes.length, likedByMe: Boolean(req.user && post.likes.some((id) => String(id) === String(req.user._id))) })), 200, { pagination: paginationInfo(page, limit, total) });
});

router.post('/', authenticate, [body('title').trim().isLength({ min: 5, max: 180 }), body('body').trim().isLength({ min: 10, max: 10000 })], validate, async (req, res) => {
  const post = await Post.create({ title: req.body.title, body: req.body.body, tags: cleanTags(req.body.tags), author: req.user._id });
  await post.populate('author', 'username fullName avatarUrl');
  return success(res, 'Post published.', post, 201);
});

router.get('/:id', optionalAuthentication, [param('id').isMongoId()], validate, async (req, res) => {
  const post = await Post.findOne({ _id: req.params.id, moderationStatus: 'visible' }).populate('author', 'username fullName avatarUrl');
  if (!post) return success(res, 'Post not found.', null, 404);
  return success(res, 'Post loaded.', { ...post.toObject(), likeCount: post.likes.length, likedByMe: Boolean(req.user && post.likes.some((id) => String(id) === String(req.user._id))) });
});

router.get('/:id/comments', optionalAuthentication, [param('id').isMongoId()], validate, async (req, res) => {
  const post = await Post.findOne({ _id: req.params.id, moderationStatus: 'visible' }).select('_id');
  if (!post) return success(res, 'Post not found.', null, 404);
  const { page, limit, skip } = pagination(req);
  const [comments, total] = await Promise.all([
    Comment.find({ post: post._id }).populate('author', 'username fullName avatarUrl').sort({ createdAt: 1 }).skip(skip).limit(limit),
    Comment.countDocuments({ post: post._id }),
  ]);
  return success(res, 'Comments loaded.', comments, 200, { pagination: paginationInfo(page, limit, total) });
});

router.post('/:id/comments', authenticate, [param('id').isMongoId(), body('body').trim().isLength({ min: 1, max: 4000 }), body('parent').optional({ nullable: true }).isMongoId()], validate, async (req, res) => {
  const post = await Post.findOne({ _id: req.params.id, moderationStatus: 'visible' });
  if (!post) return success(res, 'Post not found.', null, 404);
  let parent;
  if (req.body.parent) {
    parent = await Comment.findOne({ _id: req.body.parent, post: post._id });
    if (!parent) return success(res, 'Reply target not found.', null, 404);
  }
  const comment = await Comment.create({ post: post._id, author: req.user._id, parent: parent?._id || null, body: req.body.body });
  await comment.populate('author', 'username fullName avatarUrl');
  const recipient = parent?.author || post.author;
  await createNotification(req, { recipient, actor: req.user._id, type: 'post_reply', post: post._id, message: `${req.user.fullName} replied to your community post.` });
  return success(res, 'Comment added.', comment, 201);
});

router.put('/:id/like', authenticate, [param('id').isMongoId()], validate, async (req, res) => {
  const post = await Post.findOne({ _id: req.params.id, moderationStatus: 'visible' });
  if (!post) return success(res, 'Post not found.', null, 404);
  const current = post.likes.some((id) => String(id) === String(req.user._id));
  if (current) post.likes.pull(req.user._id);
  else post.likes.addToSet(req.user._id);
  await post.save();
  return success(res, current ? 'Like removed.' : 'Post liked.', { liked: !current, likeCount: post.likes.length });
});

router.delete('/:id', authenticate, [param('id').isMongoId()], validate, async (req, res) => {
  const post = await Post.findById(req.params.id);
  if (!post) return success(res, 'Post not found.', null, 404);
  if (String(post.author) !== String(req.user._id) && req.user.role !== 'admin') return success(res, 'You cannot delete this post.', null, 403);
  await Promise.all([post.deleteOne(), Comment.deleteMany({ post: post._id })]);
  return success(res, 'Post and its comments deleted.');
});

export default router;
