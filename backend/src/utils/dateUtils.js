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
    if (timeInMinutes < 6 * 60) shiftDays = -1; // Pertenece al Sabado
  } else if (timeInMinutes < 6 * 60) {
    shiftDays = -1;
  }

  const logicalDate = new Date(d);
  if (shiftDays !== 0) {
    logicalDate.setDate(logicalDate.getDate() + shiftDays);
  }

  const isLogicalViernes = logicalDate.getDay() === 5;
  
  // Calcular limite del dia
  let dayLimitDate = new Date(logicalDate);
  if (isLogicalViernes) {
    // Viernes logico termina el Sabado a `sabInicio`
    dayLimitDate.setDate(dayLimitDate.getDate() + 1);
    dayLimitDate.setHours(isNaN(sh) ? 6 : sh, isNaN(sm) ? 0 : sm, 0, 0);
  } else {
    // Cualquier otro dia logico termina al dia siguiente a las 06:00
    dayLimitDate.setDate(dayLimitDate.getDate() + 1);
    dayLimitDate.setHours(6, 0, 0, 0);
  }

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
 * Retorna true si DEBUG_NOW está activo y el entorno NO es producción.
 */
function isDebugNowActive() {
  return process.env.NODE_ENV !== 'production' && Boolean(process.env.DEBUG_NOW);
}

/**
 * Helper centralizado para obtener la fecha/hora actual ("ahora").
 * Permite simular una fecha/hora específica mediante la variable de entorno DEBUG_NOW
 * EXCLUSIVAMENTE en entornos de desarrollo/test (NODE_ENV !== 'production').
 * 
 * En producción (NODE_ENV === 'production') SIEMPRE retorna new Date() real del sistema.
 * 
 * @returns {Date}
 */
function getAhora() {
  if (isDebugNowActive()) {
    const parsed = new Date(process.env.DEBUG_NOW);
    if (!isNaN(parsed.getTime()) && parsed.getFullYear() >= 2000) {
      return new Date(parsed.getTime());
    }
  }
  return new Date();
}

module.exports = {
  getDiaCalendarioConTrasnoche,
  getAhora,
  isDebugNowActive,
};
