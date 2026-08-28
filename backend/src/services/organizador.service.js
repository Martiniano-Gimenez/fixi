const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { getSlotsValidosSet, generarGrillaOrganizador, calcularCasiEstrellas, calcularOpcionesResolucion } = require('./slots.service');
const {
  iniciarCategoria,
  iniciarCategoriaConDisponibilidad,
  asignarHorariosAutomatico,
  fusionarSlotsEnVentanas,
  interseccionVentanas,
  parseSlotToDate,
} = require('./zona.service');

// Cache de planes validados en memoria para inicio determinista
const planesCache = new Map();
const PLAN_TTL_MS = 5 * 60 * 1000; // 5 minutos

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of planesCache) {
    if (v.expiresAt < now) planesCache.delete(k);
  }
}, 60_000);

function getCanchasEfectivas(torneo, organizador) {
  if (torneo && torneo.canchasDisponiblesOverride != null) {
    return Math.min(torneo.canchasDisponiblesOverride, organizador?.cantidadCanchas || 1);
  }
  return organizador?.cantidadCanchas || 1;
}

function buildFingerprint(organizador, categoriasConParejas) {
  const clubPart = [
    organizador.cantidadCanchas || 1,
    organizador.viernesInicio || '',
    organizador.viernesFin || '',
    organizador.sabadoInicio || '',
    organizador.sabadoFin || '',
  ].join(',');

  const categoriasPart = (categoriasConParejas || [])
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((c) => {
      const parejasPart = (c.parejas || [])
        .slice()
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((p) => {
          const slotsStr = (p.slotsSeleccionados || [])
            .map((s) => s.slotId)
            .sort()
            .join(',');
          return `${p.id}=${slotsStr}`;
        })
        .join('|');
      return `${c.id}:${parejasPart}`;
    });

  return JSON.stringify([clubPart, ...categoriasPart]);
}

async function getOrganizador(organizadorId) {
  const organizador = await prisma.organizador.findUnique({
    where: { id: organizadorId },
    select: {
      id: true,
      email: true,
      nombre: true,
      cantidadCanchas: true,
      viernesInicio: true,
      viernesFin: true,
      sabadoInicio: true,
      sabadoFin: true,
      createdAt: true,
    },
  });

  if (!organizador) {
    const error = new Error('Organizador no encontrado.');
    error.statusCode = 404;
    throw error;
  }

  return organizador;
}

async function simularCambioJornadaOrganizador(organizadorId, nuevaJornada) {
  const organizador = await getOrganizador(organizadorId);

  const organizadorProyectado = {
    ...organizador,
    viernesInicio: nuevaJornada.viernesInicio !== undefined ? nuevaJornada.viernesInicio : organizador.viernesInicio,
    viernesFin: nuevaJornada.viernesFin !== undefined ? nuevaJornada.viernesFin : organizador.viernesFin,
    sabadoInicio: nuevaJornada.sabadoInicio !== undefined ? nuevaJornada.sabadoInicio : organizador.sabadoInicio,
    sabadoFin: nuevaJornada.sabadoFin !== undefined ? nuevaJornada.sabadoFin : organizador.sabadoFin,
  };

  const nuevosSlotsValidos = getSlotsValidosSet(organizadorProyectado);

  const slotsActuales = await prisma.slotPareja.findMany({
    where: {
      pareja: {
        categoria: {
          torneo: { organizadorId },
        },
      },
    },
    select: { id: true, parejaId: true, slotId: true },
  });

  const slotsInvalidos = slotsActuales.filter((s) => !nuevosSlotsValidos.has(s.slotId));
  const parejasAfectadasIds = new Set(slotsInvalidos.map((s) => s.parejaId));

  return {
    slotsAfectados: slotsInvalidos.length,
    parejasAfectadas: parejasAfectadasIds.size,
  };
}

async function updateOrganizador(organizadorId, data) {
  const organizador = await getOrganizador(organizadorId);

  const updateData = {};
  if (data.nombre !== undefined) updateData.nombre = data.nombre;
  if (data.cantidadCanchas !== undefined) updateData.cantidadCanchas = Math.max(1, Number(data.cantidadCanchas));
  if (data.viernesInicio !== undefined) updateData.viernesInicio = data.viernesInicio || null;
  if (data.viernesFin !== undefined) updateData.viernesFin = data.viernesFin || null;
  if (data.sabadoInicio !== undefined) updateData.sabadoInicio = data.sabadoInicio || null;
  if (data.sabadoFin !== undefined) updateData.sabadoFin = data.sabadoFin || null;

  return await prisma.$transaction(async (tx) => {
    const updated = await tx.organizador.update({
      where: { id: organizador.id },
      data: updateData,
      select: {
        id: true,
        email: true,
        nombre: true,
        cantidadCanchas: true,
        viernesInicio: true,
        viernesFin: true,
        sabadoInicio: true,
        sabadoFin: true,
      },
    });

    const nuevosSlotsValidos = getSlotsValidosSet(updated);
    const slotsActuales = await tx.slotPareja.findMany({
      where: {
        pareja: {
          categoria: {
            torneo: { organizadorId },
          },
        },
      },
      select: { id: true, slotId: true },
    });

    const idsABorrar = slotsActuales
      .filter((s) => !nuevosSlotsValidos.has(s.slotId))
      .map((s) => s.id);

    if (idsABorrar.length > 0) {
      await tx.slotPareja.deleteMany({
        where: { id: { in: idsABorrar } },
      });
    }

    return updated;
  });
}

async function getSlotsGrilla(organizadorId) {
  const organizador = await getOrganizador(organizadorId);
  return generarGrillaOrganizador(organizador);
}

/**
 * Valida si todas las categorías en borrador de un Torneo pueden iniciarse y programarse sin conflictos horarios.
 */
