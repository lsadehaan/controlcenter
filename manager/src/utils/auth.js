'use strict';

const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');

const COOKIE_NAME = 'cc_auth';

// Security warning for production
if (config.JWT_SECRET === 'change-this-secret') {
  console.warn('');
  console.warn('⚠️  WARNING: Using default JWT_SECRET. This is INSECURE!');
  console.warn('⚠️  Set JWT_SECRET environment variable in production.');
  console.warn('');
}

// Cookie security options
const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: config.COOKIE_SECURE,
  path: '/',
  maxAge: config.COOKIE_MAX_AGE
};

function signToken(payload, expiresIn = config.JWT_EXPIRY) {
  return jwt.sign(payload, config.JWT_SECRET, { expiresIn });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, config.JWT_SECRET);
  } catch (e) {
    return null;
  }
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

function authMiddleware(db, options = {}) {
  return async (req, res, next) => {
    // Redirect to bootstrap if no users exist
    try {
      const row = await db.get('SELECT COUNT(1) as c FROM users');
      if (row && row.c === 0) {
        // Redirect UI requests to bootstrap for first-time setup
        if (options.ui) {
          return res.redirect('/auth/bootstrap');
        }
        // Allow API requests through (for health checks, etc.)
        return next();
      }
    } catch (e) {}

    const cookie = req.cookies && req.cookies[COOKIE_NAME];
    const header = req.headers['authorization'];
    let token = null;
    if (cookie) token = cookie;
    else if (header && header.startsWith('Bearer ')) token = header.substring(7);

    if (!token) {
      if (options.ui) return res.redirect('/auth/login');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      if (options.ui) return res.redirect('/auth/login');
      return res.status(401).json({ error: 'Invalid token' });
    }

    req.user = decoded;
    res.locals.user = decoded;  // Make user available to all views
    next();
  };
}

// Role-based access middleware
function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) {
      const err = new Error('Unauthorized');
      err.status = 401;
      return next(err);
    }

    if (req.user.role !== role) {
      const err = new Error('Forbidden: Insufficient permissions');
      err.status = 403;
      return next(err);
    }

    next();
  };
}

// Admin-only middleware (for write operations)
function requireAdmin(req, res, next) {
  if (!req.user) {
    const err = new Error('Unauthorized');
    err.status = 401;
    return next(err);
  }

  if (req.user.role !== 'admin') {
    const err = new Error('Forbidden: Admin access required');
    err.status = 403;
    return next(err);
  }

  next();
}

module.exports = {
  signToken,
  verifyToken,
  setAuthCookie,
  clearAuthCookie,
  authMiddleware,
  requireRole,
  requireAdmin,
  COOKIE_NAME
};


