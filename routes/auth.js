const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getDB } = require('../database');

// In-memory rate limiting store
const loginAttempts = {};
const LOCK_TIME = 2 * 60 * 1000; // 2 minutes
const MAX_ATTEMPTS = 2;

function getAttemptInfo(username) {
  if (!loginAttempts[username]) {
    loginAttempts[username] = { count: 0, lockedUntil: null };
  }
  return loginAttempts[username];
}

router.get('/login', (req, res) => {
  // Prevent caching of login page
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');

  if (req.session.userId) {
    if (req.session.role === 'tenant') return res.redirect('/tenant');
    return res.redirect('/dashboard');
  }
  res.render('login', { error: null, locked: false, lockRemaining: 0 });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const db = getDB();

  // Check rate limiting
  const attempt = getAttemptInfo(username);
  if (attempt.lockedUntil && Date.now() < attempt.lockedUntil) {
    const remaining = Math.ceil((attempt.lockedUntil - Date.now()) / 1000);
    return res.render('login', { error: null, locked: true, lockRemaining: remaining });
  }

  // Reset if lock expired
  if (attempt.lockedUntil && Date.now() >= attempt.lockedUntil) {
    attempt.count = 0;
    attempt.lockedUntil = null;
  }

  const user = await db.collection('users').findOne({ username });

  if (!user || !bcrypt.compareSync(password, user.password)) {
    attempt.count++;
    if (attempt.count >= MAX_ATTEMPTS) {
      attempt.lockedUntil = Date.now() + LOCK_TIME;
      const remaining = Math.ceil(LOCK_TIME / 1000);
      return res.render('login', { error: null, locked: true, lockRemaining: remaining });
    }
    return res.render('login', { error: `Invalid username or password. ${MAX_ATTEMPTS - attempt.count} attempt(s) remaining.`, locked: false, lockRemaining: 0 });
  }

  // Successful login — reset attempts
  attempt.count = 0;
  attempt.lockedUntil = null;

  req.session.userId = user._id.toString();
  req.session.username = user.username;
  req.session.role = user.role || 'admin';
  req.session.room_id = user.room_id || null;
  req.session.avatar = user.avatar || null;

  // Force password change on first login (for tenants)
  if (user.role === 'tenant' && user.must_change_password !== false) {
    return res.redirect('/change-password');
  }

  if (user.role === 'tenant') return res.redirect('/tenant');
  res.redirect('/dashboard');
});

router.get('/change-password', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  if (!req.session.userId) return res.redirect('/login');
  res.render('change-password', { error: null });
});

router.post('/change-password', async (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  const { password, confirm_password, avatar } = req.body;

  if (!password || password.length < 4) {
    return res.render('change-password', { error: 'Password must be at least 4 characters' });
  }
  if (password !== confirm_password) {
    return res.render('change-password', { error: 'Passwords do not match' });
  }

  const db = getDB();
  const hash = bcrypt.hashSync(password, 10);
  await db.collection('users').updateOne(
    { _id: new (require('mongodb').ObjectId)(req.session.userId) },
    { $set: { password: hash, must_change_password: false, avatar: avatar || '🐶' } }
  );

  req.session.avatar = avatar || '🐶';

  if (req.session.role === 'tenant') return res.redirect('/tenant');
  res.redirect('/dashboard');
});

router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

module.exports = router;
