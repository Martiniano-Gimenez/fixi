/**
 * Middleware centralizado de manejo de errores.
 * Captura cualquier error lanzado en controllers/services y devuelve JSON.
 */
function errorHandler(err, req, res, _next) {
  const unaLinea = (texto) => String(texto).replace(/[\r\n]/g, ' ');
  const metodo = unaLinea(req.method);
  const ruta = unaLinea((req.originalUrl || req.url || '').split('?')[0]);
  const registrarEsperado = (status, mensaje) => console.error(`[${status}] ${metodo} ${ruta}: ${unaLinea(mensaje)}`);
  const errorParser = (status, mensaje) => {
    console.error(`[${status}] parser ${unaLinea(err.type)}`);
    return res.status(status).json({ error: mensaje });
  };

  // El parser adjunta el cuerpo y mensajes técnicos: nunca se devuelven al cliente.
  if (err.type === 'entity.parse.failed') {
    return errorParser(400, 'El cuerpo del pedido no es un JSON válido.');
  }
  if (err.type === 'entity.too.large') {
    return errorParser(413, 'El pedido es demasiado grande.');
  }
  if (typeof err.type === 'string' && Number.isInteger(err.status) && err.status >= 400 && err.status < 500) {
    return errorParser(err.status, 'No se pudo procesar el cuerpo del pedido.');
  }

  // Errores de validación de Prisma
  if (err.code === 'P2002') {
    registrarEsperado(409, 'Ya existe un registro con esos datos.');
    return res.status(409).json({
      error: 'Ya existe un registro con esos datos.',
    });
  }

  if (err.code === 'P2025') {
    registrarEsperado(404, 'Registro no encontrado.');
    return res.status(404).json({
      error: 'Registro no encontrado.',
    });
  }

  // Errores con statusCode explícito (lanzados desde services)
  // `codigo` (opcional) le dice al cliente qué pasó sin que tenga que leer el mensaje
  if (Number.isInteger(err.statusCode) && ((err.statusCode >= 400 && err.statusCode < 500) || err.statusCode === 503)) {
    const body = { error: err.message || 'Error interno del servidor.' };
    if (err.codigo) body.codigo = err.codigo;
    registrarEsperado(err.statusCode, body.error);
    return res.status(err.statusCode).json(body);
  }

  // Solo campos de diagnóstico: nunca se registra el objeto, body, headers ni la query.
  const diagnostico = [`[500] ${metodo} ${ruta}`, `Nombre: ${err.name || 'Error'}`, `Mensaje: ${err.message || ''}`];
  if (err.code) diagnostico.push(`Code: ${err.code}`);
  if (typeof err.stack === 'string') diagnostico.push(err.stack);
  console.error(diagnostico.join('\n'));
  return res.status(500).json({ error: 'Ocurrió un error inesperado. Probá de nuevo.' });
}

module.exports = errorHandler;
