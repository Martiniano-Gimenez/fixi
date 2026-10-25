'use strict';

const { horaAMinutos, DURACION_PARTIDO_MIN } = require('../services/slots.service');
const { getDiaCalendarioConTrasnoche } = require('./dateUtils');

const DURACION_MS = DURACION_PARTIDO_MIN * 60 * 1000;

/**
 * Cierre de una jornada del club en ms. Regla de trasnoche: si el cierre es <= la apertura,
 * el cierre cae al día siguiente (ej. 18:00 a 02:00).
 *
 * @param {number} baseDiaMs - Medianoche local del día de la jornada
 * @param {string|null} inicioStr - Apertura "HH:MM"
 * @param {string|null} finStr - Cierre "HH:MM"
 * @returns {number|null} null si falta la apertura o el cierre
 */
function calcularFinJornadaMs(baseDiaMs, inicioStr, finStr) {
  if (!inicioStr || !finStr) return null;
  const inicioMin = horaAMinutos(inicioStr);
  const finMin = horaAMinutos(finStr);
  const finEfectivoMin = finMin <= inicioMin ? finMin + 24 * 60 : finMin;
  return baseDiaMs + finEfectivoMin * 60 * 1000;
}

/**
 * Cierre configurado del club para la jornada lógica (viernes o sábado) de un partido.
 * Domingo queda fuera de alcance (lo maneja el scheduler de eliminatorias).
 *
 * @returns {number|null}
 */
function calcularCierreJornadaMs(fechaHora, organizador) {
  if (!fechaHora || !organizador) return null;
  const info = getDiaCalendarioConTrasnoche(fechaHora, organizador);
  if (!info) return null;
  const baseDia = new Date(info.logicalDate);
  baseDia.setHours(0, 0, 0, 0);
  const dow = info.logicalDate.getDay();
  if (dow === 5) return calcularFinJornadaMs(baseDia.getTime(), organizador.viernesInicio, organizador.viernesFin);
  if (dow === 6) return calcularFinJornadaMs(baseDia.getTime(), organizador.sabadoInicio, organizador.sabadoFin);
  return null;
}

/**
 * Minutos que un partido termina después del cierre del club (0 si termina antes o justo al cierre).
 * Se deriva en lectura: Modo Lluvia puede agendar más allá del cierre a propósito (decisión de producto).
 */
function minutosDespuesDelCierre(fechaHora, organizador, duracionMs = DURACION_MS) {
  const cierreMs = calcularCierreJornadaMs(fechaHora, organizador);
  if (cierreMs === null) return 0;
  const finMs = new Date(fechaHora).getTime() + duracionMs;
  return finMs > cierreMs ? Math.ceil((finMs - cierreMs) / 60000) : 0;
}

module.exports = {
  calcularFinJornadaMs,
  calcularCierreJornadaMs,
  minutosDespuesDelCierre,
};