async function preCheckInicioTorneo(organizadorId, torneoId) {
  const organizador = await getOrganizador(organizadorId);

  const torneo = await prisma.torneo.findUnique({
    where: { id: torneoId },
    include: {
      categorias: {
        where: { estado: 'BORRADOR' },
        include: {
          parejas: {
            include: {
              slotsSeleccionados: true,
            },
          },
        },
      },
    },
  });

  if (!torneo) {
    const error = new Error('Torneo no encontrado.');
    error.statusCode = 404;
    throw error;
  }

  if (torneo.organizadorId !== organizadorId) {
    const error = new Error('No tenés permisos sobre este torneo.');
    error.statusCode = 403;
    throw error;
  }

  const categoriasBorrador = torneo.categorias;

  if (categoriasBorrador.length === 0) {
    const error = new Error('No hay categorías en estado Borrador en este torneo para iniciar.');
    error.statusCode = 400;
    throw error;
  }

  const validos = [];
  const omitidos = [];

  for (const c of categoriasBorrador) {
    if (c.parejas.length < 2) {
      omitidos.push({
        id: c.id,
        nombre: c.nombre,
        motivo: 'Tiene menos de 2 parejas inscriptas.',
      });
    } else {
      const totalSlots = c.parejas.reduce((acc, p) => acc + p.slotsSeleccionados.length, 0);
      const parejasConSlots = c.parejas.filter((p) => p.slotsSeleccionados.length > 0).length;
      const tieneDisponibilidad = parejasConSlots > 0;

      const scoreFlexibilidad = tieneDisponibilidad
        ? totalSlots / c.parejas.length
        : 999999;

      validos.push({
        categoria: c,
        tieneDisponibilidad,
        scoreFlexibilidad,
        avgSlots: tieneDisponibilidad ? Number((totalSlots / c.parejas.length).toFixed(1)) : 0,
      });
    }
  }

  if (validos.length === 0) {
    const error = new Error('Ninguna de las categorías en borrador cuenta con al menos 2 parejas.');
    error.statusCode = 400;
    throw error;
  }

  const fingerprint = buildFingerprint(organizador, categoriasBorrador);

  const PLANNED_ROLLBACK = Symbol('PLANNED_ROLLBACK');
  let dryRunResult = null;

  try {
    await prisma.$transaction(async (tx) => {
      // 1. Iniciar zonas en cada categoría válida (usando tx)
      for (const item of validos) {
        if (item.tieneDisponibilidad) {
          await iniciarCategoriaConDisponibilidad(organizadorId, item.categoria.id, tx);
        } else {
          await iniciarCategoria(organizadorId, item.categoria.id, tx);
        }
      }

      // 2. Ordenar categorías por restricción (menor score / promedio de slots primero)
      validos.sort((a, b) => a.scoreFlexibilidad - b.scoreFlexibilidad);

      // 3. Asignar horarios y canchas en tx con pool global multi-categoría (MCF Global)
      const categoriasIdsValidos = validos.map((v) => v.categoria.id);
      await asignarHorariosAutomatico(organizadorId, categoriasIdsValidos, tx);

      // 4. Buscar partidos sin horario asignado y zonas manuales por incompatibilidad
      const partidosSinHorario = await tx.partido.findMany({
        where: {
          categoriaId: { in: categoriasIdsValidos },
          sinHorarioAsignado: true,
        },
        include: {
          categoria: { select: { id: true, nombre: true } },
          pareja1: {
            select: {
              id: true,
              jugador1: true,
              jugador2: true,
              slotsSeleccionados: { select: { slotId: true } },
            },
          },
          pareja2: {
            select: {
              id: true,
              jugador1: true,
              jugador2: true,
              slotsSeleccionados: { select: { slotId: true } },
            },
          },
          zona: { select: { id: true, nombre: true } },
        },
      });

      const zonasManuales = await tx.zona.findMany({
        where: {
          categoriaId: { in: categoriasIdsValidos },
          requiereArmadoManual: true,
        },
        include: {
          categoria: { select: { id: true, nombre: true } },
          zonaParejas: {
            include: {
              pareja: {
                select: {
                  id: true,
                  jugador1: true,
                  jugador2: true,
                  slotsSeleccionados: { select: { slotId: true } },
                },
              },
            },
          },
        },
      });

      if (partidosSinHorario.length > 0 || zonasManuales.length > 0) {
        // Conteo de frecuencia de apariciones de cada pareja
        const parejaFreqMap = new Map();
        for (const p of partidosSinHorario) {
          if (p.pareja1Id) parejaFreqMap.set(p.pareja1Id, (parejaFreqMap.get(p.pareja1Id) || 0) + 1);
          if (p.pareja2Id) parejaFreqMap.set(p.pareja2Id, (parejaFreqMap.get(p.pareja2Id) || 0) + 1);
        }
        for (const zm of zonasManuales) {
          for (const zp of zm.zonaParejas) {
            if (zp.pareja?.id) {
              parejaFreqMap.set(zp.pareja.id, (parejaFreqMap.get(zp.pareja.id) || 0) + 1);
            }
          }
        }

        const refFecha = torneo.fecha || new Date();

        // Obtener partidos que sí pudieron agendarse en la simulación
        const partidosConHorario = await tx.partido.findMany({
          where: {
            categoriaId: { in: categoriasIdsValidos },
            fechaHora: { not: null },
            canchaNumero: { not: null },
          },
          select: {
            fechaHora: true,
            canchaNumero: true,
            pareja1Id: true,
            pareja2Id: true,
          },
        });

        const partidosIntervalos = partidosConHorario.map((p) => {
          const startMs = new Date(p.fechaHora).getTime();
          const endMs = startMs + 75 * 60 * 1000;
          return {
            canchaNumero: p.canchaNumero,
            startMs,
            endMs,
            pareja1Id: p.pareja1Id,
            pareja2Id: p.pareja2Id,
          };
        });

        const cantCanchas = organizador.cantidadCanchas || 1;
        const grilla = generarGrillaOrganizador(organizador);
        const allSlotIds = [...grilla.viernes, ...grilla.sabado];
        const slotsEvaluadosMap = new Map();

        for (const sId of allSlotIds) {
          const sDate = parseSlotToDate(sId, refFecha);
          if (!sDate) continue;
          const sStartMs = sDate.getTime();
          const sEndMs = sStartMs + 75 * 60 * 1000;

          const canchasOcupadas = new Set();
          const parejasOcupadas = new Set();

          for (const p of partidosIntervalos) {
            if (Math.max(sStartMs, p.startMs) < Math.min(sEndMs, p.endMs)) {
              if (p.canchaNumero) canchasOcupadas.add(p.canchaNumero);
              if (p.pareja1Id) parejasOcupadas.add(p.pareja1Id);
              if (p.pareja2Id) parejasOcupadas.add(p.pareja2Id);
            }
          }

          const canchasLibres = cantCanchas - canchasOcupadas.size;
          slotsEvaluadosMap.set(sId, {
            canchasLibres,
            parejasOcupadas: Array.from(parejasOcupadas),
          });
        }

        const conflictosMap = new Map();

        for (const p of partidosSinHorario) {
          const cId = p.categoria.id;
          if (!conflictosMap.has(cId)) {
            conflictosMap.set(cId, {
              categoriaId: cId,
              nombreCategoria: p.categoria.nombre,
              partidosSinHorario: [],
            });
          }

          const slotsP1 = (p.pareja1?.slotsSeleccionados || []).map((s) => s.slotId);
          const slotsP2 = (p.pareja2?.slotsSeleccionados || []).map((s) => s.slotId);

          const win1 = fusionarSlotsEnVentanas(slotsP1, refFecha);
          const win2 = fusionarSlotsEnVentanas(slotsP2, refFecha);
          const shared = interseccionVentanas(win1, win2);

          const tieneFranjaComun = shared.length > 0;
          const motivo = tieneFranjaComun ? 'SIN_CANCHA_DISPONIBLE' : 'SIN_FRANJA_COMUN';

          // Criterio MCF de pareja más restringida: menor cantidad de opciones día+franja (ventanas continuas),
          // y como desempate menor cantidad total de slots.
          let p1Score = win1.length * 1000 + slotsP1.length;
          let p2Score = win2.length * 1000 + slotsP2.length;
          const p1IsMoreConstrained = p1Score <= p2Score;

          const parejaMasRestringida = p1IsMoreConstrained ? p.pareja1 : p.pareja2;
          const parejaMasRestringidaSlots = p1IsMoreConstrained ? slotsP1.length : slotsP2.length;
          const parejaMasRestringidaOpciones = p1IsMoreConstrained ? win1.length : win2.length;
          const parejaMasRestringidaSlotIds = p1IsMoreConstrained ? slotsP1 : slotsP2;
          const slotsRival = p1IsMoreConstrained ? slotsP2 : slotsP1;

          // Filtrar ÚNICAMENTE slots donde:
          // 1. Hay cancha libre en el club a esa hora
          // 2. Ninguna de las 2 parejas del cruce tiene otro partido asignado a esa hora
          const slotsViables = allSlotIds.filter((sId) => {
            const info = slotsEvaluadosMap.get(sId);
            if (!info || info.canchasLibres <= 0) return false;
            if (p.pareja1Id && info.parejasOcupadas.includes(p.pareja1Id)) return false;
            if (p.pareja2Id && info.parejasOcupadas.includes(p.pareja2Id)) return false;
            return true;
          });

          // Lista unificada de opciones de resolución (estrellas reales + casi-estrellas ordenadas por esfuerzo)
          const opcionesResolucion = calcularOpcionesResolucion(slotsP1, slotsP2, slotsViables, 6);

          const maxApariciones = Math.max(
            parejaFreqMap.get(p.pareja1Id) || 0,
            parejaFreqMap.get(p.pareja2Id) || 0
          );

          conflictosMap.get(cId).partidosSinHorario.push({
            partidoId: p.id,
            zonaId: p.zona?.id,
            zona: p.zona?.nombre || 'Zona',
            categoriaId: cId,
            pareja1Id: p.pareja1?.id,
            pareja1: p.pareja1 ? `${p.pareja1.jugador1} / ${p.pareja1.jugador2}` : 'Por definirse',
            pareja1SlotsCount: slotsP1.length,
            pareja1OpcionesCount: win1.length,
            pareja1SlotIds: slotsP1,
            pareja2Id: p.pareja2?.id,
            pareja2: p.pareja2 ? `${p.pareja2.jugador1} / ${p.pareja2.jugador2}` : 'Por definirse',
            pareja2SlotsCount: slotsP2.length,
            pareja2OpcionesCount: win2.length,
            pareja2SlotIds: slotsP2,
            motivo,
            parejaMasRestringidaId: parejaMasRestringida?.id || null,
            parejaMasRestringidaNombre: parejaMasRestringida
              ? `${parejaMasRestringida.jugador1} / ${parejaMasRestringida.jugador2}`
              : '',
            parejaMasRestringidaSlots: parejaMasRestringidaSlots,
            parejaMasRestringidaOpciones: parejaMasRestringidaOpciones,
            parejaMasRestringidaSlotIds: parejaMasRestringidaSlotIds,
            slotsViables,
            opcionesResolucion,
            aparicionesMaximas: maxApariciones,
          });
        }

        for (const zm of zonasManuales) {
          const cId = zm.categoria.id;
          if (!conflictosMap.has(cId)) {
            conflictosMap.set(cId, {
              categoriaId: cId,
              nombreCategoria: zm.categoria.nombre,
              partidosSinHorario: [],
            });
          }
          const parejasNombres = zm.zonaParejas
            .map((zp) => (zp.pareja ? `${zp.pareja.jugador1} / ${zp.pareja.jugador2}` : 'Pareja'))
            .join(' | ');

          // Estructurar las parejas de la zona manual
          const rawZonaParejas = zm.zonaParejas.map((zp) => ({
            id: zp.pareja?.id,
            nombre: zp.pareja ? `${zp.pareja.jugador1} / ${zp.pareja.jugador2}` : 'Pareja',
            slotIds: (zp.pareja?.slotsSeleccionados || []).map((s) => s.slotId),
          }));

          // Para cada pareja de la zona incompleta, calcular qué slots destraban genuinamente el grupo
          const parejasManuales = rawZonaParejas.map((p) => {
            const mySlots = p.slotIds;

            // Slots viables con cancha libre y sin pareja ocupada
            const slotsViables = allSlotIds.filter((sId) => {
              const info = slotsEvaluadosMap.get(sId);
              if (!info || info.canchasLibres <= 0) return false;
              if (p.id && info.parejasOcupadas.includes(p.id)) return false;
              return true;
            });

            // Los slots que destraban: aquellos donde, si esta pareja agrega ese slot,
            // TODAS las parejas de la zona quedan con compatibilidad mutua (100% resuelto)
            const slotsQueDestraban = slotsViables.filter((sId) => {
              // Simular la zona con este slot agregado a esta pareja
              const simulated = rawZonaParejas.map((item) => {
                if (item.id === p.id) {
                  return Array.from(new Set([...item.slotIds, sId]));
                }
                return item.slotIds;
              });

              for (let i = 0; i < simulated.length; i++) {
                for (let j = i + 1; j < simulated.length; j++) {
                  const s1 = simulated[i];
                  const s2 = simulated[j];
                  const shared = s1.filter((slot) => s2.includes(slot));
                  if (shared.length === 0) return false;
                }
              }
              return true;
            });

            return {
              id: p.id,
              nombre: p.nombre,
              slotsCount: mySlots.length,
              slotIds: mySlots,
              slotsViables,
              slotsQueDestraban,
            };
          });

          // Calcular qué pares de parejas dentro de la zona manual no tienen horarios en común
          const crucesIncompatibles = [];
          for (let i = 0; i < rawZonaParejas.length; i++) {
            for (let j = i + 1; j < rawZonaParejas.length; j++) {
              const p1 = rawZonaParejas[i];
              const p2 = rawZonaParejas[j];
              const shared = p1.slotIds.filter((slot) => p2.slotIds.includes(slot));
              if (shared.length === 0) {
                crucesIncompatibles.push({
                  p1: p1.nombre,
                  p2: p2.nombre,
                  p1Id: p1.id,
                  p2Id: p2.id,
                });
              }
            }
          }

          conflictosMap.get(cId).partidosSinHorario.push({
            partidoId: zm.id,
            zonaId: zm.id,
            zona: zm.nombre,
            categoriaId: cId,
            motivo: 'ZONA_MANUAL_INCOMPLETA',
            pareja1: 'Incompatibilidad de grupo',
            pareja2: parejasNombres,
            parejasManuales,
            crucesIncompatibles,
            aparicionesMaximas: 999, // Alta prioridad
          });
        }

        // Ordenar conflictos de cada categoría: primero zonas manuales y parejas con más conflictos (frecuencia)
        for (const catConflicto of conflictosMap.values()) {
          catConflicto.partidosSinHorario.sort((a, b) => b.aparicionesMaximas - a.aparicionesMaximas);
        }

        let planEmergenciaId = null;
        if (zonasManuales.length === 0) {
          const categoriasPlan = [];
          for (const v of validos) {
            const zonasTx = await tx.zona.findMany({
              where: { categoriaId: v.categoria.id },
              include: {
                zonaParejas: { select: { parejaId: true } },
                partidos: {
                  select: {
                    posicionEnRonda: true,
                    pareja1Id: true,
                    pareja2Id: true,
                    fechaHora: true,
                    canchaNumero: true,
                    sinHorarioAsignado: true,
                  },
                },
              },
            });

            categoriasPlan.push({
              categoriaId: v.categoria.id,
              nombre: v.categoria.nombre,
              avgSlots: v.avgSlots,
              zonas: zonasTx.map((z) => ({
                nombre: z.nombre,
                clasifican: z.clasifican,
                formato: z.formato,
                requiereArmadoManual: z.requiereArmadoManual || false,
                parejaIds: z.zonaParejas.map((zp) => zp.parejaId),
                partidos: z.partidos.map((p) => ({
                  posicionEnRonda: p.posicionEnRonda,
                  pareja1Id: p.pareja1Id,
                  pareja2Id: p.pareja2Id,
                  fechaHora: p.fechaHora,
                  canchaNumero: p.canchaNumero,
                  sinHorarioAsignado: p.sinHorarioAsignado || false,
                })),
              })),
            });
          }

          planEmergenciaId = crypto.randomUUID();
          const expiresAt = Date.now() + PLAN_TTL_MS;

          planesCache.set(planEmergenciaId, {
            planId: planEmergenciaId,
            organizadorId,
            torneoId,
            expiresAt,
            fingerprint,
            categoriasPlan,
            omitidos,
            esEmergencia: true,
          });
        }

        dryRunResult = {
          bloqueado: true,
          motivo: 'Existen partidos o zonas sin horario compatible asignado.',
          conflictos: Array.from(conflictosMap.values()),
          grillaOrganizador: generarGrillaOrganizador(organizador),
          permiteInicioEmergencia: zonasManuales.length === 0,
          planEmergenciaId,
          omitidos,
        };
      } else {
        // Armar el snapshot LÓGICO para persistirlo al confirmar
        const categoriasPlan = [];
        for (const v of validos) {
          const zonasTx = await tx.zona.findMany({
            where: { categoriaId: v.categoria.id },
            include: {
              zonaParejas: { select: { parejaId: true } },
              partidos: {
                select: {
                  posicionEnRonda: true,
                  pareja1Id: true,
                  pareja2Id: true,
                  fechaHora: true,
                  canchaNumero: true,
                  sinHorarioAsignado: true,
                },
              },
            },
          });

          categoriasPlan.push({
            categoriaId: v.categoria.id,
            nombre: v.categoria.nombre,
            avgSlots: v.avgSlots,
            zonas: zonasTx.map((z) => ({
              nombre: z.nombre,
              clasifican: z.clasifican,
              formato: z.formato,
              requiereArmadoManual: z.requiereArmadoManual || false,
              parejaIds: z.zonaParejas.map((zp) => zp.parejaId),
              partidos: z.partidos.map((p) => ({
                posicionEnRonda: p.posicionEnRonda,
                pareja1Id: p.pareja1Id,
                pareja2Id: p.pareja2Id,
                fechaHora: p.fechaHora,
                canchaNumero: p.canchaNumero,
                sinHorarioAsignado: p.sinHorarioAsignado || false,
              })),
            })),
          });
        }

        const planId = crypto.randomUUID();
        const expiresAt = Date.now() + PLAN_TTL_MS;

        planesCache.set(planId, {
          planId,
          organizadorId,
          torneoId,
          expiresAt,
          fingerprint,
          categoriasPlan,
          omitidos,
        });

        dryRunResult = {
          bloqueado: false,
          planId,
          torneoId,
          categoriasAIniciar: validos.map((v) => ({ id: v.categoria.id, nombre: v.categoria.nombre })),
          omitidos,
        };
      }

      throw PLANNED_ROLLBACK;
    });
  } catch (err) {
    if (err !== PLANNED_ROLLBACK) {
      throw err;
    }
  }

  return dryRunResult;
}

