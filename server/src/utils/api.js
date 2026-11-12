export function success(res, message, data = null, status = 200, extra = {}) {
  return res.status(status).json({ success: status < 400, message, data, ...extra });
}

export function pagination(req) {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
}

export function paginationInfo(page, limit, total) {
  return { page, limit, total, pages: Math.ceil(total / limit), hasNextPage: page * limit < total, hasPreviousPage: page > 1 };
}

export function publicUser(user) {
  if (!user) return null;
  const value = typeof user.toObject === 'function' ? user.toObject() : user;
  const { passwordHash, passwordResetHash, passwordResetExpiresAt, __v, ...safe } = value;
  return { ...safe, id: String(value._id ?? value.id), _id: undefined };
}

export function getId(value) {
  return String(value?._id ?? value?.id ?? value);
}

export function isValidObjectId(value) {
  return /^[a-f\d]{24}$/i.test(String(value));
}

export function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
