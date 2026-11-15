/**
 * Middleware centralizado de manejo de errores.
 * Captura cualquier error lanzado en controllers/services y devuelve JSON.
 */
function errorHandler(err, req, res, _next) {
  console.error('Error:', err);

  // El parser adjunta el cuerpo y mensajes técnicos: nunca se devuelven al cliente.
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'El cuerpo del pedido no es un JSON válido.' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'El pedido es demasiado grande.' });
  }
  if (typeof err.type === 'string' && Number.isInteger(err.status) && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ error: 'No se pudo procesar el cuerpo del pedido.' });
  }

  // Errores de validación de Prisma
  if (err.code === 'P2002') {
    return res.status(409).json({
      error: 'Ya existe un registro con esos datos.',
    });
  }

  if (err.code === 'P2025') {
    return res.status(404).json({
      error: 'Registro no encontrado.',
    });
  }

  // Errores con statusCode explícito (lanzados desde services)
  // `codigo` (opcional) le dice al cliente qué pasó sin que tenga que leer el mensaje
  if (Number.isInteger(err.statusCode) && err.statusCode >= 400 && err.statusCode < 500) {
    const body = { error: err.message || 'Error interno del servidor.' };
    if (err.codigo) body.codigo = err.codigo;
    return res.status(err.statusCode).json(body);
  }

  return res.status(500).json({ error: 'Ocurrió un error inesperado. Probá de nuevo.' });
}

module.exports = errorHandler;
