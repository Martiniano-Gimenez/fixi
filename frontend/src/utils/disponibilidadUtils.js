/**
 * disponibilidadUtils.js
 * Funciones puras para manipulación y conversión entre rangos de slider y listas de slots.
 */

/**
 * Reconstruye rangos { id, startIdx, endIdx } a partir de una lista de slotIds para un día dado.
 *
 * Regla de compatibilidad con datos legacy:
 * Si un slot guardado está aislado (no tiene ningún vecino a +-15 min en la grilla del día),
 * se considera del formato viejo de 75 min (donde solo se guardaba el slot inicial del partido)
 * y se expande a 5 turnos de 15 min (offset 0..4).
 * Si un slot forma parte de una secuencia contigua (tiene al menos un vecino a +-15 min),
 * NO se expande hacia adelante, garantizando que rangos -> slots -> rangos sea estrictamente idempotente.
 *
 * @param {string[]} slotsGuardados - Array de slotIds (ej. ['Viernes-12:00', ...])
 * @param {string[]} slotsDisponiblesDia - Grilla completa ordenada del día (ej. ['Viernes-12:00', ...])
 * @param {string} dia - Nombre del día (ej. 'Viernes' o 'Sabado')
 * @returns {Array<{ id: string, startIdx: number, endIdx: number }>}
 */
export function reconstruirRangos(slotsGuardados, slotsDisponiblesDia, dia) {
  if (!slotsDisponiblesDia || slotsDisponiblesDia.length === 0) return [];
  const guardadosDia = (slotsGuardados || []).filter((s) => s && s.startsWith(dia + '-'));
  if (guardadosDia.length === 0) return [];

  const slotsMap = new Map();
  slotsDisponiblesDia.forEach((s, idx) => slotsMap.set(s, idx));

  // Identificar qué índices válidos existen en la grilla para este día
  const indicesGuardados = new Set();
  for (const sId of guardadosDia) {
    const idx = slotsMap.get(sId);
    if (idx !== undefined) {
      indicesGuardados.add(idx);
    }
  }

  if (indicesGuardados.size === 0) return [];

  // Detectar si el día contiene turnos contiguos (formato moderno de rangos).
  // Si ya existen turnos contiguos en el día, los rangos son la fuente de verdad y ningún slot debe expandirse.
  // Solo se expande si TODOS los slots del día están aislados (formato legado donde cada slot representaba 75 min).
  let tieneContiguosEnElDia = false;
  for (const idx of indicesGuardados) {
    if (indicesGuardados.has(idx + 1)) {
      tieneContiguosEnElDia = true;
      break;
    }
  }

  const indicesExpandidos = new Set();
  for (const idx of indicesGuardados) {
    indicesExpandidos.add(idx);
    if (!tieneContiguosEnElDia) {
      for (let offset = 1; offset <= 4; offset++) {
        const targetIdx = idx + offset;
        if (targetIdx < slotsDisponiblesDia.length) {
          indicesExpandidos.add(targetIdx);
        }
      }
    }
  }

  const sorted = Array.from(indicesExpandidos).sort((a, b) => a - b);
  const result = [];
  let curStart = sorted[0];
  let curEnd = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    if (next === curEnd + 1) {
      curEnd = next;
    } else {
      result.push({
        id: `rango-${curStart}-${curEnd}-${Math.random().toString(36).substr(2, 5)}`,
        startIdx: curStart,
        endIdx: curEnd,
      });
      curStart = next;
      curEnd = next;
    }
  }
  result.push({
    id: `rango-${curStart}-${curEnd}-${Math.random().toString(36).substr(2, 5)}`,
    startIdx: curStart,
    endIdx: curEnd,
  });

  return result;
}

/**
 * Convierte los rangos de Viernes y Sábado en una lista plana de slotIds únicos.
 *
 * @param {Array<{ startIdx: number, endIdx: number }>} rangosViernes
 * @param {string[]} grillaViernes
 * @param {Array<{ startIdx: number, endIdx: number }>} [rangosSabado=[]]
 * @param {string[]} [grillaSabado=[]]
 * @returns {string[]}
 */
