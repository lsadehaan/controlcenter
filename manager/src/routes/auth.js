'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { signToken, setAuthCookie, clearAuthCookie } = require('../utils/auth');

// Password validation (exported for reuse in API routes)
function validatePassword(password) {
  if (!password || password.length < 8) {
    return 'Password must be at least 8 characters long';
  }
  if (!/[A-Z]/.test(password)) {
    return 'Password must contain at least one uppercase letter';
  }
  if (!/[a-z]/.test(password)) {
    return 'Password must contain at least one lowercase letter';
  }
  if (!/[0-9]/.test(password)) {
    return 'Password must contain at least one number';
  }
  return null;
}

// Auth event logging
function logAuthEvent(level, username, ip, event, details = {}) {
  const log = {
    timestamp: new Date().toISOString(),
    level,
    event,
    username,
    ip,
    ...details
  };
  if (level === 'WARN' || level === 'ERROR') {
    console.warn('AUTH:', JSON.stringify(log));
  } else {
    console.log('AUTH:', JSON.stringify(log));
  }
}

module.exports = (db, csrfProtection) => {
  const router = express.Router();

  // Login page (UI)
  router.get('/login', csrfProtection, async (req, res) => {
    res.render('login', { title: 'Login', csrfToken: req.csrfToken() });
  });

  // Bootstrap page if no users
  router.get('/bootstrap', csrfProtection, async (req, res) => {
    try {
      const row = await db.get('SELECT COUNT(1) as c FROM users');
      if (row && row.c > 0) return res.redirect('/auth/login');
      res.render('bootstrap', { title: 'Initial Setup', csrfToken: req.csrfToken() });
    } catch (e) {
      res.status(500).send('Error');
    }
  });

  // Handle bootstrap (create first admin)
  router.post('/bootstrap', csrfProtection, async (req, res) => {
    try {
      const row = await db.get('SELECT COUNT(1) as c FROM users');
      if (row && row.c > 0) {
        logAuthEvent('WARN', 'unknown', req.ip, 'bootstrap_already_initialized');
        return res.status(400).render('bootstrap', {
          title: 'Initial Setup',
          csrfToken: req.csrfToken(),
          error: 'System already initialized'
        });
      }

      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).render('bootstrap', {
          title: 'Initial Setup',
          csrfToken: req.csrfToken(),
          username: username || '',
          error: 'Username and password are required'
        });
      }

      // Validate password
      const passwordError = validatePassword(password);
      if (passwordError) {
        return res.status(400).render('bootstrap', {
          title: 'Initial Setup',
          csrfToken: req.csrfToken(),
          username,
          error: passwordError
        });
      }

      const hash = await bcrypt.hash(password, 10);
      const id = uuidv4();
      await db.createUser(id, username, hash, 'admin');

      logAuthEvent('INFO', username, req.ip, 'bootstrap_success', { userId: id });

      const token = signToken({ sub: id, username, role: 'admin' });
      setAuthCookie(res, token);
      res.redirect('/');
    } catch (e) {
      logAuthEvent('ERROR', 'unknown', req.ip, 'bootstrap_error', { error: e.message });
      res.status(500).send('Error creating admin user');
    }
  });

  // Handle login (UI form)
  router.post('/login', csrfProtection, async (req, res) => {
    try {
      const { username, password } = req.body;

      const user = await db.findUserByUsername(username);
      if (!user) {
        logAuthEvent('WARN', username, req.ip, 'login_failed', { reason: 'user_not_found' });
        return res.status(401).render('login', {
          title: 'Login',
          csrfToken: req.csrfToken(),
          username,
          error: 'Invalid credentials'
        });
      }

      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) {
        logAuthEvent('WARN', username, req.ip, 'login_failed', { reason: 'invalid_password', userId: user.id });
        return res.status(401).render('login', {
          title: 'Login',
          csrfToken: req.csrfToken(),
          username,
          error: 'Invalid credentials'
        });
      }

      await db.updateLastLogin(user.id);
      logAuthEvent('INFO', username, req.ip, 'login_success', { userId: user.id });

      const token = signToken({ sub: user.id, username: user.username, role: user.role });
      setAuthCookie(res, token);
      res.redirect('/');
    } catch (e) {
      logAuthEvent('ERROR', username || 'unknown', req.ip, 'login_error', { error: e.message });
      res.status(500).render('login', {
        title: 'Login',
        csrfToken: req.csrfToken(),
        username: req.body.username || '',
        error: 'Server error'
      });
    }
  });

  // API login (returns token)
  router.post('/api/login', async (req, res) => {
    try {
      const { username, password } = req.body;

      const user = await db.findUserByUsername(username);
      if (!user) {
        logAuthEvent('WARN', username, req.ip, 'api_login_failed', { reason: 'user_not_found' });
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) {
        logAuthEvent('WARN', username, req.ip, 'api_login_failed', { reason: 'invalid_password', userId: user.id });
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      await db.updateLastLogin(user.id);
      logAuthEvent('INFO', username, req.ip, 'api_login_success', { userId: user.id });

      const token = signToken({ sub: user.id, username: user.username, role: user.role });
      res.json({ token });
    } catch (e) {
      logAuthEvent('ERROR', username || 'unknown', req.ip, 'api_login_error', { error: e.message });
      res.status(500).json({ error: 'Server error' });
    }
  });

  // Logout
  router.post('/logout', (req, res) => {
    const username = req.user ? req.user.username : 'unknown';
    logAuthEvent('INFO', username, req.ip, 'logout');
    clearAuthCookie(res);
    res.redirect('/auth/login');
  });

  return router;
};

// Export validation function for reuse in API routes
module.exports.validatePassword = validatePassword;


