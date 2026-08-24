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
