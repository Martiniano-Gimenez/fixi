const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const { JWT_SECRET } = require('../config/env');

// Mismo costo que los hashes del registro, sin generar uno nuevo en cada login inexistente.
const HASH_FICTICIO = '$2b$10$drcwIP0/7P/4Z3ErfUeTAuGMiYww11Kl44Rdj2KWU9d331QK1qcVm';
const normalizarEmail = email => typeof email === 'string' ? email.trim().toLowerCase() : '';

function rechazar(mensaje, statusCode = 400) {
  const error = new Error(mensaje);
  error.statusCode = statusCode;
  throw error;
}

function emailValido(email) {
  const partes = email.split('@');
  if (email.length > 254 || partes.length !== 2) return false;
  const [local, dominio] = partes;
  if (!local || local.length > 64 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)
    || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  const etiquetas = dominio.split('.');
  return etiquetas.length >= 2 && etiquetas.every(e => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(e));
}

async function register(data) {
  const { email, password, nombre } = data || {};
  if (typeof email !== 'string') rechazar('El email debe ser un texto válido.');
  const emailNormalizado = normalizarEmail(email);
  if (!emailValido(emailNormalizado)) rechazar('Escribí un email válido de hasta 254 caracteres.');
  if (typeof password !== 'string') rechazar('La contraseña debe ser un texto de 8 a 72 caracteres.');
  const largoPassword = [...password].length;
  if (largoPassword < 8 || largoPassword > 72) rechazar('La contraseña debe tener entre 8 y 72 caracteres.');
  if (Buffer.byteLength(password, 'utf8') > 72) rechazar('La contraseña no puede superar los 72 bytes en UTF-8. Usá menos caracteres.');
  if (typeof nombre !== 'string') rechazar('El nombre debe ser un texto de 2 a 80 caracteres.');
  const nombreLimpio = nombre.trim();
  if ([...nombreLimpio].length < 2 || [...nombreLimpio].length > 80) rechazar('El nombre debe tener entre 2 y 80 caracteres, sin contar los espacios de los bordes.');

  // Evitar también duplicar una cuenta antigua guardada con mayúsculas, sin modificarla.
  const existente = await prisma.organizador.findUnique({ where: { email: emailNormalizado }, select: { id: true } })
    || (await prisma.$queryRaw`SELECT id FROM "Organizador" WHERE LOWER(TRIM(email)) = ${emailNormalizado} LIMIT 1`)[0];
  if (existente) {
    const error = new Error('El email ya está registrado.');
    error.statusCode = 409;
    throw error;
  }

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);

  const organizador = await prisma.organizador.create({
    data: {
      email: emailNormalizado,
      passwordHash,
      nombre: nombreLimpio,
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

async function login(data) {
  const { email, password } = data || {};
  if (typeof email !== 'string' || typeof password !== 'string') rechazar('El email y la contraseña deben ser textos.');
  const emailOriginal = email.trim();
  const emailNormalizado = normalizarEmail(email);
  if (!emailOriginal || !password) rechazar('Escribí tu email y contraseña.');

  let organizador = await prisma.organizador.findUnique({ where: { email: emailNormalizado } });
  if (!organizador && emailOriginal !== emailNormalizado) {
    organizador = await prisma.organizador.findUnique({ where: { email: emailOriginal } });
  }

  const passwordValida = await bcrypt.compare(password, organizador?.passwordHash || HASH_FICTICIO);
  if (!organizador || !passwordValida) {
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
  normalizarEmail,
};
