const prisma = require('../lib/prisma');
const { getSlotsValidosSet, generarGrillaOrganizador } = require('./slots.service');
const {
  iniciarTorneo,
  iniciarTorneoConDisponibilidad,
  asignarHorariosAutomatico,
} = require('./zona.service');

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

  // Buscar todos los SlotPareja de todos los torneos de este organizador
  const slotsActuales = await prisma.slotPareja.findMany({
    where: {
      pareja: {
        torneo: { organizadorId },
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

    // Limpiar slots de parejas de todos los torneos que ya no caigan en la nueva grilla
    const nuevosSlotsValidos = getSlotsValidosSet(updated);
    const slotsActuales = await tx.slotPareja.findMany({
      where: {
        pareja: {
          torneo: { organizadorId },
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
 * Inicia todos los torneos en estado BORRADOR y asigna sus horarios automáticamente
 * aplicando prioridad "Most Constrained First" (menor disponibilidad promedio de turnos primero).
 */
async function iniciarTodosLosTorneos(organizadorId) {
  const torneosBorrador = await prisma.torneo.findMany({
    where: {
      organizadorId,
      estado: 'BORRADOR',
    },
    include: {
      parejas: {
        include: {
          slotsSeleccionados: true,
        },
      },
    },
  });

  if (torneosBorrador.length === 0) {
    const error = new Error('No hay torneos en estado Borrador para iniciar.');
    error.statusCode = 400;
    throw error;
  }

  const validos = [];
  const omitidos = [];

  for (const t of torneosBorrador) {
    if (t.parejas.length < 2) {
      omitidos.push({
        id: t.id,
        nombre: t.nombre,
        motivo: 'Tiene menos de 2 parejas inscriptas.',
      });
    } else {
      const totalSlots = t.parejas.reduce((acc, p) => acc + p.slotsSeleccionados.length, 0);
      const parejasConSlots = t.parejas.filter((p) => p.slotsSeleccionados.length > 0).length;
      const tieneDisponibilidad = parejasConSlots > 0;

      // Score de flexibilidad: menor promedio = más restringido (prioridad 1°)
      // Si no tiene disponibilidad cargada, score muy alto para que se programe al final
      const scoreFlexibilidad = tieneDisponibilidad
        ? totalSlots / t.parejas.length
        : 999999;

      validos.push({
        torneo: t,
        tieneDisponibilidad,
        scoreFlexibilidad,
        avgSlots: tieneDisponibilidad ? Number((totalSlots / t.parejas.length).toFixed(1)) : 0,
      });
    }
  }

  if (validos.length === 0) {
    const error = new Error('Ninguno de los torneos en borrador cuenta con al menos 2 parejas.');
    error.statusCode = 400;
    throw error;
  }

  // 1. Iniciar zonas en cada torneo válido (por disponibilidad o sorteo aleatorio)
  for (const item of validos) {
    if (item.tieneDisponibilidad) {
      await iniciarTorneoConDisponibilidad(organizadorId, item.torneo.id);
    } else {
      await iniciarTorneo(organizadorId, item.torneo.id);
    }
  }

  // 2. Ordenar torneos por restricción (menor score / promedio de slots primero)
  validos.sort((a, b) => a.scoreFlexibilidad - b.scoreFlexibilidad);

  // 3. Asignar horarios y canchas en orden de prioridad cross-torneo
  const resumen = [];
  for (const item of validos) {
    const resultadoHorarios = await asignarHorariosAutomatico(organizadorId, item.torneo.id);
    resumen.push({
      torneoId: item.torneo.id,
      nombre: item.torneo.nombre,
      asignados: resultadoHorarios.asignados,
      sinHorario: resultadoHorarios.sinHorario,
      total: resultadoHorarios.total,
      promedioSlots: item.avgSlots,
    });
  }

  return {
    message: 'Torneos iniciados y programados con éxito.',
    iniciados: resumen,
    omitidos,
  };
}

module.exports = {
  getOrganizador,
  simularCambioJornadaOrganizador,
  updateOrganizador,
  getSlotsGrilla,
  iniciarTodosLosTorneos,
};
