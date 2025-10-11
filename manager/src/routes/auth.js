'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { signToken, setAuthCookie, clearAuthCookie } = require('../utils/auth');

module.exports = (db) => {
  const router = express.Router();

  // Login page (UI)
  router.get('/login', async (req, res) => {
    res.render('login', { title: 'Login' });
  });

  // Bootstrap page if no users
  router.get('/bootstrap', async (req, res) => {
    try {
      const row = await db.get('SELECT COUNT(1) as c FROM users');
      if (row && row.c > 0) return res.redirect('/auth/login');
      res.render('bootstrap', { title: 'Initial Setup' });
    } catch (e) {
      res.status(500).send('Error');
    }
  });

  // Handle bootstrap (create first admin)
  router.post('/bootstrap', async (req, res) => {
    try {
      const row = await db.get('SELECT COUNT(1) as c FROM users');
      if (row && row.c > 0) return res.status(400).send('Already initialized');

      const { username, password } = req.body;
      if (!username || !password) return res.status(400).send('Missing fields');
      const hash = await bcrypt.hash(password, 10);
      const id = uuidv4();
      await db.createUser(id, username, hash, 'admin');

      const token = signToken({ sub: id, username, role: 'admin' });
      setAuthCookie(res, token);
      res.redirect('/');
    } catch (e) {
      res.status(500).send('Error');
    }
  });

  // Handle login (UI form)
  router.post('/login', async (req, res) => {
    try {
      const { username, password } = req.body;
      const user = await db.findUserByUsername(username);
      if (!user) return res.status(401).render('login', { title: 'Login', error: 'Invalid credentials' });

      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) return res.status(401).render('login', { title: 'Login', error: 'Invalid credentials' });

      await db.updateLastLogin(user.id);
      const token = signToken({ sub: user.id, username: user.username, role: user.role });
      setAuthCookie(res, token);
      res.redirect('/');
    } catch (e) {
      res.status(500).render('login', { title: 'Login', error: 'Server error' });
    }
  });

  // API login (returns token)
  router.post('/api/login', async (req, res) => {
    try {
      const { username, password } = req.body;
      const user = await db.findUserByUsername(username);
      if (!user) return res.status(401).json({ error: 'Invalid credentials' });
      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
      await db.updateLastLogin(user.id);
      const token = signToken({ sub: user.id, username: user.username, role: user.role });
      res.json({ token });
    } catch (e) {
      res.status(500).json({ error: 'Server error' });
    }
  });

  // Logout
  router.post('/logout', (req, res) => {
    clearAuthCookie(res);
    res.redirect('/auth/login');
  });

  return router;
};