/**
 * Inicia las categorías del Torneo y aplica el plan precalculado.
 */
async function iniciarTorneoMultiCategoria(organizadorId, torneoId, planId = null) {
  if (planId) {
    const cached = planesCache.get(planId);
    if (!cached || cached.expiresAt < Date.now() || cached.organizadorId !== organizadorId || cached.torneoId !== torneoId) {
      const error = new Error('El plan de inicio expiró o no es válido. Por favor volvé a verificar.');
      error.statusCode = 400;
      throw error;
    }

    const organizador = await getOrganizador(organizadorId);
    const torneo = await prisma.torneo.findUnique({
      where: { id: torneoId },
      include: {
        categorias: {
          where: { estado: 'BORRADOR' },
          include: { parejas: { include: { slotsSeleccionados: true } } },
        },
      },
    });

    const currentFingerprint = buildFingerprint(organizador, torneo?.categorias || []);
    if (currentFingerprint !== cached.fingerprint) {
      planesCache.delete(planId);
      const error = new Error('Los datos del club o las parejas cambiaron desde la última verificación. Volvé a verificar antes de iniciar.');
      error.statusCode = 409;
      throw error;
    }

    // Aplicar el plan cacheado a la base de datos
    const resumen = [];
    await prisma.$transaction(async (tx) => {
      for (const cPlan of cached.categoriasPlan) {
        const categoria = await tx.categoria.findUnique({ where: { id: cPlan.categoriaId } });
        if (!categoria || categoria.estado !== 'BORRADOR') {
          throw new Error(`La categoría "${cPlan.nombre}" ya no está en estado Borrador.`);
        }

        let asignadosCount = 0;
        let sinHorarioCount = 0;

        for (const zData of cPlan.zonas) {
          const zona = await tx.zona.create({
            data: {
              categoriaId: cPlan.categoriaId,
              nombre: zData.nombre,
              clasifican: zData.clasifican,
              formato: zData.formato,
              requiereArmadoManual: zData.requiereArmadoManual || false,
            },
          });

          for (const pId of zData.parejaIds) {
            await tx.zonaPareja.create({
              data: { zonaId: zona.id, parejaId: pId },
            });
          }

          for (const pData of zData.partidos) {
            await tx.partido.create({
              data: {
                categoriaId: cPlan.categoriaId,
                zonaId: zona.id,
                posicionEnRonda: pData.posicionEnRonda,
                pareja1Id: pData.pareja1Id,
                pareja2Id: pData.pareja2Id,
                fechaHora: pData.fechaHora ? new Date(pData.fechaHora) : null,
                canchaNumero: pData.canchaNumero,
                sinHorarioAsignado: pData.sinHorarioAsignado,
                estado: 'PENDIENTE',
              },
            });

            if (pData.sinHorarioAsignado) sinHorarioCount++;
            else if (pData.fechaHora) asignadosCount++;
          }
        }

        await tx.categoria.update({
          where: { id: cPlan.categoriaId },
          data: { estado: 'EN_CURSO' },
        });

        resumen.push({
          categoriaId: cPlan.categoriaId,
          nombre: cPlan.nombre,
          zonas: cPlan.zonas.length,
          asignados: asignadosCount,
          sinHorario: sinHorarioCount,
        });
      }

      await tx.torneo.update({
        where: { id: torneoId },
        data: { estado: 'EN_CURSO' },
      });
    });

    planesCache.delete(planId);

    return {
      message: 'Torneo iniciado y horarios asignados exitosamente.',
      categoriasIniciadas: resumen,
      omitidos: cached.omitidos || [],
    };
  }

  // Si no se proveyó planId, ejecutar preCheck y luego aplicar
  const preCheck = await preCheckInicioTorneo(organizadorId, torneoId);
  if (preCheck.bloqueado) {
    const error = new Error(preCheck.motivo);
    error.statusCode = 400;
    error.conflictos = preCheck.conflictos;
    throw error;
  }
  return await iniciarTorneoMultiCategoria(organizadorId, torneoId, preCheck.planId);
}

