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
 * Formatea una fecha/hora ISO en formato compacto para tarjeta de partido: "Vie · 19:30"
 * Utiliza timeZone 'America/Argentina/Cordoba'. Si fechaHora es null o inválida, retorna ''.
 * @param {string | Date} fechaHora
 * @returns {string}
 */
export function formatPartidoHorario(fechaHora) {
  if (!fechaHora) return '';
  const d = new Date(fechaHora);
  if (isNaN(d.getTime())) return '';

  const dayStr = new Intl.DateTimeFormat('es-AR', {
    weekday: 'short',
    timeZone: 'America/Argentina/Cordoba',
  }).format(d);
  const cleanDay = dayStr.replace('.', '');
  const capitalizedDay = cleanDay.charAt(0).toUpperCase() + cleanDay.slice(1);

  const timeStr = new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'America/Argentina/Cordoba',
  }).format(d);

  return `${capitalizedDay} · ${timeStr}`;
}

/**
 * Agrupa por día calendario lógico en America/Argentina/Cordoba.
 * Retorna { key: string, diaNombre: string } o null si fechaHora es inválida o vacía.
 * key: "YYYY-MM-DD"
 * diaNombre: "Viernes", "Sábado", etc. (solo el nombre del día, sin fecha numérica)
 * @param {string | Date} fechaHora
 * @returns {{ key: string, diaNombre: string } | null}
 */
export function getDiaCalendarioCordoba(fechaHora) {
  if (!fechaHora) return null;
  const d = new Date(fechaHora);
  if (isNaN(d.getTime())) return null;

  const key = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Cordoba',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);

  const diaNombreRaw = new Intl.DateTimeFormat('es-AR', {
    weekday: 'long',
    timeZone: 'America/Argentina/Cordoba',
  }).format(d);
  const diaNombre = diaNombreRaw.charAt(0).toUpperCase() + diaNombreRaw.slice(1);

  return { key, diaNombre };
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

/**
 * Determina el día calendario lógico de un partido considerando turnos de trasnoche
 * y los horarios configurados del club.
 * @param {string | Date} fechaHora
 * @param {Object} [horariosClub] { viernesInicio, viernesFin, sabadoInicio, sabadoFin }
 * @returns {{ key: string, label: string, diaNombre: string, diaNumero: number, logicalDate: Date } | null}
 */
export function getDiaCalendarioConTrasnoche(fechaHora, horariosClub = null) {
  if (!fechaHora) return null;
  const d = new Date(fechaHora);
  if (isNaN(d.getTime())) return null;

  const diaSemana = d.getDay(); // 0: Dom, 1: Lun, ..., 5: Vie, 6: Sab
  const horas = d.getHours();
  const minutos = d.getMinutes();
  const timeInMinutes = horas * 60 + minutos;

  let shiftDays = 0;

  // Evaluar trasnoche en madrugada
  if (diaSemana === 6) {
    // Sábado de madrugada: si es antes de la apertura del sábado (o antes de las 06:00 AM)
    const sabInicio = horariosClub?.sabadoInicio || '06:00';
    const [sh, sm] = sabInicio.split(':').map(Number);
    const sabInicioMin = (isNaN(sh) ? 6 : sh) * 60 + (isNaN(sm) ? 0 : sm);
    if (timeInMinutes < sabInicioMin) {
      shiftDays = -1; // Pertenece al Viernes
    }
  } else if (diaSemana === 0) {
    // Domingo de madrugada: si es antes de la apertura del domingo (o antes de las 06:00 AM)
    const domInicio = horariosClub?.domingoInicio || '06:00';
    const [dh, dm] = domInicio.split(':').map(Number);
    const domInicioMin = (isNaN(dh) ? 6 : dh) * 60 + (isNaN(dm) ? 0 : dm);
    if (timeInMinutes < domInicioMin) {
      shiftDays = -1; // Pertenece al Sábado
    }
  } else if (timeInMinutes < 6 * 60) {
    // Cualquier otro día en madrugada antes de las 6 AM
    shiftDays = -1;
  }

  const logicalDate = new Date(d);
  if (shiftDays !== 0) {
    logicalDate.setDate(logicalDate.getDate() + shiftDays);
  }

  const yyyy = logicalDate.getFullYear();
  const mm = String(logicalDate.getMonth() + 1).padStart(2, '0');
  const dd = String(logicalDate.getDate()).padStart(2, '0');
  const key = `${yyyy}-${mm}-${dd}`;

  const dias = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const diaNombre = dias[logicalDate.getDay()];
  const diaNumero = logicalDate.getDate();
  const label = `${diaNombre} ${diaNumero}`;

  return {
    key,
    label,
    diaNombre,
    diaNumero,
    logicalDate,
  };
}

/**
 * Convierte una hora en formato "HH:MM" a minutos transcurridos desde el inicio de la jornada lógica.
 * En torneos de pádel, las horas de madrugada (00:00 a 05:59) corresponden a la trasnoche
 * de la jornada anterior, por lo que se les suma 24 horas (1440 minutos) para ubicarlas
 * cronológicamente al final del día (después de las 23:45) y no al inicio.
 *
 * @param {string} hora - Formato "HH:MM"
 * @returns {number} Minutos cronológicos acumulados en la jornada
 */
export function minutosCronologicosJornada(hora) {
  if (!hora || typeof hora !== 'string') return 0;
  const [h, m] = hora.split(':').map(Number);
  const hourNum = isNaN(h) ? 0 : h;
  const minNum = isNaN(m) ? 0 : m;
  const effectiveHour = hourNum < 6 ? hourNum + 24 : hourNum;
  return effectiveHour * 60 + minNum;
}

