import User from '../models/User.js';
import { COOKIE_NAME, verifyToken } from '../utils/tokens.js';
import { success } from '../utils/api.js';

function getToken(req) {
  const cookieToken = req.cookies?.[COOKIE_NAME];
  if (cookieToken) return cookieToken;
  const [scheme, token] = String(req.headers.authorization || '').split(' ');
  return scheme?.toLowerCase() === 'bearer' ? token : null;
}

export async function authenticate(req, res, next) {
  try {
    const token = getToken(req);
    if (!token) return success(res, 'Authentication required.', null, 401);
    const claims = verifyToken(token);
    const user = await User.findById(claims.sub).select('+sessionVersion');
    if (!user || user.suspendedAt || claims.ver !== user.sessionVersion) return success(res, 'Your session is not valid.', null, 401);
    req.user = user;
    return next();
  } catch (error) {
    if (error.status === 503) return next(error);
    return success(res, 'Your session is not valid.', null, 401);
  }
}

export function optionalAuthentication(req, res, next) {
  const token = getToken(req);
  if (!token) return next();
  try {
    const claims = verifyToken(token);
    User.findById(claims.sub).select('+sessionVersion').then((user) => {
      if (user && !user.suspendedAt && claims.ver === user.sessionVersion) req.user = user;
      next();
    }).catch(next);
  } catch {
    next();
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) return success(res, 'You do not have permission to perform this action.', null, 403);
    return next();
  };
}