/**
 * Obtiene los partidos sin horario asignado de un torneo
 */
async function getPartidosSinHorarioTorneo(organizadorId, torneoId) {
  const torneo = await prisma.torneo.findUnique({
    where: { id: torneoId },
  });

  if (!torneo) {
    const error = new Error('Torneo no encontrado.');
    error.statusCode = 404;
    throw error;
  }

  if (torneo.organizadorId !== organizadorId) {
    const error = new Error('No tenés permisos sobre este torneo.');
    error.statusCode = 403;
    throw error;
  }

  const partidos = await prisma.partido.findMany({
    where: {
      categoria: { torneoId },
      sinHorarioAsignado: true,
      estado: { not: 'FINALIZADO' },
    },
    include: {
      categoria: { select: { id: true, nombre: true } },
      zona: { select: { id: true, nombre: true } },
      faseEliminatoria: { select: { id: true, nombre: true, ronda: true } },
      pareja1: {
        select: {
          id: true,
          jugador1: true,
          jugador2: true,
          slotsSeleccionados: { select: { slotId: true } },
        },
      },
      pareja2: {
        select: {
          id: true,
          jugador1: true,
          jugador2: true,
          slotsSeleccionados: { select: { slotId: true } },
        },
      },
    },
    orderBy: [
      { categoria: { nombre: 'asc' } },
      { zona: { nombre: 'asc' } },
      { posicionEnRonda: 'asc' },
    ],
  });

  const organizador = await getOrganizador(organizadorId);
  const grilla = generarGrillaOrganizador(organizador);
  const cantCanchas = getCanchasEfectivas(torneo, organizador);
  const refFecha = torneo.fecha || new Date();

  // Buscar todos los partidos con fechaHora y canchaNumero asignados en este torneo
  const partidosAsignados = await prisma.partido.findMany({
    where: {
      categoria: { torneoId },
      fechaHora: { not: null },
      canchaNumero: { not: null },
    },
    select: {
      id: true,
      fechaHora: true,
      canchaNumero: true,
      pareja1Id: true,
      pareja2Id: true,
    },
  });

  const partidosIntervalos = partidosAsignados.map((p) => {
    const startMs = new Date(p.fechaHora).getTime();
    const endMs = startMs + 75 * 60 * 1000;
    return {
      partidoId: p.id,
      canchaNumero: p.canchaNumero,
      startMs,
      endMs,
      pareja1Id: p.pareja1Id,
      pareja2Id: p.pareja2Id,
    };
  });

  const allSlotIds = [...grilla.viernes, ...grilla.sabado];
  const slotsEvaluados = [];

  for (const slotId of allSlotIds) {
    const slotDate = parseSlotToDate(slotId, refFecha);
    if (!slotDate) continue;

    const slotStartMs = slotDate.getTime();
    const slotEndMs = slotStartMs + 75 * 60 * 1000;

    let canchasOcupadasCount = 0;
    const parejasJugandoEnSlot = new Set();

    for (const p of partidosIntervalos) {
      if (Math.max(slotStartMs, p.startMs) < Math.min(slotEndMs, p.endMs)) {
        if (p.canchaNumero) canchasOcupadasCount++;
        if (p.pareja1Id) parejasJugandoEnSlot.add(p.pareja1Id);
        if (p.pareja2Id) parejasJugandoEnSlot.add(p.pareja2Id);
      }
    }

    const canchasLibres = cantCanchas - canchasOcupadasCount;
    slotsEvaluados.push({
      slotId,
      canchasLibres,
      parejasJugando: Array.from(parejasJugandoEnSlot),
    });
  }

  // Para cada partido sin horario calculamos slotsViables y nivel de urgencia
  const partidosConUrgencia = partidos.map((p) => {
    const p1Slots = (p.pareja1?.slotsSeleccionados || []).map((s) => s.slotId);
    const p2Slots = (p.pareja2?.slotsSeleccionados || []).map((s) => s.slotId);
    const slotsEnComunOriginales = p1Slots.filter((s) => p2Slots.includes(s));

    const slotsViables = slotsEvaluados
      .filter((s) => {
        if (s.canchasLibres <= 0) return false;
        if (p.pareja1Id && s.parejasJugando.includes(p.pareja1Id)) return false;
        if (p.pareja2Id && s.parejasJugando.includes(p.pareja2Id)) return false;
        return true;
      })
      .map((s) => s.slotId);

    const slotsViablesCount = slotsViables.length;
    const slotsValidosConEstrella = slotsViables.filter((sId) => slotsEnComunOriginales.includes(sId));
    const slotsValidosConEstrellaCount = slotsValidosConEstrella.length;

    let urgencia = 'BAJA';
    if (slotsViablesCount <= 1) {
      urgencia = 'ALTA';
    } else if (slotsViablesCount <= 3) {
      urgencia = 'MEDIA';
    }

    return {
      ...p,
      slotsViables,
      slotsViablesCount,
      slotsEnComunOriginales,
      slotsEnComunCount: slotsEnComunOriginales.length,
      slotsValidosConEstrella,
      slotsValidosConEstrellaCount,
      urgencia,
    };
  });

  // Ordenar Most Constrained First (los más restringidos primero)
  partidosConUrgencia.sort((a, b) => {
    if (a.slotsViablesCount !== b.slotsViablesCount) {
      return a.slotsViablesCount - b.slotsViablesCount;
    }
    const catA = a.categoria?.nombre || '';
    const catB = b.categoria?.nombre || '';
    if (catA !== catB) return catA.localeCompare(catB);
    const zonaA = a.zona?.nombre || '';
    const zonaB = b.zona?.nombre || '';
    if (zonaA !== zonaB) return zonaA.localeCompare(zonaB);
    return (a.posicionEnRonda || 0) - (b.posicionEnRonda || 0);
  });

  return partidosConUrgencia;
}

