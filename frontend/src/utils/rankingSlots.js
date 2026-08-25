/**
 * Utilidad de ranking de cercanía y resolución para asignación de horarios de partidos.
 * Replica la jerarquía de certeza de slots.service.js:
 * 1. Certeza: cantidadPartesQueEstiran (0 mutua > 1 clásica > 2 doble)
 * 2. Menor distTotal combinada
 * 3. Menor diferencia de balance |distP1 - distP2|
 * 4. Cronológico (Viernes antes que Sábado, hora menor a mayor)
 */

function horaAMinutos(hora) {
  if (!hora || typeof hora !== 'string') return 0;
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}

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
 * Recibe los slots válidos (con canchas libres y sin superposición de partido)
 * y la disponibilidad original declarada de ambas parejas.
 * Devuelve los slots ordenados por ranking de cercanía con sus métricas calculadas.
 * 
 * @param {Array} slotsValidos - Array de { slotId, dia, hora, canchasLibres: number[] }
 * @param {Array<string>} slotsP1 - Array de slotIds declarados por pareja 1
 * @param {Array<string>} slotsP2 - Array de slotIds declarados por pareja 2
 * @returns {Array} Slots rankeados con distP1, distP2, distTotal, cantidadPartesQueEstiran, etc.
 */
export function rankearSlotsParaPartido(slotsValidos = [], slotsP1 = [], slotsP2 = []) {
  if (!Array.isArray(slotsValidos) || slotsValidos.length === 0) return [];

  const setP1 = new Set(slotsP1 || []);
  const setP2 = new Set(slotsP2 || []);

  const p1PorDia = { Viernes: [], Sabado: [] };
  const p2PorDia = { Viernes: [], Sabado: [] };

  for (const s of slotsP1 || []) {
    const dia = s.split('-')[0];
    if (p1PorDia[dia]) p1PorDia[dia].push(s);
  }
  for (const s of slotsP2 || []) {
    const dia = s.split('-')[0];
    if (p2PorDia[dia]) p2PorDia[dia].push(s);
  }

  const candidatos = [];

  for (const slot of slotsValidos) {
    const slotId = slot.slotId;
    const dia = slot.dia || slotId.split('-')[0];
    const hora = slot.hora || slotId.split('-')[1];

    const inP1 = setP1.has(slotId);
    const inP2 = setP2.has(slotId);

    const p1SlotsDia = p1PorDia[dia] || [];
    const p2SlotsDia = p2PorDia[dia] || [];

    // Detectar si hay trasnoche
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

    // Si alguna pareja no tiene disponibilidad en ese día, la distancia se considera alta (999)
    const distP1 = resP1.abs === Infinity ? 999 : resP1.signed;
    const distP2 = resP2.abs === Infinity ? 999 : resP2.signed;
    const distP1Abs = Math.abs(distP1);
    const distP2Abs = Math.abs(distP2);
    const distTotal = distP1Abs + distP2Abs;

    const addToP1 = !inP1;
    const addToP2 = !inP2;
    const cantidadPartesQueEstiran = (addToP1 ? 1 : 0) + (addToP2 ? 1 : 0);

    candidatos.push({
      ...slot,
      slotId,
      dia,
      hora,
      distP1,
      distP2,
      distTotal,
      addToP1,
      addToP2,
      cantidadPartesQueEstiran,
      canchasLibres: slot.canchasLibres || [],
    });
  }

  candidatos.sort((a, b) => {
    // 1. Criterio primario: Certeza (0 partes > 1 parte > 2 partes que estiran)
    if (a.cantidadPartesQueEstiran !== b.cantidadPartesQueEstiran) {
      return a.cantidadPartesQueEstiran - b.cantidadPartesQueEstiran;
    }
    // 2. Criterio secundario: Menor esfuerzo total
    if (a.distTotal !== b.distTotal) {
      return a.distTotal - b.distTotal;
    }
    // 3. Criterio terciario: Balance
    const balanceA = Math.abs(Math.abs(a.distP1) - Math.abs(a.distP2));
    const balanceB = Math.abs(Math.abs(b.distP1) - Math.abs(b.distP2));
    if (balanceA !== balanceB) return balanceA - balanceB;

    // 4. Criterio cuaternario: Cronológico
    if (a.dia !== b.dia) {
      return a.dia === 'Viernes' ? -1 : 1;
    }
    return horaAMinutos(a.hora) - horaAMinutos(b.hora);
  });

  return candidatos;
}
