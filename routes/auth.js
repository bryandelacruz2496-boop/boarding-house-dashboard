const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getDB } = require('../database');

router.get('/login', (req, res) => {
  if (req.session.userId) {
    if (req.session.role === 'tenant') return res.redirect('/tenant');
    return res.redirect('/dashboard');
  }
  res.render('login', { error: null });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const db = getDB();
  const user = await db.collection('users').findOne({ username });

  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.render('login', { error: 'Invalid username or password' });
  }

  req.session.userId = user._id.toString();
  req.session.username = user.username;
  req.session.role = user.role || 'admin';
  req.session.room_id = user.room_id || null;

  // Force password change on first login (for tenants)
  if (user.role === 'tenant' && user.must_change_password !== false) {
    return res.redirect('/change-password');
  }

  if (user.role === 'tenant') return res.redirect('/tenant');
  res.redirect('/dashboard');
});

router.get('/change-password', (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  res.render('change-password', { error: null });
});

router.post('/change-password', async (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  const { password, confirm_password } = req.body;

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
    { $set: { password: hash, must_change_password: false } }
  );

  if (req.session.role === 'tenant') return res.redirect('/tenant');
  res.redirect('/dashboard');
});

router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

module.exports = router;
