/**
 * Formatea una fecha/hora ISO en formato amigable de torneo: "Viernes 19:30" o "Sábado 10:30"
 * @param {string | Date} fechaHora
 * @returns {string}
 */
export function formatDiaHorario(fechaHora) {
  if (!fechaHora) return '';
  const d = new Date(fechaHora);
  if (isNaN(d.getTime())) return '';

  const dias = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const diaNombre = dias[d.getDay()];

  const horas = String(d.getHours()).padStart(2, '0');
  const minutos = String(d.getMinutes()).padStart(2, '0');

  return `${diaNombre} ${horas}:${minutos}`;
}

/**
 * Formatea un ajuste de tiempo en minutos con signo (+/-) y formato de horas si es >= 60m.
 * Ejemplos:
 *  45 -> "+45m"
 * -45 -> "-45m"
 *  60 -> "+1h"
 * -60 -> "-1h"
 *  95 -> "+1h 35m"
 * -120 -> "-2h"
 * @param {number} minutos
 * @returns {string}
 */
export function formatAjusteTiempo(minutos) {
  if (minutos === 0 || minutos === undefined || minutos === null) return '0m';

  const sign = minutos > 0 ? '+' : '-';
  const absMin = Math.abs(minutos);

  if (absMin < 60) {
    return `${sign}${absMin}m`;
  }

  const h = Math.floor(absMin / 60);
  const m = absMin % 60;

  if (m === 0) {
    return `${sign}${h}h`;
  }

  return `${sign}${h}h ${m}m`;
}
