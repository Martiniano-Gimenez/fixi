'use strict';

const { DURACION_PARTIDO_MIN } = require('../services/slots.service');

const DURACION_MS = DURACION_PARTIDO_MIN * 60 * 1000;

/**
 * Constantes de descanso mínimo requerido entre fases de eliminatorias.
 * Única fuente canónica para cálculo de descansos.
 */
const REST_CONSTANTS = Object.freeze({
  MIN_REST_R32_OCTAVOS_MS: DURACION_MS, // 75 min
  MIN_REST_OCTAVOS_CUARTOS_MS: DURACION_MS, // 75 min
  MIN_REST_CUARTOS_SEMIS_MS: DURACION_MS, // 75 min
  MIN_REST_SEMIS_FINAL_MS: 30 * 60 * 1000, // 30 min (límite mínimo del scheduler)
});

/**
 * Retorna el descanso mínimo en ms según la combinación de rondas padre e hijo.
 * @param {number|null} rondaPadre - Ronda del cruce previo (ej. 32, 16, 8, 4)
 * @param {number|null} rondaHijo - Ronda del cruce siguiente (ej. 16, 8, 4, 2)
 * @returns {number} descanso mínimo requerido en milisegundos
 */
function obtenerDescansoMinimoRequeridoMs(rondaPadre, rondaHijo) {
  if (rondaPadre === 4 && rondaHijo === 2) {
    return REST_CONSTANTS.MIN_REST_SEMIS_FINAL_MS;
  }
  if (rondaPadre === 8 && rondaHijo === 4) {
    return REST_CONSTANTS.MIN_REST_CUARTOS_SEMIS_MS;
  }
  if (rondaPadre === 16 && rondaHijo === 8) {
    return REST_CONSTANTS.MIN_REST_OCTAVOS_CUARTOS_MS;
  }
  if (rondaPadre === 32 && rondaHijo === 16) {
    return REST_CONSTANTS.MIN_REST_R32_OCTAVOS_MS;
  }
  return DURACION_MS;
}

/**
 * Calcula el fin de zonas de una categoría a partir de sus partidos de zona.
 * Determina si hay partidos sin horario o zonas manuales sin partidos.
 * Firma única: recibe un único objeto de opciones.
 *
 * @param {object} [options={}]
 * @param {Array<object>} [options.partidosZona=[]] - Lista de partidos de zona de la categoría
 * @param {number} [options.totalZonas=0] - Cantidad de zonas creadas en la categoría
 * @param {Array<string>} [options.zonasIds=[]] - IDs de todas las zonas de la categoría
 * @param {number} [options.duracionMs=DURACION_MS] - Duración de cada partido en ms
 * @returns {{ maxZonaEndMs: number|null, tienePartidosSinHorario: boolean }}
 */
function calcularFinDeZonasCategoria({
  partidosZona = [],
  totalZonas = 0,
  zonasIds = [],
  duracionMs = DURACION_MS,
} = {}) {
  const effectiveTotalZonas = Math.max(
    totalZonas || 0,
    Array.isArray(zonasIds) ? zonasIds.length : 0
  );

  // Si hay zonas creadas pero la lista de partidos está vacía
  if (effectiveTotalZonas > 0 && (!partidosZona || partidosZona.length === 0)) {
    return {
      maxZonaEndMs: null,
      tienePartidosSinHorario: true,
    };
  }

  // Si se proporcionan zonasIds o totalZonas, verificar si alguna zona no tiene ningún partido registrado
  if (Array.isArray(zonasIds) && zonasIds.length > 0) {
    const zonasConPartidos = new Set(
      (partidosZona || []).filter((p) => p && p.zonaId).map((p) => p.zonaId)
    );
    const algunaZonaSinPartidos = zonasIds.some((id) => !zonasConPartidos.has(id));
    if (algunaZonaSinPartidos) {
      return {
        maxZonaEndMs: null,
        tienePartidosSinHorario: true,
      };
    }
  } else if (effectiveTotalZonas > 0) {
    const zonasConPartidos = new Set(
      (partidosZona || []).filter((p) => p && p.zonaId).map((p) => p.zonaId)
    );
    if (zonasConPartidos.size < effectiveTotalZonas) {
      return {
        maxZonaEndMs: null,
        tienePartidosSinHorario: true,
      };
    }
  }

  let tienePartidosSinHorario = false;
  let maxZonaEndMs = null;

  if (Array.isArray(partidosZona)) {
    for (const p of partidosZona) {
      if (!p || p.sinHorarioAsignado || !p.fechaHora) {
        tienePartidosSinHorario = true;
      } else {
        const fecha = p.fechaHora instanceof Date ? p.fechaHora : new Date(p.fechaHora);
        const startMs = fecha.getTime();
        const endMs = startMs + duracionMs;
        if (maxZonaEndMs === null || endMs > maxZonaEndMs) {
          maxZonaEndMs = endMs;
        }
      }
    }
  }

  return {
    maxZonaEndMs,
    tienePartidosSinHorario,
  };
}

