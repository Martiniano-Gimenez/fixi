/**
 * Middleware centralizado de manejo de errores.
 * Captura cualquier error lanzado en controllers/services y devuelve JSON.
 */
function errorHandler(err, req, res, _next) {
  console.error('❌ Error:', err.message);

  // Errores de validación de Prisma
  if (err.code === 'P2002') {
    return res.status(409).json({
      error: 'Ya existe un registro con esos datos únicos.',
      detail: err.meta?.target,
    });
  }

  if (err.code === 'P2025') {
    return res.status(404).json({
      error: 'Registro no encontrado.',
    });
  }

  // Errores con statusCode explícito (lanzados desde services)
  // `codigo` (opcional) le dice al cliente qué pasó sin que tenga que leer el mensaje
  const statusCode = err.statusCode || 500;
  const body = { error: err.message || 'Error interno del servidor.' };
  if (err.codigo) body.codigo = err.codigo;
  res.status(statusCode).json(body);
}

module.exports = errorHandler;
