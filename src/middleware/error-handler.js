'use strict';

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  const isValidationError = error.name === 'ZodError' || Array.isArray(error.issues);
  const status = Number(error.status) || (isValidationError ? 400 : 500);
  if (status >= 500) console.error(`[${req.method} ${req.path}]`, error.message);
  const body = {
    error: status >= 500 ? 'The service could not complete this request.' : (error.message || 'Request validation failed.'),
    code: error.code || (isValidationError ? 'INVALID_REQUEST' : status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED')
  };
  if (status < 500 && isValidationError) body.details = error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message }));
  else if (error.details && status < 500) body.details = error.details;
  res.status(status).json(body);
}

module.exports = { errorHandler };