export function rangosASlots(rangosViernes, grillaViernes, rangosSabado = [], grillaSabado = []) {
  const result = new Set();
  (rangosViernes || []).forEach((r) => {
    for (let i = r.startIdx; i <= r.endIdx; i++) {
      if (grillaViernes && grillaViernes[i]) result.add(grillaViernes[i]);
    }
  });
  (rangosSabado || []).forEach((r) => {
    for (let i = r.startIdx; i <= r.endIdx; i++) {
      if (grillaSabado && grillaSabado[i]) result.add(grillaSabado[i]);
    }
  });
  return Array.from(result);
}

/**
 * Compara dos arrays de slotIds por contenido (independiente del orden de inserción).
 *
 * @param {string[]} arrA
 * @param {string[]} arrB
 * @returns {boolean}
 */
export function areSlotArraysEqual(arrA, arrB) {
  if (!Array.isArray(arrA) || !Array.isArray(arrB)) return false;
  if (arrA.length !== arrB.length) return false;
  const setA = new Set(arrA);
  return arrB.every((item) => setA.has(item));
}

/**
 * Agrupa slotIds consecutivos para visualización legible en modo solo lectura.
 *
 * @param {string[]} slotIdsDelDia
 * @param {string[]} grillaDelDia
 * @returns {string} Texto descriptivo (ej. "12:00 a 16:00, 18:00 a 20:00" o "No disponible")
 */
export function agruparSlotsEnRangos(slotIdsDelDia, grillaDelDia = []) {
  if (!slotIdsDelDia || slotIdsDelDia.length === 0) {
    return 'No disponible';
  }

  const slotsSet = new Set(slotIdsDelDia);
  let sortedSlots = [];

  if (grillaDelDia.length > 0) {
    sortedSlots = grillaDelDia.filter((s) => slotsSet.has(s));
    const enGrillaSet = new Set(sortedSlots);
    for (const s of slotIdsDelDia) {
      if (!enGrillaSet.has(s)) sortedSlots.push(s);
    }
  } else {
    sortedSlots = [...slotIdsDelDia].sort((a, b) => {
      const hA = a.split('-')[1] || '';
      const hB = b.split('-')[1] || '';
      return hA.localeCompare(hB);
    });
  }

  if (sortedSlots.length === 0) return 'No disponible';

  const parseMin = (slotId) => {
    const hora = slotId.split('-')[1] || '';
    const [h, m] = hora.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };

  const rangos = [];
  let rangoStart = sortedSlots[0];
  let rangoEnd = sortedSlots[0];

  for (let i = 1; i < sortedSlots.length; i++) {
    const prev = sortedSlots[i - 1];
    const curr = sortedSlots[i];

    let esConsecutivo = false;
    if (grillaDelDia.length > 0) {
      const idxPrev = grillaDelDia.indexOf(prev);
      const idxCurr = grillaDelDia.indexOf(curr);
      if (idxPrev !== -1 && idxCurr === idxPrev + 1) {
        esConsecutivo = true;
      }
    } else {
      const minPrev = parseMin(prev);
      const minCurr = parseMin(curr);
      if (minCurr === minPrev + 15) {
        esConsecutivo = true;
      }
    }

    if (esConsecutivo) {
      rangoEnd = curr;
    } else {
      rangos.push({ start: rangoStart, end: rangoEnd });
      rangoStart = curr;
      rangoEnd = curr;
    }
  }
  rangos.push({ start: rangoStart, end: rangoEnd });

  return rangos
    .map((r) => {
      const hStart = r.start.split('-')[1] || '';
      const hEnd = r.end.split('-')[1] || '';
      return hStart === hEnd ? hStart : `${hStart} a ${hEnd}`;
    })
    .join(', ');
}
