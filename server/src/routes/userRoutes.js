import { Router } from 'express';
import { body, param } from 'express-validator';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import User from '../models/User.js';
import Project from '../models/Project.js';
import { authenticate, optionalAuthentication } from '../middleware/auth.js';
import { validate } from '../middleware/validation.js';
import { pagination, paginationInfo, success } from '../utils/api.js';

const router = Router();
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter(req, file, callback) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) return callback(new Error('Avatar must be a JPEG, PNG, or WebP image.'));
    return callback(null, true);
  },
});
const publicProfile = (user) => ({
  id: String(user._id),
  fullName: user.fullName,
  username: user.username,
  avatarUrl: user.avatarUrl,
  bio: user.bio,
  skills: user.skills,
  languages: user.languages,
  techStack: user.techStack,
  experienceLevel: user.experienceLevel,
  socialLinks: user.socialLinks,
  createdAt: user.createdAt,
});
const cleanList = (value) => (Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [])
  .map((entry) => String(entry).trim().slice(0, 50)).filter(Boolean).slice(0, 30);

router.get('/', authenticate, async (req, res) => {
  const { page, limit, skip } = pagination(req);
  const filter = { suspendedAt: null };
  if (req.query.q) {
    const q = String(req.query.q).trim().slice(0, 80);
    filter.$or = [{ username: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, { fullName: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }];
  }
  if (req.query.skill) filter.skills = new RegExp(String(req.query.skill).slice(0, 40), 'i');
  const [users, total] = await Promise.all([
    User.find(filter).select('fullName username avatarUrl bio skills languages techStack experienceLevel socialLinks createdAt').sort({ fullName: 1 }).skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);
  return success(res, 'Developer directory loaded.', users.map(publicProfile), 200, { pagination: paginationInfo(page, limit, total) });
});

router.get('/me/profile', authenticate, async (req, res) => {
  const [createdProjects, joinedProjects] = await Promise.all([
    Project.find({ owner: req.user._id }).select('title status visibility createdAt').sort({ createdAt: -1 }).limit(20),
    Project.find({ 'members.user': req.user._id, owner: { $ne: req.user._id } }).select('title status visibility createdAt').sort({ createdAt: -1 }).limit(20),
  ]);
  return success(res, 'Profile loaded.', { user: publicProfile(req.user), email: req.user.email, createdProjects, joinedProjects });
});

router.put('/profile', authenticate, [
  body('fullName').optional().trim().isLength({ min: 2, max: 80 }),
  body('bio').optional().isString().isLength({ max: 500 }),
  body('avatarUrl').optional().isURL({ require_protocol: true }).isLength({ max: 1000 }),
  body('experienceLevel').optional().isIn(['Beginner', 'Intermediate', 'Advanced']),
  body('socialLinks.github').optional({ checkFalsy: true }).isURL({ require_protocol: true }).isLength({ max: 300 }),
  body('socialLinks.linkedin').optional({ checkFalsy: true }).isURL({ require_protocol: true }).isLength({ max: 300 }),
  body('socialLinks.portfolio').optional({ checkFalsy: true }).isURL({ require_protocol: true }).isLength({ max: 300 }),
], validate, async (req, res) => {
  const allowed = ['fullName', 'bio', 'avatarUrl', 'experienceLevel'];
  for (const key of allowed) if (req.body[key] !== undefined) req.user[key] = req.body[key];
  for (const key of ['skills', 'languages', 'techStack']) if (req.body[key] !== undefined) req.user[key] = cleanList(req.body[key]);
  if (req.body.socialLinks && typeof req.body.socialLinks === 'object') {
    for (const key of ['github', 'linkedin', 'portfolio']) {
      if (req.body.socialLinks[key] !== undefined) req.user.socialLinks[key] = String(req.body.socialLinks[key]).trim().slice(0, 300);
    }
  }
  await req.user.save();
  return success(res, 'Profile updated.', { user: publicProfile(req.user) });
});

router.post('/profile/avatar', authenticate, avatarUpload.single('avatar'), async (req, res) => {
  if (!req.file) return success(res, 'Choose an image to upload.', null, 422);
  const { CLOUDINARY_URL, CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_URL && !(CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET)) return success(res, 'Avatar uploads are not configured. Add Cloudinary credentials to server/.env.', null, 503);

  const buffer = req.file.buffer;
  const isPng = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isWebp = buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  if (!(isPng || isJpeg || isWebp)) return success(res, 'The uploaded file is not a valid image.', null, 422);
  if (!CLOUDINARY_URL) cloudinary.config({ cloud_name: CLOUDINARY_CLOUD_NAME, api_key: CLOUDINARY_API_KEY, api_secret: CLOUDINARY_API_SECRET, secure: true });

  const uploaded = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder: 'devcollab/avatars', resource_type: 'image', transformation: [{ width: 512, height: 512, crop: 'fill', gravity: 'face' }] }, (error, result) => error ? reject(error) : resolve(result));
    stream.end(buffer);
  });
  const currentUser = await User.findById(req.user._id).select('+avatarPublicId');
  const oldPublicId = currentUser.avatarPublicId;
  currentUser.avatarUrl = uploaded.secure_url;
  currentUser.avatarPublicId = uploaded.public_id;
  await currentUser.save();
  if (oldPublicId) await cloudinary.uploader.destroy(oldPublicId, { invalidate: true }).catch(() => {});
  return success(res, 'Avatar uploaded.', { avatarUrl: currentUser.avatarUrl });
});

router.post('/profile/github-sync', authenticate, [body('username').trim().matches(/^[A-Za-z0-9-]{1,39}$/)], validate, async (req, res) => {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'DEVCOLLAB' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(`https://api.github.com/users/${encodeURIComponent(req.body.username)}`, { headers, signal: AbortSignal.timeout(8000) });
  if (!response.ok) return success(res, response.status === 404 ? 'GitHub user not found.' : 'GitHub profile is temporarily unavailable.', null, response.status === 404 ? 404 : 502);
  const profile = await response.json();
  req.user.socialLinks.github = profile.html_url;
  if (profile.name && req.body.updateName !== false) req.user.fullName = String(profile.name).slice(0, 80);
  if (profile.bio && req.body.updateBio !== false) req.user.bio = String(profile.bio).slice(0, 500);
  if (profile.avatar_url) req.user.avatarUrl = profile.avatar_url;
  await req.user.save();
  return success(res, 'GitHub profile synced.', { github: req.user.socialLinks.github, publicName: profile.name, bio: req.user.bio, avatarUrl: profile.avatar_url, publicRepos: profile.public_repos });
});

router.get('/:id', optionalAuthentication, [param('id').isMongoId()], validate, async (req, res) => {
  const user = await User.findOne({ _id: req.params.id, suspendedAt: null }).select('fullName username avatarUrl bio skills languages techStack experienceLevel socialLinks createdAt');
  if (!user) return success(res, 'Developer not found.', null, 404);
  const [createdProjects, joinedProjects] = await Promise.all([
    Project.find({ owner: user._id, visibility: 'public', moderationStatus: 'visible' }).select('title status createdAt').sort({ createdAt: -1 }).limit(20),
    Project.find({ 'members.user': user._id, owner: { $ne: user._id }, visibility: 'public', moderationStatus: 'visible' }).select('title status createdAt').sort({ createdAt: -1 }).limit(20),
  ]);
  return success(res, 'Developer profile loaded.', { user: publicProfile(user), createdProjects, joinedProjects });
});

export default router;
