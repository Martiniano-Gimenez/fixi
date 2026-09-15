const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'canchasOverrides.json');

// In-memory cache for ultra-fast access
let memoryCache = null;

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({}, null, 2), 'utf8');
  }
}

function loadOverrides() {
  if (memoryCache !== null) {
    return memoryCache;
  }
  try {
    ensureDataFile();
    const content = fs.readFileSync(DATA_FILE, 'utf8');
    memoryCache = JSON.parse(content || '{}');
  } catch (err) {
    console.error('[canchasOverrides] Error reading overrides file, resetting cache:', err.message);
    memoryCache = {};
  }
  return memoryCache;
}

function saveOverrides(data) {
  memoryCache = data;
  try {
    ensureDataFile();
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[canchasOverrides] Error writing overrides file:', err.message);
  }
}

/**
 * Obtiene todos los overrides de un torneo: { [diaKey]: { canchas: number, isLluvia: boolean, activoDesde: string } }
 */
function getOverridesTorneo(torneoId) {
  if (!torneoId) return {};
  const all = loadOverrides();
  return all[torneoId] || {};
}

/**
 * Obtiene la cantidad de canchas activas y estado de lluvia para un torneo y un día específico.
 */
function getCanchasDia(torneoId, diaKey, defaultCanchasClub) {
  if (!torneoId || !diaKey) {
    return { canchas: defaultCanchasClub, isLluvia: false, activoDesde: null };
  }
  const torneoOverrides = getOverridesTorneo(torneoId);
  const diaOverride = torneoOverrides[diaKey];
  if (diaOverride && diaOverride.canchas) {
    return {
      canchas: Number(diaOverride.canchas),
      isLluvia: Boolean(diaOverride.isLluvia),
      activoDesde: diaOverride.activoDesde || null,
    };
  }
  return {
    canchas: defaultCanchasClub,
    isLluvia: false,
    activoDesde: null,
  };
}

/**
 * Registra o actualiza la reducción de canchas para un día específico del torneo.
 */
function setOverrideDia(torneoId, diaKey, canchas, activoDesde = null) {
  if (!torneoId || !diaKey) return;
  const all = loadOverrides();
  if (!all[torneoId]) {
    all[torneoId] = {};
  }
  all[torneoId][diaKey] = {
    canchas: Number(canchas),
    isLluvia: true,
    activoDesde: activoDesde ? new Date(activoDesde).toISOString() : new Date().toISOString(),
  };
  saveOverrides(all);
}

/**
 * Elimina el override de un día específico (restauración de canchas al total del club).
 */
function removeOverrideDia(torneoId, diaKey) {
  if (!torneoId || !diaKey) return;
  const all = loadOverrides();
  if (all[torneoId] && all[torneoId][diaKey]) {
    delete all[torneoId][diaKey];
    if (Object.keys(all[torneoId]).length === 0) {
      delete all[torneoId];
    }
    saveOverrides(all);
  }
}

/**
 * Limpia todos los overrides de un torneo (ej. al reiniciar torneo).
 */
function clearOverridesTorneo(torneoId) {
  if (!torneoId) return;
  const all = loadOverrides();
  if (all[torneoId]) {
    delete all[torneoId];
    saveOverrides(all);
  }
}

module.exports = {
  getOverridesTorneo,
  getCanchasDia,
  setOverrideDia,
  removeOverrideDia,
  clearOverridesTorneo,
};
