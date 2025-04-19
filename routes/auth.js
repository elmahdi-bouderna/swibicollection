const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const auth = require('../middleware/auth');

// @route   POST api/auth/login
// @desc    Admin login
// @access  Public
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    // Check if admin exists
    const [rows] = await db.query('SELECT * FROM admins WHERE username = ?', [username]);
    
    if (rows.length === 0) {
      return res.status(400).json({ msg: 'Invalid Credentials' });
    }

    const admin = rows[0];

    // Check password
    const isMatch = await bcrypt.compare(password, admin.password_hash);
    if (!isMatch) {
      return res.status(400).json({ msg: 'Invalid Credentials' });
    }

    // Create JWT
    const payload = {
      admin: {
        id: admin.id,
        username: admin.username
      }
    };

    jwt.sign(
      payload,
      process.env.JWT_SECRET || 'jwt_secret',
      { expiresIn: '24h' },
      (err, token) => {
        if (err) throw err;
        res.json({ token });
      }
    );
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   GET api/auth
// @desc    Get admin user
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, username, created_at FROM admins WHERE id = ?',
      [req.admin.id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ msg: 'Admin not found' });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

module.exports = router;