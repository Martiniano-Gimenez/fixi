/**
 * Parsea una fecha (string 'YYYY-MM-DD', ISO string o Date) asegurando
 * que se interprete en el horario local (mediodía) sin desfasaje por zona horaria UTC.
 * @param {string | Date} fecha
 * @returns {Date | null}
 */
function parseFechaLocal(fecha) {
  if (!fecha) return null;
  if (fecha instanceof Date) {
    if (isNaN(fecha.getTime())) return null;
    const y = fecha.getFullYear();
    const m = fecha.getMonth();
    const d = fecha.getDate();
    return new Date(y, m, d, 12, 0, 0);
  }
  if (typeof fecha === 'string') {
    const trimmed = fecha.trim();
    if (!trimmed) return null;
    const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const y = parseInt(match[1], 10);
      const m = parseInt(match[2], 10) - 1;
      const d = parseInt(match[3], 10);
      return new Date(y, m, d, 12, 0, 0);
    }
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
      const y = parsed.getFullYear();
      const m = parsed.getMonth();
      const d = parsed.getDate();
      return new Date(y, m, d, 12, 0, 0);
    }
  }
  return null;
}

/**
 * Valida que el torneo tenga una fecha definida y la devuelve parseada en hora local.
 * Lanza un error HTTP 400 si la fecha no está presente.
 * @param {Object} torneo
 * @returns {Date}
 */
function requireTorneoFecha(torneo) {
  if (!torneo || !torneo.fecha) {
    const error = new Error('El torneo debe tener una fecha definida para asignar horarios.');
    error.statusCode = 400;
    throw error;
  }
  const parsed = parseFechaLocal(torneo.fecha);
  if (!parsed) {
    const error = new Error('La fecha del torneo no es válida.');
    error.statusCode = 400;
    throw error;
  }
  return parsed;
}

/**
 * Fin de la jornada lógica en Modo Lluvia: 06:00 del día siguiente (sábado y domingo; el viernes termina
 * antes si el sábado abre antes de esa hora).
 * Decisión de producto: es INTENCIONAL que supere el cierre configurado del club (viernesFin/sabadoFin),
 * para que ningún partido quede sin jugar. Los partidos agendados después del cierre se marcan en
 * Día de Torneo (horarioClub.js). Lo que no entra antes de este límite queda sin horario, en
 * partidosSinSlot y en la bandeja de pendientes; nunca se mueve a otro día.
 */
const HORA_FIN_JORNADA_LLUVIA_MIN = 6 * 60;

/**
 * Determina el dia calendario logico de una fecha considerando la trasnoche
 * y los horarios configurados del club.
 * Tambien devuelve el limite (timestamp) donde termina ese dia logico.
 * 
 * @param {string | Date} fechaHora
 * @param {Object} [horariosClub] { viernesInicio, viernesFin, sabadoInicio, sabadoFin }
 */
function getDiaCalendarioConTrasnoche(fechaHora, horariosClub = null) {
  if (!fechaHora) return null;
  const d = new Date(fechaHora);
  if (isNaN(d.getTime())) return null;

  const diaSemana = d.getDay(); // 0: Dom, 1: Lun, ..., 5: Vie, 6: Sab
  const horas = d.getHours();
  const minutos = d.getMinutes();
  const timeInMinutes = horas * 60 + minutos;

  let shiftDays = 0;
  const sabInicio = horariosClub?.sabadoInicio || '06:00';
  const [sh, sm] = sabInicio.split(':').map(Number);
  const sabInicioMin = (isNaN(sh) ? 6 : sh) * 60 + (isNaN(sm) ? 0 : sm);

  // Evaluar trasnoche en madrugada
  if (diaSemana === 6) { // Sabado de madrugada
    if (timeInMinutes < sabInicioMin) shiftDays = -1; // Pertenece al Viernes
  } else if (diaSemana === 0) { // Domingo de madrugada
    const domInicio = horariosClub?.domingoInicio || '06:00';
    const [dh, dm] = domInicio.split(':').map(Number);
    const domInicioMin = (isNaN(dh) ? 6 : dh) * 60 + (isNaN(dm) ? 0 : dm);
    if (timeInMinutes < domInicioMin) shiftDays = -1; // Pertenece al Sabado
  } else if (timeInMinutes < 6 * 60) {
    shiftDays = -1;
  }

  const logicalDate = new Date(d);
  if (shiftDays !== 0) {
    logicalDate.setDate(logicalDate.getDate() + shiftDays);
  }

  const isLogicalViernes = logicalDate.getDay() === 5;

  // Calcular limite del dia (Modo Lluvia): HORA_FIN_JORNADA_LLUVIA_MIN del día siguiente.
  // El viernes termina antes si el sábado abre antes de esa hora, para no invadir el día lógico del sábado.
  const finJornadaMin = isLogicalViernes
    ? Math.min(sabInicioMin, HORA_FIN_JORNADA_LLUVIA_MIN)
    : HORA_FIN_JORNADA_LLUVIA_MIN;
  const dayLimitDate = new Date(logicalDate);
  dayLimitDate.setDate(dayLimitDate.getDate() + 1);
  dayLimitDate.setHours(Math.floor(finJornadaMin / 60), finJornadaMin % 60, 0, 0);

  const yyyy = logicalDate.getFullYear();
  const mm = String(logicalDate.getMonth() + 1).padStart(2, '0');
  const dd = String(logicalDate.getDate()).padStart(2, '0');
  const key = `${yyyy}-${mm}-${dd}`;

  return {
    key,
    logicalDate,
    dayLimitMs: dayLimitDate.getTime()
  };
}

/**
 * Claves YYYY-MM-DD de las tres jornadas del torneo: viernes (fecha del torneo), sábado y domingo.
 * refFecha es torneo.fecha parseada con parseFechaLocal (mediodía local), sin depender de new Date().
 */
function clavesJornadasTorneo(refFecha) {
  return [0, 1, 2].map((offset) => {
    const d = new Date(refFecha);
    d.setDate(d.getDate() + offset);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  });
}

module.exports = {
  parseFechaLocal,
  requireTorneoFecha,
  getDiaCalendarioConTrasnoche,
  clavesJornadasTorneo,
  HORA_FIN_JORNADA_LLUVIA_MIN,
};
