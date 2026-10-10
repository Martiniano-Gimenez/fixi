/**
 * Utilidades de fecha y hora para el frontend.
 *
 * Todas las funciones de formateo y cálculo de jornadas operan estrictamente
 * en la zona horaria oficial del torneo ('America/Argentina/Buenos_Aires')
 * utilizando la API nativa Intl, garantizando paridad total con el backend
 * independientemente del huso horario local configurado en el navegador del usuario.
 */

export const TIME_ZONE_ARGENTINA = 'America/Argentina/Buenos_Aires';

const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const DIAS_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

// Instancia reutilizable de Intl para extraer componentes civiles en Buenos Aires
const dtfParts = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE_ARGENTINA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

// Instancia para formato largo de fecha de torneo ("9 de octubre de 2026")
const dtfFechaTorneo = new Intl.DateTimeFormat('es-AR', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/**
 * Descompone una fecha/hora ISO o timestamp en sus componentes civiles
 * en America/Argentina/Buenos_Aires sin depender de la zona horaria del navegador.
 *
 * @param {string | Date | number} fechaHora
 * @returns {{ year: number, month: number, day: number, hour: number, minute: number, second: number, dayOfWeek: number } | null}
 */
export function getZonedParts(fechaHora) {
  if (!fechaHora) return null;
  const d = new Date(fechaHora);
  if (isNaN(d.getTime())) return null;

  const parts = dtfParts.formatToParts(d);
  const map = {};
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.type !== 'literal') map[p.type] = p.value;
  }

  const year = parseInt(map.year, 10);
  const month = parseInt(map.month, 10);
  const day = parseInt(map.day, 10);
  const hour = parseInt(map.hour, 10);
  const minute = parseInt(map.minute, 10);
  const second = parseInt(map.second, 10);

  // En el calendario gregoriano universal, la fecha civil dada (año, mes, día)
  // tiene un único día de la semana. Date.UTC deriva dayOfWeek (0: Dom .. 6: Sáb)
  // de forma completamente inmune a cualquier desfasaje o salto horario local.
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  return { year, month, day, hour, minute, second, dayOfWeek };
}

/**
 * Formatea una fecha/hora ISO en formato amigable de torneo: "Viernes 19:30" o "Sábado 10:30"
 * Siempre evaluado en America/Argentina/Buenos_Aires.
 * @param {string | Date} fechaHora
 * @returns {string}
 */
export function formatDiaHorario(fechaHora) {
  const parts = getZonedParts(fechaHora);
  if (!parts) return '';

  const diaNombre = DIAS_SEMANA[parts.dayOfWeek];
  const horas = String(parts.hour).padStart(2, '0');
  const minutos = String(parts.minute).padStart(2, '0');

  return `${diaNombre} ${horas}:${minutos}`;
}

/**
 * Formatea una fecha/hora ISO obteniendo únicamente el día: "Viernes" o "Sábado"
 * Siempre evaluado en America/Argentina/Buenos_Aires.
 * @param {string | Date} fechaHora
 * @returns {string}
 */
export function formatDiaNombre(fechaHora) {
  const parts = getZonedParts(fechaHora);
  if (!parts) return '';

  return DIAS_SEMANA[parts.dayOfWeek];
}

/**
 * Formatea una fecha/hora obteniendo únicamente la hora civil: "19:30" o "00:00".
 * Nunca devuelve "24:00" gracias al ciclo de 23 horas.
 * @param {string | Date} fechaHora
 * @returns {string}
 */
export function formatHora(fechaHora) {
  const parts = getZonedParts(fechaHora);
  if (!parts) return '';

  const horas = String(parts.hour).padStart(2, '0');
  const minutos = String(parts.minute).padStart(2, '0');

  return `${horas}:${minutos}`;
}

/**
 * Formatea una fecha/hora ISO en formato compacto para tarjeta de partido: "Vie · 19:30"
 * Siempre evaluado en America/Argentina/Buenos_Aires.
 * @param {string | Date} fechaHora
 * @returns {string}
 */
export function formatPartidoHorario(fechaHora) {
  const parts = getZonedParts(fechaHora);
  if (!parts) return '';

  const diaCorto = DIAS_CORTOS[parts.dayOfWeek];
  const horas = String(parts.hour).padStart(2, '0');
  const minutos = String(parts.minute).padStart(2, '0');

  return `${diaCorto} · ${horas}:${minutos}`;
}

/**
 * Formatea una fecha civil de torneo: "9 de octubre de 2026".
 *
 * USO EXCLUSIVO para fechas de torneo (fecha civil guardada al mediodía local).
 * NO debe usarse para fechas/horarios de partidos (para eso usar formatDiaHorario / formatHora).
 *
 * Maneja cadenas ISO con mediodía UTC, medianoche UTC o strings planos "YYYY-MM-DD",
 * evitando que la medianoche UTC en husos al oeste reste un día calendario.
 * @param {string | Date} fecha
 * @returns {string}
 */
export function formatFechaTorneo(fecha) {
  if (!fecha) return '';
  if (typeof fecha === 'string') {
    const m = fecha.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      const y = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10) - 1;
      const d = parseInt(m[3], 10);
      return dtfFechaTorneo.format(new Date(Date.UTC(y, mo, d, 12, 0, 0)));
    }
  }
  const d = new Date(fecha);
  if (isNaN(d.getTime())) return '';
  return dtfFechaTorneo.format(d);
}

