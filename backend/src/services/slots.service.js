const DURACION_PARTIDO_MIN = 75;

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
 * Genera array de slots ["Viernes-18:00", "Viernes-19:15", ..., "Viernes-00:15"]
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
  for (let m = inicioMin; m + DURACION_PARTIDO_MIN <= effectiveFinMin; m += DURACION_PARTIDO_MIN) {
    const clockMin = m % (24 * 60);
    slots.push(`${dia}-${minutosAHora(clockMin)}`);
  }
  return slots;
}

/**
 * Genera la grilla de slots para el club (organizador) agrupada por día
 */
function generarGrillaOrganizador(organizador) {
  if (!organizador) return { viernes: [], sabado: [] };
  const viernes = generarSlotsDia('Viernes', organizador.viernesInicio, organizador.viernesFin);
  const sabado = generarSlotsDia('Sabado', organizador.sabadoInicio, organizador.sabadoFin);
  return { viernes, sabado };
}

/**
 * Devuelve un Set con todos los slots válidos del club (organizador)
 */
function getSlotsValidosSet(organizador) {
  const { viernes, sabado } = generarGrillaOrganizador(organizador);
  return new Set([...viernes, ...sabado]);
}

/**
 * Calcula la cantidad de slots en común entre dos listas de slotIds
 */
function calcularCompatibilidad(slotsA, slotsB) {
  if (!Array.isArray(slotsA) || !Array.isArray(slotsB)) return 0;
  const setB = new Set(slotsB);
  return slotsA.filter((s) => setB.has(s)).length;
}

module.exports = {
  DURACION_PARTIDO_MIN,
  horaAMinutos,
  minutosAHora,
  generarSlotsDia,
  generarGrillaOrganizador,
  getSlotsValidosSet,
  calcularCompatibilidad,
};