/**
 * Obtiene el estado de ocupación de canchas y slots libres en tiempo real para un torneo
 */
async function getCanchasDisponiblesTorneo(organizadorId, torneoId, ignorePartidoId = null) {
  const organizador = await getOrganizador(organizadorId);
  const torneo = await prisma.torneo.findUnique({ where: { id: torneoId } });
  if (!torneo) {
    const error = new Error('Torneo no encontrado.');
    error.statusCode = 404;
    throw error;
  }

  if (torneo.organizadorId !== organizadorId) {
    const error = new Error('No tenés permisos sobre este torneo.');
    error.statusCode = 403;
    throw error;
  }

  const grilla = generarGrillaOrganizador(organizador);
  const cantCanchas = getCanchasEfectivas(torneo, organizador);
  const refFecha = torneo.fecha || new Date();

  // Buscar todos los partidos con fechaHora y canchaNumero asignados en este torneo
  const partidosAsignados = await prisma.partido.findMany({
    where: {
      categoria: { torneoId },
      fechaHora: { not: null },
      canchaNumero: { not: null },
      ...(ignorePartidoId ? { id: { not: ignorePartidoId } } : {}),
    },
    select: {
      id: true,
      fechaHora: true,
      canchaNumero: true,
      pareja1Id: true,
      pareja2Id: true,
      categoria: { select: { nombre: true } },
      pareja1: { select: { jugador1: true, jugador2: true } },
      pareja2: { select: { jugador1: true, jugador2: true } },
    },
  });

  const partidosIntervalos = partidosAsignados.map((p) => {
    const startMs = new Date(p.fechaHora).getTime();
    const endMs = startMs + 75 * 60 * 1000;
    return {
      partidoId: p.id,
      canchaNumero: p.canchaNumero,
      startMs,
      endMs,
      pareja1Id: p.pareja1Id,
      pareja2Id: p.pareja2Id,
    };
  });

  const slotsEvaluados = [];
  const allSlotIds = [...grilla.viernes, ...grilla.sabado];

  for (const slotId of allSlotIds) {
    const [dia, hora] = slotId.split('-');
    const slotDate = parseSlotToDate(slotId, refFecha);
    if (!slotDate) continue;

    const slotStartMs = slotDate.getTime();
    const slotEndMs = slotStartMs + 75 * 60 * 1000;

    const canchasOcupadas = [];
    const parejasJugandoEnSlot = new Set();

    for (const p of partidosIntervalos) {
      if (Math.max(slotStartMs, p.startMs) < Math.min(slotEndMs, p.endMs)) {
        if (p.canchaNumero) canchasOcupadas.push(p.canchaNumero);
        if (p.pareja1Id) parejasJugandoEnSlot.add(p.pareja1Id);
        if (p.pareja2Id) parejasJugandoEnSlot.add(p.pareja2Id);
      }
    }

    const canchasLibres = [];
    for (let c = 1; c <= cantCanchas; c++) {
      if (!canchasOcupadas.includes(c)) {
        canchasLibres.push(c);
      }
    }

    slotsEvaluados.push({
      slotId,
      dia,
      hora,
      fechaIso: slotDate.toISOString(),
      canchasLibres,
      canchasOcupadas,
      totalCanchas: cantCanchas,
      parejasOcupadasIds: Array.from(parejasJugandoEnSlot),
    });
  }

  return {
    cantidadCanchas: cantCanchas,
    grilla,
    slots: slotsEvaluados,
    totalPartidosAsignados: partidosAsignados.length,
  };
}