/**
 * Agrupa por día calendario en America/Argentina/Buenos_Aires sin trasnoche.
 * Mantiene la firma y tipo de retorno original para la vista pública.
 * Retorna { key: string, diaNombre: string } o null si fechaHora es inválida o vacía.
 * key: "YYYY-MM-DD"
 * diaNombre: "Viernes", "Sábado", etc.
 * @param {string | Date} fechaHora
 * @returns {{ key: string, diaNombre: string } | null}
 */
export function getDiaCalendarioCordoba(fechaHora) {
  if (!fechaHora) return null;
  const d = new Date(fechaHora);
  if (isNaN(d.getTime())) return null;

  const key = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE_ARGENTINA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);

  const diaNombreRaw = new Intl.DateTimeFormat('es-AR', {
    weekday: 'long',
    timeZone: TIME_ZONE_ARGENTINA,
  }).format(d);
  const diaNombre = diaNombreRaw.charAt(0).toUpperCase() + diaNombreRaw.slice(1);

  return { key, diaNombre };
}

/**
 * Formatea un ajuste de tiempo en minutos con signo (+/-) y formato de horas si es >= 60m.
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
 * y los horarios configurados del club, evaluado en America/Argentina/Buenos_Aires.
 *
 * Mantiene la compatibilidad total de retorno con los componentes existentes,
 * exponiendo campos numéricos precalculados y un logicalDate centrado en el mediodía local
 * para evitar que getters locales en husos horarios al oeste devuelvan el día anterior.
 *
 * @param {string | Date} fechaHora
 * @param {Object} [horariosClub] { sabadoInicio, domingoInicio }
 * @returns {{ key: string, label: string, diaNombre: string, diaNumero: number, dayOfWeek: number, logicalDate: Date } | null}
 */
export function getDiaCalendarioConTrasnoche(fechaHora, horariosClub = null) {
  const parts = getZonedParts(fechaHora);
  if (!parts) return null;

  const { year, month, day, hour, minute, dayOfWeek } = parts;
  const timeInMinutes = hour * 60 + minute;

  let shiftDays = 0;
  const sabInicio = horariosClub?.sabadoInicio || '06:00';
  const [sh, sm] = sabInicio.split(':').map(Number);
  const sabInicioMin = (isNaN(sh) ? 6 : sh) * 60 + (isNaN(sm) ? 0 : sm);

  // Evaluar trasnoche en madrugada según hora oficial de Argentina
  if (dayOfWeek === 6) {
    // Sábado de madrugada: si es antes de la apertura del sábado (o antes de las 06:00 AM)
    if (timeInMinutes < sabInicioMin) {
      shiftDays = -1; // Pertenece al Viernes
    }
  } else if (dayOfWeek === 0) {
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

  // Desplazamiento de calendario en UTC para evitar saltos o desfasajes
  const logicalUtc = new Date(Date.UTC(year, month - 1, day + shiftDays));
  const logicalYear = logicalUtc.getUTCFullYear();
  const logicalMonth = String(logicalUtc.getUTCMonth() + 1).padStart(2, '0');
  const logicalDay = String(logicalUtc.getUTCDate()).padStart(2, '0');
  const logicalDayOfWeek = logicalUtc.getUTCDay();

  const key = `${logicalYear}-${logicalMonth}-${logicalDay}`;
  const diaNombre = DIAS_SEMANA[logicalDayOfWeek];
  const diaNumero = logicalUtc.getUTCDate();
  const label = `${diaNombre} ${diaNumero}`;

  // Se inicializa al mediodía local (12:00:00) para que cualquier getter local
  // (.getDate(), .getDay()) sea inmune a la zona horaria del navegador
  const logicalDate = new Date(logicalYear, parseInt(logicalMonth, 10) - 1, diaNumero, 12, 0, 0);

  return {
    key,
    label,
    diaNombre,
    diaNumero,
    dayOfWeek: logicalDayOfWeek,
    logicalDate,
  };
}

/**
 * Convierte una hora en formato "HH:MM" a minutos transcurridos desde el inicio de la jornada lógica.
 * En torneos de pádel, las horas de madrugada (00:00 a 05:59) corresponden a la trasnoche
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

/**
 * Formatea una cantidad de turnos (slots de 15 minutos) a formato amigable en horas/minutos
 * @param {number} cantSlots
 * @returns {string}
 */
export function formatHorasDisponibles(cantSlots) {
  const totalMin = (cantSlots || 0) * 15;
  if (totalMin < 60) {
    return `${totalMin} min`;
  }
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (m === 0) {
    return `${h} h`;
  }
  return `${h} h ${m} min`;
}

/**
 * Determina si una fecha en formato civil "YYYY-MM-DD" o Date corresponde a un viernes (día 5).
 * Interpreta la fecha civil de forma determinista e inmune a la zona horaria del navegador.
 *
 * @param {string | Date} fecha
 * @returns {boolean}
 */
export function isViernes(fecha) {
  if (!fecha) return false;
  if (typeof fecha === 'string') {
    const m = fecha.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return false;
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10) - 1;
    const d = parseInt(m[3], 10);
    return new Date(Date.UTC(y, mo, d)).getUTCDay() === 5;
  }
  const parts = getZonedParts(fecha);
  return parts ? parts.dayOfWeek === 5 : false;
}

