const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { getSlotsValidosSet, generarGrillaOrganizador } = require('./slots.service');
const {
  iniciarCategoria,
  iniciarCategoriaConDisponibilidad,
  asignarHorariosAutomatico,
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
          pareja1: { select: { id: true, jugador1: true, jugador2: true } },
          pareja2: { select: { id: true, jugador1: true, jugador2: true } },
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
              pareja: { select: { id: true, jugador1: true, jugador2: true } },
            },
          },
        },
      });

      if (partidosSinHorario.length > 0 || zonasManuales.length > 0) {
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
          conflictosMap.get(cId).partidosSinHorario.push({
            partidoId: p.id,
            zona: p.zona?.nombre || 'Zona',
            pareja1: p.pareja1 ? `${p.pareja1.jugador1} / ${p.pareja1.jugador2}` : 'Por definirse',
            pareja2: p.pareja2 ? `${p.pareja2.jugador1} / ${p.pareja2.jugador2}` : 'Por definirse',
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
          conflictosMap.get(cId).partidosSinHorario.push({
            partidoId: zm.id,
            zona: zm.nombre,
            pareja1: 'Incompatibilidad de grupo',
            pareja2: parejasNombres,
          });
        }

        dryRunResult = {
          bloqueado: true,
          motivo: 'Existen partidos o zonas sin horario compatible asignado.',
          conflictos: Array.from(conflictosMap.values()),
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

module.exports = {
  getOrganizador,
  updateOrganizador,
  simularCambioJornadaOrganizador,
  getSlotsGrilla,
  preCheckInicioTorneo,
  iniciarTorneoMultiCategoria,
  preCheckInicioTodos: preCheckInicioTorneo,
  iniciarTodosLosTorneos: iniciarTorneoMultiCategoria,
};
