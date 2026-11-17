const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { limitesAuth } = require('../middlewares/limitesAuth');

router.post('/register', limitesAuth.limitarRegistro, authController.register);
router.post('/login', limitesAuth.limitarLogin, authController.login);

module.exports = router;
