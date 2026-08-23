const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { getSlotsValidosSet, generarGrillaOrganizador } = require('./slots.service');
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

          // Slots que el rival ya tiene marcados (destraban directamente el partido)
          const slotsQueDestraban = slotsViables.filter((sId) => slotsRival.includes(sId));

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
            pareja2Id: p.pareja2?.id,
            pareja2: p.pareja2 ? `${p.pareja2.jugador1} / ${p.pareja2.jugador2}` : 'Por definirse',
            pareja2SlotsCount: slotsP2.length,
            pareja2OpcionesCount: win2.length,
            motivo,
            parejaMasRestringidaId: parejaMasRestringida?.id || null,
            parejaMasRestringidaNombre: parejaMasRestringida
              ? `${parejaMasRestringida.jugador1} / ${parejaMasRestringida.jugador2}`
              : '',
            parejaMasRestringidaSlots: parejaMasRestringidaSlots,
            parejaMasRestringidaOpciones: parejaMasRestringidaOpciones,
            parejaMasRestringidaSlotIds: parejaMasRestringidaSlotIds,
            slotsViables,
            slotsQueDestraban,
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

          conflictosMap.get(cId).partidosSinHorario.push({
            partidoId: zm.id,
            zonaId: zm.id,
            zona: zm.nombre,
            categoriaId: cId,
            motivo: 'ZONA_MANUAL_INCOMPLETA',
            pareja1: 'Incompatibilidad de grupo',
            pareja2: parejasNombres,
            parejasManuales,
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

  return partidos;
}

/**
 * Obtiene el estado de ocupación de canchas y slots libres en tiempo real para un torneo
 */
async function getCanchasDisponiblesTorneo(organizadorId, torneoId) {
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
  const cantCanchas = organizador.cantidadCanchas || 1;
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
};
