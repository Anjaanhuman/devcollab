export function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
    data: null,
  });
}

// Express identifies error middleware by its four parameters.
// eslint-disable-next-line no-unused-vars
export function errorHandler(error, req, res, next) {
  const inferredStatus = error.code === 11000 ? 409 : error.name === 'ValidationError' ? 422 : error.name === 'CastError' ? 400 : error.name === 'MulterError' ? (error.code === 'LIMIT_FILE_SIZE' ? 413 : 400) : 500;
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600
    ? error.status
    : inferredStatus;

  if (status >= 500) console.error(error);

  res.status(status).json({
    success: false,
    message: status === 409 ? 'A record with that value already exists.' : status >= 500 ? 'An unexpected server error occurred.' : error.message,
    data: null,
    ...(status === 422 && error.errors ? { errors: Object.values(error.errors).map((entry) => ({ field: entry.path, message: entry.message })) } : {}),
    ...(process.env.NODE_ENV === 'development' && status >= 500 ? { errors: [error.message] } : {}),
  });
}
