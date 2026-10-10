const DURACION_PARTIDO_MIN = 75;
const SLOT_GRANULARIDAD_MIN = 15;

function horaAMinutos(hora) {
  if (!hora || typeof hora !== 'string') return 0;
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}

function minutosAHora(minutos) {
  const h = Math.floor(minutos / 60).toString().padStart(2, '0');
  const m = (minutos % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Devuelve los minutos cronológicos de una hora ("HH:MM") dentro de la jornada.
 * Las horas de madrugada (00:00 a 05:59) corresponden a la trasnoche de la jornada,
 * por lo que se suman 24 horas (+1440 min) para ubicarlas cronológicamente
 * después de las 23:45.
 * @param {string} hora
 * @returns {number}
 */
function minutosCronologicosJornada(hora) {
  if (!hora || typeof hora !== 'string') return 0;
  const [h, m] = hora.split(':').map(Number);
  const hourNum = isNaN(h) ? 0 : h;
  const minNum = isNaN(m) ? 0 : m;
  const effectiveHour = hourNum < 6 ? hourNum + 24 : hourNum;
  return effectiveHour * 60 + minNum;
}

const DIA_PESO = {
  'Viernes': 1,
  'viernes': 1,
  'Sabado': 2,
  'Sábado': 2,
  'sabado': 2,
  'sábado': 2,
  'Domingo': 3,
  'domingo': 3,
};

/**
 * Compara dos slots (ej. "Sabado-13:30" vs "Sabado-00:00") cronológicamente:
 * primero por día del torneo, y luego por minutos cronológicos
 * con trasnoche al final de la jornada.
 * @param {string} slotA
 * @param {string} slotB
 * @returns {number}
 */
function compararSlotsCronologicamente(slotA, slotB) {
  if (!slotA) return -1;
  if (!slotB) return 1;

  const [diaA, horaA] = slotA.split('-');
  const [diaB, horaB] = slotB.split('-');

  const pesoA = DIA_PESO[diaA] || 99;
  const pesoB = DIA_PESO[diaB] || 99;

  if (pesoA !== pesoB) {
    return pesoA - pesoB;
  }

  return minutosCronologicosJornada(horaA) - minutosCronologicosJornada(horaB);
}

/**
 * Ordena un array de slots cronológicamente respetando días y trasnoche.
 * @param {string[]} slots
 * @returns {string[]}
 */
function ordenarSlotsCronologicamente(slots) {
  if (!Array.isArray(slots)) return [];
  return [...slots].sort(compararSlotsCronologicamente);
}

/**
 * Genera array de slots ["Viernes-18:00", "Viernes-18:15", ..., "Viernes-00:45"]
 * con granularidad de 15 minutos.
 * Soporta jornadas que pasan de la medianoche (ej. 18:00 a 02:00).
 */
function generarSlotsDia(dia, horaInicio, horaFin) {
  if (!horaInicio || !horaFin) return [];
  const inicioMin = horaAMinutos(horaInicio);
  const finMin = horaAMinutos(horaFin);

  let effectiveFinMin = finMin;
  if (effectiveFinMin < inicioMin) {
    // Si la hora de fin es menor a la de inicio (ej. 18:00 a 02:00 o 18:00 a 00:00),
    // la jornada termina en la madrugada del día siguiente (+24hs).
    effectiveFinMin += 24 * 60;
  } else if (effectiveFinMin === inicioMin) {
    return [];
  }

  const slots = [];
  for (let m = inicioMin; m + DURACION_PARTIDO_MIN <= effectiveFinMin; m += SLOT_GRANULARIDAD_MIN) {
    const clockMin = m % (24 * 60);
    slots.push(`${dia}-${minutosAHora(clockMin)}`);
  }
  return slots;
}

/**
 * Genera la grilla de slots para el club (organizador) agrupada por día
 */
function generarGrillaOrganizador(organizador) {
  if (!organizador) return { viernes: [], sabado: [], domingo: [] };
  const viernes = generarSlotsDia('Viernes', organizador.viernesInicio, organizador.viernesFin);
  const sabado = generarSlotsDia('Sabado', organizador.sabadoInicio, organizador.sabadoFin);
  const domingo = generarSlotsDia('Domingo', organizador.domingoInicio, organizador.domingoFin);
  return { viernes, sabado, domingo };
}

/**
 * Devuelve un Set con todos los slots válidos del club (organizador)
 */
function getSlotsValidosSet(organizador) {
  const { viernes, sabado, domingo } = generarGrillaOrganizador(organizador);
  return new Set([...viernes, ...sabado, ...(domingo || [])]);
}

/**
 * Calcula la cantidad de slots en común entre dos listas de slotIds
 */
function calcularCompatibilidad(slotsA, slotsB) {
  if (!Array.isArray(slotsA) || !Array.isArray(slotsB)) return 0;
  const setB = new Set(slotsB);
  return slotsA.filter((s) => setB.has(s)).length;
}

/**
 * Calcula la distancia mínima en minutos entre un slot y la disponibilidad declarada de una pareja en ese día.
 * Devuelve tanto la distancia absoluta como la distancia con signo (negativo si el slot es antes, positivo si es después).
 */
function calcularDistanciaSlotAPareja(dia, horaMin, pSlotsDelDia, hasOvernight) {
  if (!pSlotsDelDia || pSlotsDelDia.length === 0) return { abs: Infinity, signed: Infinity };

  let minDiff = Infinity;
  let signedDiff = Infinity;

  for (const s of pSlotsDelDia) {
    const sHora = s.split('-')[1];
    let sMin = horaAMinutos(sHora);
    if (hasOvernight && sMin < 360) {
      sMin += 24 * 60;
    }
    const diff = Math.abs(horaMin - sMin);
    if (diff < minDiff) {
      minDiff = diff;
      signedDiff = horaMin - sMin;
    }
  }
  return { abs: minDiff, signed: signedDiff };
}

/**
 * Calcula sugerencias de "casi-estrellas" para cruces simples (2 parejas)
 * donde no existe ningún slot con estrella real (compatibilidad 0).
 * Devuelve los `maxResultados` slots de `slotsViables` con menor estiramiento combinado.
 */
function calcularCasiEstrellas(slotsP1, slotsP2, slotsViables, maxResultados = 3) {
  if (!Array.isArray(slotsP1) || !Array.isArray(slotsP2) || !Array.isArray(slotsViables)) {
    return [];
  }

  const setP1 = new Set(slotsP1);
  const setP2 = new Set(slotsP2);

  // Agrupar slots por día
  const p1PorDia = { Viernes: [], Sabado: [] };
  const p2PorDia = { Viernes: [], Sabado: [] };

  for (const s of slotsP1) {
    const dia = s.split('-')[0];
    if (p1PorDia[dia]) p1PorDia[dia].push(s);
  }
  for (const s of slotsP2) {
    const dia = s.split('-')[0];
    if (p2PorDia[dia]) p2PorDia[dia].push(s);
  }

  const candidatos = [];

  for (const slotId of slotsViables) {
    // Si ambas ya lo tienen, es estrella real
    if (setP1.has(slotId) && setP2.has(slotId)) continue;

    const [dia, hora] = slotId.split('-');
    if (!dia || !hora) continue;

    const p1SlotsDia = p1PorDia[dia] || [];
    const p2SlotsDia = p2PorDia[dia] || [];

    // Si alguna pareja no tiene disponibilidad alguna en ese día, no es candidato viable para sugerir
    if (p1SlotsDia.length === 0 || p2SlotsDia.length === 0) continue;

    // Detectar si hay trasnoche en este día para calcular distancias correctamente a través de medianoche
    const allSlotsDia = [...p1SlotsDia, ...p2SlotsDia, slotId];
    const hasLate = allSlotsDia.some((s) => horaAMinutos(s.split('-')[1]) >= 720);
    const hasEarly = allSlotsDia.some((s) => horaAMinutos(s.split('-')[1]) < 360);
    const hasOvernight = hasLate && hasEarly;

    let slotMin = horaAMinutos(hora);
    if (hasOvernight && slotMin < 360) {
      slotMin += 24 * 60;
    }

    const resP1 = setP1.has(slotId) ? { abs: 0, signed: 0 } : calcularDistanciaSlotAPareja(dia, slotMin, p1SlotsDia, hasOvernight);
    const resP2 = setP2.has(slotId) ? { abs: 0, signed: 0 } : calcularDistanciaSlotAPareja(dia, slotMin, p2SlotsDia, hasOvernight);

    if (resP1.abs === Infinity || resP2.abs === Infinity) continue;

    const distTotal = resP1.abs + resP2.abs;

    candidatos.push({
      slotId,
      dia,
      hora,
      distP1: resP1.signed,
      distP2: resP2.signed,
      distTotal,
    });
  }

  candidatos.sort((a, b) => {
    if (a.distTotal !== b.distTotal) return a.distTotal - b.distTotal;
    // Preferir opciones más equilibradas en caso de empate de distancia total
    const balanceA = Math.abs(Math.abs(a.distP1) - Math.abs(a.distP2));
    const balanceB = Math.abs(Math.abs(b.distP1) - Math.abs(b.distP2));
    if (balanceA !== balanceB) return balanceA - balanceB;
    const diffAbs = Math.abs(a.distP1) - Math.abs(b.distP1);
    if (diffAbs !== 0) return diffAbs;
    return compararSlotsCronologicamente(a.slotId, b.slotId);
  });

  return candidatos.slice(0, maxResultados);
}

/**
 * Calcula la lista unificada de opciones de resolución para un cruce simple (2 parejas),
 * ordenadas por menor esfuerzo total (distTotal ascendente).
 * Incluye tanto estrellas reales (distTotal = 0) como casi-estrellas (distTotal > 0).
 */
function calcularOpcionesResolucion(slotsP1, slotsP2, slotsViables, maxResultados = 6) {
  if (!Array.isArray(slotsP1) || !Array.isArray(slotsP2) || !Array.isArray(slotsViables)) {
    return [];
  }

  const setP1 = new Set(slotsP1);
  const setP2 = new Set(slotsP2);

  // Agrupar slots por día
  const p1PorDia = { Viernes: [], Sabado: [] };
  const p2PorDia = { Viernes: [], Sabado: [] };

  for (const s of slotsP1) {
    const dia = s.split('-')[0];
    if (p1PorDia[dia]) p1PorDia[dia].push(s);
  }
  for (const s of slotsP2) {
    const dia = s.split('-')[0];
    if (p2PorDia[dia]) p2PorDia[dia].push(s);
  }

  const candidatos = [];

  for (const slotId of slotsViables) {
    const inP1 = setP1.has(slotId);
    const inP2 = setP2.has(slotId);

    const [dia, hora] = slotId.split('-');
    if (!dia || !hora) continue;

    const p1SlotsDia = p1PorDia[dia] || [];
    const p2SlotsDia = p2PorDia[dia] || [];

    // Si una pareja no tiene nada en ese día y tampoco tiene este slot puntual, no se puede sugerir con confianza
    if (!inP1 && p1SlotsDia.length === 0) continue;
    if (!inP2 && p2SlotsDia.length === 0) continue;

    // Detectar si hay trasnoche en este día
    const allSlotsDia = [...p1SlotsDia, ...p2SlotsDia, slotId];
    const hasLate = allSlotsDia.some((s) => horaAMinutos(s.split('-')[1]) >= 720);
    const hasEarly = allSlotsDia.some((s) => horaAMinutos(s.split('-')[1]) < 360);
    const hasOvernight = hasLate && hasEarly;

    let slotMin = horaAMinutos(hora);
    if (hasOvernight && slotMin < 360) {
      slotMin += 24 * 60;
    }

    const resP1 = inP1 ? { abs: 0, signed: 0 } : calcularDistanciaSlotAPareja(dia, slotMin, p1SlotsDia, hasOvernight);
    const resP2 = inP2 ? { abs: 0, signed: 0 } : calcularDistanciaSlotAPareja(dia, slotMin, p2SlotsDia, hasOvernight);

    if (resP1.abs === Infinity || resP2.abs === Infinity) continue;

    const distTotal = resP1.abs + resP2.abs;
    const addToP1 = !inP1;
    const addToP2 = !inP2;
    const cantidadPartesQueEstiran = (addToP1 ? 1 : 0) + (addToP2 ? 1 : 0);

    candidatos.push({
      slotId,
      dia,
      hora,
      distP1: resP1.signed,
      distP2: resP2.signed,
      distTotal,
      addToP1,
      addToP2,
      cantidadPartesQueEstiran,
    });
  }

  candidatos.sort((a, b) => {
    // 1. Criterio primario: Certeza (0 partes > 1 parte > 2 partes que estiran)
    if (a.cantidadPartesQueEstiran !== b.cantidadPartesQueEstiran) {
      return a.cantidadPartesQueEstiran - b.cantidadPartesQueEstiran;
    }
    // 2. Criterio secundario: Menor esfuerzo total dentro del mismo nivel de certeza
    if (a.distTotal !== b.distTotal) {
      return a.distTotal - b.distTotal;
    }
    // 3. Criterio terciario (desempate en dobles): Opciones más equilibradas
    const balanceA = Math.abs(Math.abs(a.distP1) - Math.abs(a.distP2));
    const balanceB = Math.abs(Math.abs(b.distP1) - Math.abs(b.distP2));
    if (balanceA !== balanceB) return balanceA - balanceB;
    const diffAbs = Math.abs(a.distP1) - Math.abs(b.distP1);
    if (diffAbs !== 0) return diffAbs;
    // 4. Desempate cronológico: opciones diurnas antes que trasnoche
    return compararSlotsCronologicamente(a.slotId, b.slotId);
  });

  return candidatos.slice(0, maxResultados);
}

module.exports = {
  DURACION_PARTIDO_MIN,
  horaAMinutos,
  minutosAHora,
  minutosCronologicosJornada,
  compararSlotsCronologicamente,
  ordenarSlotsCronologicamente,
  generarSlotsDia,
  generarGrillaOrganizador,
  getSlotsValidosSet,
  calcularCompatibilidad,
  calcularDistanciaSlotAPareja,
  calcularCasiEstrellas,
  calcularOpcionesResolucion,
};


