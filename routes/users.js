const express = require('express');
const router = express.Router();
const db = require('../config/db');
const auth = require('../middleware/auth');

// @route   GET api/users
// @desc    Get all users (for admin)
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    // Only admins should access this
    const [users] = await db.query('SELECT id, username, created_at FROM users');
    res.json(users);
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).send('Server error');
  }
});

// Add other user-related routes as needed

module.exports = router;