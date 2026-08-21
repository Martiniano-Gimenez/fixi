const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/env');
const prisma = require('../lib/prisma');

/**
 * Middleware de autenticación.
 * Verifica el JWT del header Authorization: Bearer <token>
 * y comprueba que el organizador exista en la base de datos.
 */
async function auth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token no proporcionado.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const organizador = await prisma.organizador.findUnique({
      where: { id: payload.id },
      select: { id: true, email: true, nombre: true },
    });

    if (!organizador) {
      return res.status(401).json({ error: 'Usuario no encontrado o sesión expirada. Iniciá sesión nuevamente.' });
    }

    req.organizadorId = organizador.id;
    req.organizador = organizador;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado.' });
  }
}

module.exports = auth;
