import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

let developmentSecret;

function signingSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') {
    const error = new Error('Authentication is not configured. Set JWT_SECRET.');
    error.status = 503;
    throw error;
  }
  developmentSecret ??= crypto.randomBytes(48).toString('hex');
  return developmentSecret;
}

export const COOKIE_NAME = 'devcollab_token';
export const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

export function createToken(user) {
  const userId = user?._id ?? user?.id ?? user;
  return jwt.sign({ sub: String(userId), ver: Number(user?.sessionVersion || 0) }, signingSecret(), { algorithm: 'HS256', expiresIn: TOKEN_TTL_SECONDS });
}

export function verifyToken(token) {
  return jwt.verify(token, signingSecret(), { algorithms: ['HS256'] });
}

export function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: TOKEN_TTL_SECONDS * 1000,
  };
}

export function hashToken(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
export function createResetToken() {
  const raw = crypto.randomBytes(32).toString('hex');
  return { raw, hash: hashToken(raw) };
}
