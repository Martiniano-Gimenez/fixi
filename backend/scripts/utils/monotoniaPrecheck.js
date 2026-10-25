'use strict';

/**
 * monotoniaPrecheck.js
 * Regla de monotonía del pre-check (R2), compartida por test-fuzz-scheduler.js y
 * test-precheck-monotonia.js.
 *
 * Al resolver un conflicto, el contador puede subir porque cuenta partidos: destrabar una zona
 * manual convierte 1 conflicto de zona en los partidos de esa zona que no consiguen lugar, y
 * resolver P1/P2 de un mini-bracket hace que P3/P4 empiecen a contar. Un paso de resolución
 * falla solo si:
 *   - sube el conteo de alguna zona distinta de la resuelta (zona por zona, no la suma);
 *   - sube el conteo de alguna categoría sin contar la zona resuelta;
 *   - la zona resuelta sube y alguno de sus ítems nuevos no es un partido sin horario.
 */

/** Motivos de un partido sin horario que explican una suba en la zona resuelta. */
const MOTIVOS_PARTIDO_SIN_HORARIO = new Set(['SIN_CANCHA_DISPONIBLE', 'PARTIDO_SIN_HORARIO']);

/** Clave de zona de un ítem de conflicto: "categoriaId:zonaId" (o el nombre si no hay id). */
function claveZona(item) {
  return `${item.categoriaId}:${item.zonaId || item.zona || 'UNKNOWN'}`;
}

/**
 * Conflictos base del pre-check: todos los ítems menos P3/P4 de un mini-bracket cuyo P1 o P2
 * no tiene horario (dependen de ellos y no son un conflicto propio).
 */
function obtenerConflictosBase(preCheck, session) {
  const derivedMatchIds = new Set();
  if (session && Array.isArray(session.categoriasPlan)) {
    for (const cPlan of session.categoriasPlan) {
      for (const z of cPlan.zonas || []) {
        if (z.formato !== 'MINI_BRACKET') continue;
        const p1 = (z.partidos || []).find((p) => p.posicionEnRonda === 1);
        const p2 = (z.partidos || []).find((p) => p.posicionEnRonda === 2);
        const p1SinHorario = !p1 || !p1.fechaHora || p1.sinHorarioAsignado;
        const p2SinHorario = !p2 || !p2.fechaHora || p2.sinHorarioAsignado;
        if (p1SinHorario || p2SinHorario) {
          for (const p of z.partidos || []) {
            if (p.posicionEnRonda >= 3 && p.id) {
              derivedMatchIds.add(p.id);
            }
          }
        }
      }
    }
  }

  const baseList = [];
  for (const catConf of preCheck.conflictos || []) {
    for (const item of catConf.partidosSinHorario || []) {
      if (derivedMatchIds.has(item.partidoId)) continue;
      baseList.push(item);
    }
  }
  return baseList;
}

function contarPor(items, claveFn) {
  const m = new Map();
  for (const it of items) {
    const k = claveFn(it);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

/**
 * Clasifica un paso de resolución del pre-check.
 * @param {object} args
 * @param {Array} args.antes conflictos base antes del paso
 * @param {Array} args.despues conflictos base después del paso
 * @param {string} args.zonaObjetivo clave (claveZona) de la zona del conflicto resuelto
 */
function clasificarPasoMonotonia({ antes, despues, zonaObjetivo }) {
  const porZonaAntes = contarPor(antes, claveZona);
  const porZonaDespues = contarPor(despues, claveZona);

  // Otras zonas: ninguna puede subir.
  const zonasQueSuben = [];
  for (const [zona, n] of porZonaDespues.entries()) {
    if (zona === zonaObjetivo) continue;
    const a = porZonaAntes.get(zona) || 0;
    if (n > a) zonasQueSuben.push({ zona, antes: a, despues: n });
  }

  // Categorías, sin contar la zona objetivo: ninguna puede subir.
  const fueraDeObjetivo = (it) => claveZona(it) !== zonaObjetivo;
  const porCatAntes = contarPor(antes.filter(fueraDeObjetivo), (it) => it.categoriaId);
  const porCatDespues = contarPor(despues.filter(fueraDeObjetivo), (it) => it.categoriaId);
  const categoriasQueSuben = [];
  for (const [categoriaId, n] of porCatDespues.entries()) {
    const a = porCatAntes.get(categoriaId) || 0;
    if (n > a) categoriasQueSuben.push({ categoriaId, antes: a, despues: n });
  }

  // Zona objetivo: si sube, sus ítems nuevos tienen que ser partidos sin horario.
  const zonaAntes = porZonaAntes.get(zonaObjetivo) || 0;
  const zonaDespues = porZonaDespues.get(zonaObjetivo) || 0;
  const deltaZona = zonaDespues - zonaAntes;
  const idsAntes = new Set(antes.map((it) => it.partidoId));
  const itemsNuevosZona = despues.filter((it) => claveZona(it) === zonaObjetivo && !idsAntes.has(it.partidoId));
  const itemsNoExplicados =
    deltaZona > 0 ? itemsNuevosZona.filter((it) => !MOTIVOS_PARTIDO_SIN_HORARIO.has(it.motivo)) : [];

  const violaciones = [];
  if (zonasQueSuben.length > 0) violaciones.push('OTRA_ZONA_SUBE');
  if (categoriasQueSuben.length > 0) violaciones.push('OTRA_CATEGORIA_SUBE');
  if (itemsNoExplicados.length > 0) violaciones.push('ZONA_OBJETIVO_NO_EXPLICADA');

  return {
    ok: violaciones.length === 0,
    violaciones,
    deltaTotal: despues.length - antes.length,
    deltaZona,
    zonasQueSuben,
    categoriasQueSuben,
    itemsNuevosZona,
    itemsNoExplicados: itemsNoExplicados.map((it) => ({ partidoId: it.partidoId, motivo: it.motivo })),
  };
}

module.exports = {
  MOTIVOS_PARTIDO_SIN_HORARIO,
  claveZona,
  obtenerConflictosBase,
  clasificarPasoMonotonia,
};
