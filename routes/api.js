const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getDB } = require('../database');

// Simple API login
router.post('/login', async (req, res) => {
  const db = getDB();
  const { username, password } = req.body;
  const user = await db.collection('users').findOne({ username });
  if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Invalid credentials' });
  req.session.userId = user._id.toString();
  res.json({ success: true, userId: user._id.toString(), username: user.username });
});

module.exports = router;
