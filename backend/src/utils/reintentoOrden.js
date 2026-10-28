/**
 * Reintento acotado de las altas de Pareja ante un choque de @@unique([categoriaId, orden]).
 *
 * Las altas asignan `orden = max(orden) + 1`. Dos altas simultáneas pueden leer el mismo máximo;
 * la segunda choca con P2002. Un P2002 dentro de una transacción interactiva la aborta, así que
 * `fn` tiene que ser la operación entera (la transacción completa, no solo el create): cada
 * intento vuelve a leer el máximo desde cero.
 */

const INTENTOS_ORDEN = 3;
const INDICE_ORDEN = 'Pareja_categoriaId_orden_key';

// Prisma informa el target como arreglo de campos (['categoriaId', 'orden']) o como nombre del
// índice ('Pareja_categoriaId_orden_key'), según el motor y la versión.
function esChoqueDeOrden(err) {
  if (!err || err.code !== 'P2002') return false;
  const target = err.meta?.target;
  if (Array.isArray(target)) return target.includes('categoriaId') && target.includes('orden');
  if (typeof target === 'string') return target === INDICE_ORDEN;
  return false;
}

async function conReintentoOrden(fn, intentos = INTENTOS_ORDEN) {
  for (let intento = 1; ; intento++) {
    try {
      return await fn();
    } catch (err) {
      if (!esChoqueDeOrden(err)) throw err;
      if (intento >= intentos) {
        const error = new Error('Hubo varias altas al mismo tiempo y no se pudo asignar el número de la pareja. Probá de nuevo.');
        error.statusCode = 409;
        error.codigo = 'ORDEN_OCUPADO';
        throw error;
      }
    }
  }
}

module.exports = { conReintentoOrden, esChoqueDeOrden, INTENTOS_ORDEN, INDICE_ORDEN };
