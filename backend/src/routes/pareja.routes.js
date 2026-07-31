const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const parejaController = require('../controllers/pareja.controller');

router.use(auth);

router.patch('/:id', parejaController.updatePareja);
router.delete('/:id', parejaController.deletePareja);

module.exports = router;
