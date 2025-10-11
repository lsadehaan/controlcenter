'use strict';

const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';
const COOKIE_NAME = 'cc_auth';
const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: false,
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000
};

function signToken(payload, expiresIn = '7d') {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
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
    // Allow bootstrap if no users exist
    try {
      const row = await db.get('SELECT COUNT(1) as c FROM users');
      if (row && row.c === 0) {
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
    next();
  };
}

module.exports = {
  signToken,
  verifyToken,
  setAuthCookie,
  clearAuthCookie,
  authMiddleware,
  COOKIE_NAME
};