/**
 * Obtiene el estado consolidado en vivo de un torneo en curso para el dashboard Día de Torneo
 */
async function getEstadoEnVivo(organizadorId, torneoId) {
  const torneo = await prisma.torneo.findUnique({
    where: { id: torneoId },
  });

  if (!torneo) {
    const error = new Error('Torneo no encontrado.');
    error.statusCode = 404;
    throw error;
  }

  if (torneo.organizadorId !== organizadorId) {
    const error = new Error('No tenés permisos sobre este torneo.');
    error.statusCode = 403;
    throw error;
  }

  if (torneo.estado !== 'EN_CURSO') {
    const error = new Error('El modo Día de Torneo solo está disponible para torneos en curso.');
    error.statusCode = 400;
    throw error;
  }

  const organizador = await getOrganizador(organizadorId);
  const canchasClub = organizador.cantidadCanchas || 1;
  const canchasActivas = getCanchasEfectivas(torneo, organizador);

  const partidos = await prisma.partido.findMany({
    where: {
      categoria: { torneoId },
    },
    include: {
      categoria: { select: { id: true, nombre: true } },
      zona: { select: { id: true, nombre: true } },
      faseEliminatoria: { select: { id: true, nombre: true, ronda: true } },
      pareja1: { select: { id: true, jugador1: true, jugador2: true } },
      pareja2: { select: { id: true, jugador1: true, jugador2: true } },
      ganador: { select: { id: true, jugador1: true, jugador2: true } },
      sets: { orderBy: { numero: 'asc' } },
    },
    orderBy: [
      { fechaHora: 'asc' },
      { canchaNumero: 'asc' },
    ],
  });

  function formatPareja(p, origen) {
    if (p) return `${p.jugador1} / ${p.jugador2}`;
    if (origen) return origen;
    return 'Por definirse';
  }

  const DURACION_MS = (organizador.duracionPartidoMin || 75) * 60 * 1000;

  // Clasificar partidos
  const partidosEnCursoList = [];
  const partidosEnCanchaFantasmaList = [];
  const proximosPartidosList = [];

  let finalizadosCount = 0;
  let enCursoCount = 0;
  let pendientesConHorarioCount = 0;
  let pendientesSinHorarioCount = 0;

  const canchaOcupadaPorPartido = new Map();

  for (const p of partidos) {
    const p1Nombre = formatPareja(p.pareja1, p.origenPareja1);
    const p2Nombre = formatPareja(p.pareja2, p.origenPareja2);
    const formatted = {
      id: p.id,
      categoriaId: p.categoriaId,
      categoria: p.categoria?.nombre || '',
      zonaId: p.zonaId,
      zona: p.zona?.nombre || null,
      faseEliminatoriaId: p.faseEliminatoriaId,
      fase: p.faseEliminatoria?.nombre || null,
      pareja1Id: p.pareja1Id,
      pareja1: p1Nombre,
      pareja2Id: p.pareja2Id,
      pareja2: p2Nombre,
      fechaHora: p.fechaHora,
      canchaNumero: p.canchaNumero,
      sinHorarioAsignado: p.sinHorarioAsignado,
      estado: p.estado,
      sets: p.sets || [],
    };

    if (p.estado === 'FINALIZADO') {
      finalizadosCount++;
    } else if (p.estado === 'EN_CURSO') {
      enCursoCount++;
      const horaInicio = p.fechaHora || new Date();
      const horaEstimadaFin = new Date(new Date(horaInicio).getTime() + DURACION_MS);
      const enCursoObj = {
        ...formatted,
        horaInicio,
        horaEstimadaFin,
      };
      partidosEnCursoList.push(enCursoObj);
      if (p.canchaNumero) {
        canchaOcupadaPorPartido.set(p.canchaNumero, enCursoObj);
      }
    } else if (p.estado === 'PENDIENTE') {
      if (p.sinHorarioAsignado || !p.fechaHora) {
        pendientesSinHorarioCount++;
      } else {
        pendientesConHorarioCount++;
        // Verificar si quedó en cancha fantasma (cancha > canchasActivas)
        if (p.canchaNumero && p.canchaNumero > canchasActivas) {
          partidosEnCanchaFantasmaList.push({
            ...formatted,
            motivo: 'Partido anterior al override en cancha inhabilitada',
          });
        } else {
          proximosPartidosList.push(formatted);
        }
      }
    }
  }

  // Grilla de canchas
  const canchas = [];
  for (let c = 1; c <= canchasClub; c++) {
    if (c > canchasActivas) {
      canchas.push({
        numero: c,
        estado: 'INHABILITADA',
        partidoActual: null,
      });
    } else {
      const partidoEnCancha = canchaOcupadaPorPartido.get(c) || null;
      canchas.push({
        numero: c,
        estado: partidoEnCancha ? 'EN_CURSO' : 'LIBRE',
        partidoActual: partidoEnCancha,
      });
    }
  }

  return {
    torneo: {
      id: torneo.id,
      nombre: torneo.nombre,
      fecha: torneo.fecha,
      estado: torneo.estado,
      slug: torneo.slug,
      canchasDisponiblesOverride: torneo.canchasDisponiblesOverride,
      overrideActivoDesde: torneo.overrideActivoDesde,
      canchasClub,
    },
    canchasActivas,
    canchasClub,
    canchas,
    partidosEnCurso: partidosEnCursoList,
    partidosEnCanchaFantasma: partidosEnCanchaFantasmaList,
    proximosPartidos: proximosPartidosList,
    resumenEstado: {
      totalPartidos: partidos.length,
      finalizados: finalizadosCount,
      enCurso: enCursoCount,
      pendientesConHorario: pendientesConHorarioCount,
      pendientesSinHorario: pendientesSinHorarioCount,
      enCanchaFantasma: partidosEnCanchaFantasmaList.length,
    },
  };
}

