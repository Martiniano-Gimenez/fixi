const express = require('express');
const router = express.Router();

// Ticket 5.1 — Vista pública sin auth
router.get('/:slug', (req, res) => {
  res.status(501).json({ error: 'No implementado todavía.' });
});

module.exports = router;
