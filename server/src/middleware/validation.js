import { validationResult } from 'express-validator';

export function validate(req, res, next) {
  const result = validationResult(req);
  if (result.isEmpty()) return next();
  return res.status(422).json({
    success: false,
    message: 'Please correct the highlighted fields.',
    data: null,
    errors: result.array().map(({ path, msg }) => ({ field: path, message: msg })),
  });
}
