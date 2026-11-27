'use strict';

const { AppError } = require('../utils/errors');

function requireUser(req, _res, next) {
  if (!req.session || !req.session.user) return next(new AppError(401, 'Sign in is required.', 'UNAUTHENTICATED'));
  return next();
}

function requireOwner(req, _res, next) {
  if (!req.session || !req.session.user) {
    return next(new AppError(401, 'Sign in is required.', 'UNAUTHENTICATED'));
  }
  if (req.session.user.role !== 'admin') {
    return next(new AppError(403, 'Owner access is required.', 'FORBIDDEN'));
  }
  return next();
}

module.exports = { requireUser, requireOwner };