/**
 * Calcula las advertencias no bloqueantes para la asignación de un cruce eliminatorio.
 * Firma única: recibe un único objeto de opciones.
 *
 * @param {object} [options={}]
 * @param {object} options.partido - El partido de eliminatoria que se desea agendar
 * @param {Date|string|number} options.fechaHoraPropuesta - Horario de inicio propuesto
 * @param {Array<object>} [options.padres=[]] - Partidos padres del cruce
 * @param {object|null} [options.hijo=null] - Partido hijo del cruce en la siguiente fase
 * @param {object|null} [options.finZonas=null] - Resultado de calcularFinDeZonasCategoria
 * @param {number} [options.duracionMs=DURACION_MS] - Duración del partido en ms
 * @returns {{ advertencias: Array<{ codigo: string, mensaje: string, descansoDisponibleMin?: number, descansoRequeridoMin?: number }> }}
 */
function calcularDescansosEliminatoria({
  partido,
  fechaHoraPropuesta,
  padres = [],
  hijo = null,
  finZonas = null,
  duracionMs = DURACION_MS,
} = {}) {
  const advertencias = [];
  if (!partido || !fechaHoraPropuesta) {
    return { advertencias };
  }

  const propDate = fechaHoraPropuesta instanceof Date ? fechaHoraPropuesta : new Date(fechaHoraPropuesta);
  const partidoStartMs = propDate.getTime();
  const partidoEndMs = partidoStartMs + duracionMs;
  const rondaActual = partido.faseEliminatoria?.ronda || partido.ronda || null;

  // 1. ZONA_CON_PARTIDOS_PENDIENTES
  if (finZonas && finZonas.tienePartidosSinHorario) {
    advertencias.push({
      codigo: 'ZONA_CON_PARTIDOS_PENDIENTES',
      mensaje: 'La categoría tiene partidos de zona pendientes o zonas manuales sin partidos creados.',
    });
  }

  // 2. INICIA_ANTES_FIN_ZONAS
  if (finZonas && finZonas.maxZonaEndMs !== null && partidoStartMs < finZonas.maxZonaEndMs) {
    advertencias.push({
      codigo: 'INICIA_ANTES_FIN_ZONAS',
      mensaje: 'El partido de eliminatoria inicia antes de que finalicen los partidos de zona de la categoría.',
    });
  }

  // 3. DESCANSO_INSUFICIENTE_PADRE
  if (Array.isArray(padres)) {
    for (const padre of padres) {
      if (!padre || padre.esBye || padre.sinHorarioAsignado || !padre.fechaHora) {
        continue;
      }
      const padreFecha = padre.fechaHora instanceof Date ? padre.fechaHora : new Date(padre.fechaHora);
      const padreStartMs = padreFecha.getTime();
      const padreEndMs = padreStartMs + duracionMs;
      const descansoMs = partidoStartMs - padreEndMs;

      const rondaPadre = padre.faseEliminatoria?.ronda || padre.ronda || (rondaActual ? rondaActual * 2 : null);
      const minRestMs = obtenerDescansoMinimoRequeridoMs(rondaPadre, rondaActual);

      // Aviso solo si el descanso es estrictamente MENOR que el mínimo
      if (descansoMs < minRestMs) {
        advertencias.push({
          codigo: 'DESCANSO_INSUFICIENTE_PADRE',
          mensaje: `Descanso insuficiente con el cruce previo (${Math.round(descansoMs / 60000)} min disponibles, mínimo requerido ${Math.round(minRestMs / 60000)} min).`,
          descansoDisponibleMin: Math.round(descansoMs / 60000),
          descansoRequeridoMin: Math.round(minRestMs / 60000),
        });
        break;
      }
    }
  }

  // 4. DESCANSO_INSUFICIENTE_HIJO
  if (hijo && !hijo.esBye && !hijo.sinHorarioAsignado && hijo.fechaHora) {
    const hijoFecha = hijo.fechaHora instanceof Date ? hijo.fechaHora : new Date(hijo.fechaHora);
    const hijoStartMs = hijoFecha.getTime();
    const descansoMs = hijoStartMs - partidoEndMs;

    const rondaHijo = hijo.faseEliminatoria?.ronda || hijo.ronda || (rondaActual ? rondaActual / 2 : null);
    const minRestMs = obtenerDescansoMinimoRequeridoMs(rondaActual, rondaHijo);

    // Aviso solo si el descanso es estrictamente MENOR que el mínimo
    if (descansoMs < minRestMs) {
      advertencias.push({
        codigo: 'DESCANSO_INSUFICIENTE_HIJO',
        mensaje: `Descanso insuficiente con el cruce siguiente (${Math.round(descansoMs / 60000)} min disponibles, mínimo requerido ${Math.round(minRestMs / 60000)} min).`,
        descansoDisponibleMin: Math.round(descansoMs / 60000),
        descansoRequeridoMin: Math.round(minRestMs / 60000),
      });
    }
  }

  return { advertencias };
}

module.exports = {
  REST_CONSTANTS,
  obtenerDescansoMinimoRequeridoMs,
  calcularFinDeZonasCategoria,
  calcularDescansosEliminatoria,
};
