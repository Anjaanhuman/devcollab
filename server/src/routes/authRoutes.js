import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { body } from 'express-validator';
import User from '../models/User.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validation.js';
import { success, publicUser } from '../utils/api.js';
import { COOKIE_NAME, cookieOptions, createResetToken, createToken, hashToken, verifyToken } from '../utils/tokens.js';
import { sendPasswordResetEmail } from '../services/email.js';

const router = Router();
const passwordRule = body('password')
  .isString().withMessage('Password must be text.')
  .isLength({ min: 8, max: 72 }).withMessage('Password must be 8 to 72 characters.')
  .custom((value) => Buffer.byteLength(value, 'utf8') <= 72).withMessage('Password must be at most 72 UTF-8 bytes.');

const registerRules = [
  body('fullName').trim().isLength({ min: 2, max: 80 }).withMessage('Name must be 2 to 80 characters.'),
  body('username').trim().toLowerCase().matches(/^[a-z0-9_]{3,30}$/).withMessage('Username must be 3 to 30 letters, numbers, or underscores.'),
  body('email').trim().isEmail().normalizeEmail().withMessage('Enter a valid email.'),
  passwordRule,
];

router.post('/register', registerRules, validate, async (req, res) => {
  const email = req.body.email.toLowerCase();
  const username = req.body.username.toLowerCase();
  const existing = await User.findOne({ $or: [{ email }, { username }] }).select('_id email username');
  if (existing) {
    const field = existing.email === email ? 'email' : 'username';
    return success(res, `That ${field} is already in use.`, null, 409, { errors: [{ field, message: `Choose a different ${field}.` }] });
  }

  const passwordHash = await bcrypt.hash(req.body.password, 12);
  const user = await User.create({ fullName: req.body.fullName, username, email, passwordHash });
  res.cookie(COOKIE_NAME, createToken(user), cookieOptions());
  return success(res, 'Account created.', { user: publicUser(user) }, 201);
});

router.post('/login', [body('email').trim().isEmail().normalizeEmail(), body('password').isString().notEmpty()], validate, async (req, res) => {
  const user = await User.findOne({ email: req.body.email.toLowerCase() }).select('+passwordHash +sessionVersion');
  if (!user || user.suspendedAt || !(await bcrypt.compare(req.body.password, user.passwordHash))) {
    return success(res, 'Email or password is incorrect.', null, 401);
  }
  user.lastSeenAt = new Date();
  await user.save();
  res.cookie(COOKIE_NAME, createToken(user), cookieOptions());
  return success(res, 'Signed in.', { user: publicUser(user) });
});

router.post('/logout', async (req, res) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) {
    try {
      const claims = verifyToken(token);
      await User.updateOne({ _id: claims.sub, sessionVersion: claims.ver }, { $inc: { sessionVersion: 1 } });
      req.app.get('io')?.in(`user:${claims.sub}`).disconnectSockets(true);
    } catch (error) {
      if (error.status === 503) throw error;
    }
  }
  res.clearCookie(COOKIE_NAME, cookieOptions());
  return success(res, 'Signed out.');
});

router.get('/me', authenticate, (req, res) => success(res, 'Current account loaded.', { user: publicUser(req.user) }));

router.post('/forgot-password', [body('email').trim().isEmail().normalizeEmail()], validate, async (req, res) => {
  const mailConfigured = process.env.MAIL_FROM && (process.env.RESEND_API_KEY || process.env.SMTP_URL);
  if (process.env.NODE_ENV === 'production' && !mailConfigured) {
    return success(res, 'Password reset email is not configured.', null, 503);
  }
  const user = await User.findOne({ email: req.body.email.toLowerCase() }).select('+passwordResetHash +passwordResetExpiresAt');
  let developmentToken;
  if (user) {
    const token = createResetToken();
    user.passwordResetHash = token.hash;
    user.passwordResetExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await user.save();
    let sent = false;
    try {
      sent = await sendPasswordResetEmail({ to: user.email, token: token.raw });
    } catch (error) {
      console.error('Password reset email could not be delivered.', error.message);
    }
    if (!sent && process.env.NODE_ENV !== 'production') developmentToken = token.raw;
  }
  return success(res, 'If an account matches that email, password reset instructions have been prepared.', developmentToken ? { resetToken: developmentToken, expiresInMinutes: 30 } : null);
});

router.put('/reset-password/:token', [body('password').custom((_, { req }) => typeof req.body.password === 'string').withMessage('Password is required.'), passwordRule], validate, async (req, res) => {
  const user = await User.findOne({
    passwordResetHash: hashToken(req.params.token),
    passwordResetExpiresAt: { $gt: new Date() },
  }).select('+passwordHash +passwordResetHash +passwordResetExpiresAt +sessionVersion');
  if (!user) return success(res, 'The password reset link is invalid or expired.', null, 400);
  user.passwordHash = await bcrypt.hash(req.body.password, 12);
  user.sessionVersion += 1;
  user.passwordResetHash = undefined;
  user.passwordResetExpiresAt = undefined;
  await user.save();
  res.clearCookie(COOKIE_NAME, cookieOptions());
  return success(res, 'Password reset. Sign in with your new password.');
});

export default router;
