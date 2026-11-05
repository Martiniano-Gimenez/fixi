/**
 * canchasOverrides.service.js
 * 
 * Servicio para gestión y persistencia de overrides de canchas por día (Modo Lluvia).
 * Fuente única de verdad: tabla `OverrideCanchasDia` en base de datos.
 * 
 * NOTA DE ARQUITECTURA:
 * Asume una sola instancia de proceso (single instance deployment) para Render/Railway.
 * La caché en memoria se hidrata al arrancar el servidor mediante `loadFromDb()`.
 * Las lecturas son síncronas para preservar rendimiento y firmas existentes.
 * Las mutaciones de caché en memoria pasan EXCLUSIVAMENTE por `applyCacheMutation()`
 * y se invocan post-commit tras transacciones exitosas de Prisma.
 */

const prisma = require('../lib/prisma');

// Caché en memoria para acceso ultrarrápido y lecturas síncronas
let memoryCache = null;

function assertCacheLoaded() {
  if (memoryCache === null) {
    throw new Error(
      '[canchasOverrides] La caché en memoria no ha sido inicializada. Debe completarse `await canchasOverridesService.loadFromDb()` antes de leer.'
    );
  }
}

/**
 * Hidrata la caché en memoria desde la tabla `OverrideCanchasDia` de la base de datos.
 * Debe invocarse al inicio del servidor antes de comenzar a escuchar peticiones.
 */
async function loadFromDb() {
  const records = await prisma.overrideCanchasDia.findMany();
  const nextCache = {};

  for (const r of records) {
    if (!nextCache[r.torneoId]) {
      nextCache[r.torneoId] = {};
    }

    let parsedPartidos = {};
    if (r.partidosSinSlot) {
      if (typeof r.partidosSinSlot === 'string') {
        try {
          parsedPartidos = JSON.parse(r.partidosSinSlot);
        } catch {
          parsedPartidos = {};
        }
      } else if (typeof r.partidosSinSlot === 'object') {
        parsedPartidos = r.partidosSinSlot;
      }
    }

    nextCache[r.torneoId][r.diaKey] = {
      canchas: Number(r.canchas),
      isLluvia: Boolean(r.isLluvia),
      activoDesde: r.activoDesde ? new Date(r.activoDesde).toISOString() : null,
      partidosSinSlot: parsedPartidos,
    };
  }

  memoryCache = nextCache;
  return memoryCache;
}

/**
 * Limpia la caché en memoria (utilizado para pruebas de reinicio/recuperación).
 */
function clearMemoryCache() {
  memoryCache = null;
}

/**
 * Aplica una mutación a la memoria caché local.
 * ÚNICA puerta de entrada para mutaciones de memoria caché (invocada solo post-commit o fuera de tx).
 * @param {'SET' | 'REMOVE' | 'CLEAR'} action 
 * @param {object} payload 
 */
function applyCacheMutation(action, payload = {}) {
  assertCacheLoaded();

  const { torneoId, diaKey, canchas, isLluvia, activoDesde, partidosSinSlot } = payload;

  if (action === 'SET') {
    if (!torneoId || !diaKey) return;
    if (!memoryCache[torneoId]) {
      memoryCache[torneoId] = {};
    }
    memoryCache[torneoId][diaKey] = {
      canchas: Number(canchas),
      isLluvia: isLluvia !== undefined ? Boolean(isLluvia) : true,
      activoDesde: activoDesde ? new Date(activoDesde).toISOString() : new Date().toISOString(),
      partidosSinSlot: partidosSinSlot || {},
    };
  } else if (action === 'REMOVE') {
    if (!torneoId || !diaKey) return;
    if (memoryCache[torneoId] && memoryCache[torneoId][diaKey]) {
      delete memoryCache[torneoId][diaKey];
      if (Object.keys(memoryCache[torneoId]).length === 0) {
        delete memoryCache[torneoId];
      }
    }
  } else if (action === 'CLEAR') {
    if (!torneoId) return;
    if (memoryCache[torneoId]) {
      delete memoryCache[torneoId];
    }
  }
}

/**
 * Obtiene todos los overrides de un torneo: { [diaKey]: { canchas, isLluvia, activoDesde, partidosSinSlot } }
 * @throws {Error} si la caché no ha sido hidratada previamente con loadFromDb().
 */
function getOverridesTorneo(torneoId) {
  assertCacheLoaded();
  if (!torneoId) return {};
  return memoryCache[torneoId] || {};
}

