const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const { JWT_SECRET } = require('../config/env');

async function register({ email, password, nombre }) {
  if (!email || !password || !nombre) {
    const error = new Error('Faltan campos requeridos (email, password, nombre).');
    error.statusCode = 400;
    throw error;
  }

  // Verificar si ya existe
  const existente = await prisma.organizador.findUnique({ where: { email } });
  if (existente) {
    const error = new Error('El email ya está registrado.');
    error.statusCode = 409;
    throw error;
  }

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);

  const organizador = await prisma.organizador.create({
    data: {
      email,
      passwordHash,
      nombre,
    },
  });

  const token = jwt.sign({ id: organizador.id }, JWT_SECRET, { expiresIn: '7d' });

  return {
    organizador: {
      id: organizador.id,
      email: organizador.email,
      nombre: organizador.nombre,
    },
    token,
  };
}

async function login({ email, password }) {
  if (!email || !password) {
    const error = new Error('Faltan campos requeridos (email, password).');
    error.statusCode = 400;
    throw error;
  }

  const organizador = await prisma.organizador.findUnique({ where: { email } });
  if (!organizador) {
    const error = new Error('Credenciales inválidas.');
    error.statusCode = 401;
    throw error;
  }

  const passwordValida = await bcrypt.compare(password, organizador.passwordHash);
  if (!passwordValida) {
    const error = new Error('Credenciales inválidas.');
    error.statusCode = 401;
    throw error;
  }

  const token = jwt.sign({ id: organizador.id }, JWT_SECRET, { expiresIn: '7d' });

  return {
    organizador: {
      id: organizador.id,
      email: organizador.email,
      nombre: organizador.nombre,
    },
    token,
  };
}

module.exports = {
  register,
  login,
};