/**
 * Reprograma automáticamente los partidos pendientes ante una reducción de canchas activas (Modo Lluvia).
 */
async function reprogramarPorReduccionCanchas(organizadorId, torneoId, nuevoCanchasOverride) {
  const torneo = await prisma.torneo.findUnique({
    where: { id: torneoId },
  });

  if (!torneo) {
    const error = new Error('Torneo no encontrado.');
    error.statusCode = 404;
    throw error;
  }

  if (torneo.organizadorId !== organizadorId) {
    const error = new Error('No tenés permisos sobre este torneo.');
    error.statusCode = 403;
    throw error;
  }

  if (torneo.estado !== 'EN_CURSO') {
    const error = new Error('El modo Día de Torneo solo está disponible para torneos en curso.');
    error.statusCode = 400;
    throw error;
  }

  const organizador = await getOrganizador(organizadorId);
  const canchasClub = organizador.cantidadCanchas || 1;
  const canchasEfectivasActuales = getCanchasEfectivas(torneo, organizador);

  // 1. Caso: Desactivar override (volver al techo total del club)
  if (nuevoCanchasOverride === null || nuevoCanchasOverride === undefined) {
    await prisma.torneo.update({
      where: { id: torneoId },
      data: {
        canchasDisponiblesOverride: null,
        overrideActivoDesde: null,
      },
    });

    return {
      message: 'Override desactivado. Todas las canchas del club están disponibles.',
      canchasActivas: canchasClub,
      overrideActivoDesde: null,
      reprogramacion: { ejecutada: false },
    };
  }

  const overrideNum = Number(nuevoCanchasOverride);
  if (isNaN(overrideNum) || overrideNum < 1) {
    const error = new Error('La cantidad de canchas activas debe ser un número mayor o igual a 1.');
    error.statusCode = 400;
    throw error;
  }

  if (overrideNum > canchasClub) {
    const error = new Error(`La cantidad de canchas activas (${overrideNum}) no puede superar el total del club (${canchasClub}).`);
    error.statusCode = 400;
    throw error;
  }

  // 2. Caso: Si es igual o subida de canchas, NO se reprograma automáticamente
  if (overrideNum >= canchasEfectivasActuales) {
    const updated = await prisma.torneo.update({
      where: { id: torneoId },
      data: {
        canchasDisponiblesOverride: overrideNum === canchasClub ? null : overrideNum,
        overrideActivoDesde: overrideNum === canchasClub ? null : (torneo.overrideActivoDesde || new Date()),
      },
    });

    return {
      message: `Canchas activas actualizadas a ${overrideNum}.`,
      canchasActivas: overrideNum,
      overrideActivoDesde: updated.overrideActivoDesde,
      reprogramacion: { ejecutada: false },
    };
  }

  // 3. Caso: Reducción de canchas -> Validar que no haya partidos EN_CURSO en canchas a inhabilitar
  const partidosEnCursoAfectados = await prisma.partido.findMany({
    where: {
      categoria: { torneoId },
      estado: 'EN_CURSO',
      canchaNumero: { gt: overrideNum },
    },
    include: {
      pareja1: { select: { jugador1: true, jugador2: true } },
      pareja2: { select: { jugador1: true, jugador2: true } },
    },
  });

  if (partidosEnCursoAfectados.length > 0) {
    const p = partidosEnCursoAfectados[0];
    const p1 = p.pareja1 ? `${p.pareja1.jugador1}/${p.pareja1.jugador2}` : 'P1';
    const p2 = p.pareja2 ? `${p.pareja2.jugador1}/${p.pareja2.jugador2}` : 'P2';
    const error = new Error(
      `No podés reducir a ${overrideNum} canchas porque hay un partido en curso en la Cancha ${p.canchaNumero} (${p1} vs ${p2}). Esperá a que termine o finalizalo antes de reducir.`
    );
    error.statusCode = 400;
    throw error;
  }

  const ahora = new Date();
  const DURACION_MS = 75 * 60 * 1000;

  // 4. Cargar todos los partidos del torneo para armar las timelines
  const todosLosPartidos = await prisma.partido.findMany({
    where: {
      categoria: { torneoId },
    },
    include: {
      categoria: { select: { id: true, nombre: true } },
      pareja1: { select: { id: true, jugador1: true, jugador2: true } },
      pareja2: { select: { id: true, jugador1: true, jugador2: true } },
    },
  });

  const courtTimelines = new Map();
  for (let c = 1; c <= overrideNum; c++) {
    courtTimelines.set(c, []);
  }

  const parejaAssignments = new Map();

  function addInterval(cancha, pareja1Id, pareja2Id, startMs, endMs) {
    if (cancha && cancha <= overrideNum && courtTimelines.has(cancha)) {
      courtTimelines.get(cancha).push({ startMs, endMs });
    }
    if (pareja1Id) {
      if (!parejaAssignments.has(pareja1Id)) parejaAssignments.set(pareja1Id, []);
      parejaAssignments.get(pareja1Id).push({ startMs, endMs });
    }
    if (pareja2Id) {
      if (!parejaAssignments.has(pareja2Id)) parejaAssignments.set(pareja2Id, []);
      parejaAssignments.get(pareja2Id).push({ startMs, endMs });
    }
  }

  function isCourtFree(cancha, startMs, endMs) {
    const timeline = courtTimelines.get(cancha) || [];
    for (const interval of timeline) {
      if (startMs < interval.endMs && endMs > interval.startMs) {
        return false;
      }
    }
    return true;
  }

  function isPairFree(parejaId, startMs, endMs) {
    if (!parejaId) return true;
    const intervals = parejaAssignments.get(parejaId) || [];
    for (const interval of intervals) {
      if (startMs < interval.endMs && endMs > interval.startMs) {
        return false;
      }
    }
    return true;
  }

  const partidosAReprogramar = [];

  for (const p of todosLosPartidos) {
    if (p.estado === 'EN_CURSO' || p.estado === 'FINALIZADO') {
      if (p.fechaHora) {
        const startMs = new Date(p.fechaHora).getTime();
        addInterval(p.canchaNumero, p.pareja1Id, p.pareja2Id, startMs, startMs + DURACION_MS);
      }
    } else if (p.estado === 'PENDIENTE') {
      if (p.fechaHora && p.canchaNumero && !p.sinHorarioAsignado) {
        const pDate = new Date(p.fechaHora);
        if (pDate.getTime() < ahora.getTime()) {
          // Partido pendiente pasado (anterior al override): Ocupación fija (no se reprograma)
          const startMs = pDate.getTime();
          addInterval(p.canchaNumero, p.pareja1Id, p.pareja2Id, startMs, startMs + DURACION_MS);
        } else {
          // Partido pendiente futuro: A reprogramar
          partidosAReprogramar.push(p);
        }
      }
    }
  }

  // 5. Ordenar partidos a reprogramar preservando orden relativo original
  partidosAReprogramar.sort((a, b) => {
    const tA = new Date(a.fechaHora).getTime();
    const tB = new Date(b.fechaHora).getTime();
    if (tA !== tB) return tA - tB;
    if ((a.canchaNumero || 0) !== (b.canchaNumero || 0)) {
      return (a.canchaNumero || 0) - (b.canchaNumero || 0);
    }
    return a.id.localeCompare(b.id);
  });

  const cambios = [];
  let partidosReprogramados = 0;
  let partidosSinCambio = 0;
  let partidosSinHorarioNuevo = 0;
  const updates = [];

  function formatParejaNombre(p, origen) {
    if (p) return `${p.jugador1} / ${p.jugador2}`;
    if (origen) return origen;
    return 'Por definirse';
  }

  // 6. Reprogramar secuencialmente cada partido
  for (const partido of partidosAReprogramar) {
    const origDate = new Date(partido.fechaHora);
    const origStartMs = origDate.getTime();
    const origCancha = partido.canchaNumero;

    // Calcular rango del día calendario de este partido
    // Permitir extensión nocturna hasta las 04:00 AM del día siguiente
    const dayStart = new Date(origDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayLimit = new Date(dayStart.getTime() + 28 * 60 * 60 * 1000); // 04:00 del día siguiente

    // Punto de partida: el mayor entre ahora (alineado a 15min) y el horario original
    let startSearchMs = Math.max(ahora.getTime(), origStartMs);
    // Snap al próximo intervalo de 15 minutos
    const remainder = startSearchMs % (15 * 60 * 1000);
    if (remainder !== 0) {
      startSearchMs += 15 * 60 * 1000 - remainder;
    }

    let asignado = false;
    let candidateT = startSearchMs;

    while (candidateT + DURACION_MS <= dayLimit.getTime()) {
      const candidateEnd = candidateT + DURACION_MS;
      let freeCourt = null;

      for (let c = 1; c <= overrideNum; c++) {
        if (
          isCourtFree(c, candidateT, candidateEnd) &&
          isPairFree(partido.pareja1Id, candidateT, candidateEnd) &&
          isPairFree(partido.pareja2Id, candidateT, candidateEnd)
        ) {
          freeCourt = c;
          break;
        }
      }

      if (freeCourt !== null) {
        // Asignar en este slot y cancha
        addInterval(freeCourt, partido.pareja1Id, partido.pareja2Id, candidateT, candidateEnd);
        const newFechaHora = new Date(candidateT);

        const cambioHorario = newFechaHora.getTime() !== origStartMs || freeCourt !== origCancha;
        if (cambioHorario) {
          partidosReprogramados++;
          cambios.push({
            partidoId: partido.id,
            pareja1: formatParejaNombre(partido.pareja1, partido.origenPareja1),
            pareja2: formatParejaNombre(partido.pareja2, partido.origenPareja2),
            categoria: partido.categoria?.nombre || '',
            antes: { fechaHora: origDate.toISOString(), canchaNumero: origCancha },
            despues: { fechaHora: newFechaHora.toISOString(), canchaNumero: freeCourt },
          });
        } else {
          partidosSinCambio++;
        }

        updates.push({
          id: partido.id,
          fechaHora: newFechaHora,
          canchaNumero: freeCourt,
          sinHorarioAsignado: false,
        });

        asignado = true;
        break;
      }

      candidateT += 15 * 60 * 1000;
    }

    if (!asignado) {
      partidosSinHorarioNuevo++;
      partidosReprogramados++;
      cambios.push({
        partidoId: partido.id,
        pareja1: formatParejaNombre(partido.pareja1, partido.origenPareja1),
        pareja2: formatParejaNombre(partido.pareja2, partido.origenPareja2),
        categoria: partido.categoria?.nombre || '',
        antes: { fechaHora: origDate.toISOString(), canchaNumero: origCancha },
        despues: { fechaHora: null, canchaNumero: null, sinHorarioAsignado: true },
      });

      updates.push({
        id: partido.id,
        fechaHora: null,
        canchaNumero: null,
        sinHorarioAsignado: true,
      });
    }
  }

  // 7. Persistir atómicamente en base de datos
  await prisma.$transaction(async (tx) => {
    await tx.torneo.update({
      where: { id: torneoId },
      data: {
        canchasDisponiblesOverride: overrideNum,
        overrideActivoDesde: ahora,
      },
    });

    for (const u of updates) {
      await tx.partido.update({
        where: { id: u.id },
        data: {
          fechaHora: u.fechaHora,
          canchaNumero: u.canchaNumero,
          sinHorarioAsignado: u.sinHorarioAsignado,
        },
      });
    }
  });

  return {
    message: `Canchas reducidas a ${overrideNum}. Se reprogramaron ${partidosReprogramados} partidos.`,
    canchasActivas: overrideNum,
    overrideActivoDesde: ahora.toISOString(),
    reprogramacion: {
      ejecutada: true,
      partidosReprogramados,
      partidosSinCambio,
      partidosSinHorarioNuevo,
      cambios,
    },
  };
}

module.exports = {
  getOrganizador,
  updateOrganizador,
  simularCambioJornadaOrganizador,
  getSlotsGrilla,
  preCheckInicioTorneo,
  iniciarTorneoMultiCategoria,
  preCheckInicioTodos: preCheckInicioTorneo,
  iniciarTodosLosTorneos: iniciarTorneoMultiCategoria,
  getPartidosSinHorarioTorneo,
  getCanchasDisponiblesTorneo,
  getEstadoEnVivo,
  reprogramarPorReduccionCanchas,
};