/**
 * Obtiene la cantidad de canchas activas y estado de lluvia para un torneo y un día específico.
 * @throws {Error} si la caché no ha sido hidratada previamente con loadFromDb().
 */
function getCanchasDia(torneoId, diaKey, defaultCanchasClub) {
  assertCacheLoaded();
  if (!torneoId || !diaKey) {
    return { canchas: defaultCanchasClub, isLluvia: false, activoDesde: null, partidosSinSlot: {} };
  }
  const torneoOverrides = getOverridesTorneo(torneoId);
  const diaOverride = torneoOverrides[diaKey];
  if (diaOverride && diaOverride.canchas) {
    return {
      canchas: Number(diaOverride.canchas),
      isLluvia: Boolean(diaOverride.isLluvia),
      activoDesde: diaOverride.activoDesde || null,
      partidosSinSlot: diaOverride.partidosSinSlot || {},
    };
  }
  return {
    canchas: defaultCanchasClub,
    isLluvia: false,
    activoDesde: null,
    partidosSinSlot: {},
  };
}

/**
 * Registra o actualiza la reducción de canchas para un día específico del torneo en DB.
 * Si se pasa `tx`, la operación se realiza dentro de la transacción y NO muta la caché (el llamador
 * debe invocar `applyCacheMutation` post-commit). Si no se pasa `tx`, ejecuta en DB y aplica la mutación DESPUÉS del éxito.
 * `horariosAntesLluvia` (opcional) se guarda solo si viene: una segunda reducción el mismo día no lo pisa.
 */
async function setOverrideDia(torneoId, diaKey, canchas, activoDesde = null, partidosSinSlot = {}, tx = null, horariosAntesLluvia = undefined) {
  if (!torneoId || !diaKey) return null;

  const client = tx || prisma;
  const fechaActivo = activoDesde ? new Date(activoDesde) : new Date();

  await client.overrideCanchasDia.upsert({
    where: {
      torneoId_diaKey: {
        torneoId,
        diaKey,
      },
    },
    create: {
      torneoId,
      diaKey,
      canchas: Number(canchas),
      isLluvia: true,
      activoDesde: fechaActivo,
      partidosSinSlot: partidosSinSlot || {},
      ...(horariosAntesLluvia !== undefined ? { horariosAntesLluvia } : {}),
    },
    update: {
      canchas: Number(canchas),
      isLluvia: true,
      activoDesde: fechaActivo,
      partidosSinSlot: partidosSinSlot || {},
      ...(horariosAntesLluvia !== undefined ? { horariosAntesLluvia } : {}),
    },
  });

  const mutation = {
    action: 'SET',
    payload: {
      torneoId,
      diaKey,
      canchas: Number(canchas),
      isLluvia: true,
      activoDesde: fechaActivo.toISOString(),
      partidosSinSlot: partidosSinSlot || {},
    },
  };

  // Si se ejecuta fuera de transacción, aplicar mutación a la caché DESPUÉS del commit exitoso en DB
  if (!tx) {
    applyCacheMutation(mutation.action, mutation.payload);
  }

  return mutation;
}

/**
 * Elimina el override de un día específico en DB.
 * Si se pasa `tx`, se ejecuta dentro de la transacción sin mutar la caché.
 */
async function removeOverrideDia(torneoId, diaKey, tx = null) {
  if (!torneoId || !diaKey) return null;

  const client = tx || prisma;
  await client.overrideCanchasDia.deleteMany({
    where: {
      torneoId,
      diaKey,
    },
  });

  const mutation = {
    action: 'REMOVE',
    payload: { torneoId, diaKey },
  };

  if (!tx) {
    applyCacheMutation(mutation.action, mutation.payload);
  }

  return mutation;
}

/**
 * Limpia todos los overrides de un torneo en DB.
 * Si se pasa `tx`, se ejecuta dentro de la transacción sin mutar la caché.
 */
async function clearOverridesTorneo(torneoId, tx = null) {
  if (!torneoId) return null;

  const client = tx || prisma;
  await client.overrideCanchasDia.deleteMany({
    where: {
      torneoId,
    },
  });

  const mutation = {
    action: 'CLEAR',
    payload: { torneoId },
  };

  if (!tx) {
    applyCacheMutation(mutation.action, mutation.payload);
  }

  return mutation;
}

module.exports = {
  getOverridesTorneo,
  getCanchasDia,
  setOverrideDia,
  removeOverrideDia,
  clearOverridesTorneo,
  loadFromDb,
  clearMemoryCache,
  applyCacheMutation,
};
