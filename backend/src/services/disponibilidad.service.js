const prisma = require('../lib/prisma');
const { getSlotsValidosSet, ordenarSlotsCronologicamente } = require('./slots.service');

async function getParejaAndVerifyPermisos(organizadorId, parejaId) {
  const pareja = await prisma.pareja.findUnique({
    where: { id: parejaId },
    include: {
      slotsSeleccionados: { select: { slotId: true } },
      categoria: {
        include: {
          torneo: {
            include: { organizador: true },
          },
        },
      },
    },
  });

  if (!pareja) {
    const error = new Error('Pareja no encontrada.');
    error.statusCode = 404;
    throw error;
  }

  if (pareja.categoria?.torneo?.organizadorId !== organizadorId) {
    const error = new Error('No tenés permisos para acceder a esta pareja.');
    error.statusCode = 403;
    throw error;
  }

  return pareja;
}

async function getDisponibilidad(organizadorId, parejaId) {
  await getParejaAndVerifyPermisos(organizadorId, parejaId);
  const slots = await prisma.slotPareja.findMany({
    where: { parejaId },
    select: { slotId: true },
  });
  return ordenarSlotsCronologicamente(slots.map((s) => s.slotId));
}

async function setDisponibilidad(organizadorId, parejaId, slotIds) {
  const pareja = await getParejaAndVerifyPermisos(organizadorId, parejaId);

  if (pareja.categoria?.estado !== 'BORRADOR') {
    const error = new Error(
      'La disponibilidad no se puede modificar una vez iniciada la categoría. Para cambiar un horario, reprogramá el partido.'
    );
    error.statusCode = 400;
    throw error;
  }

  if (Array.isArray(slotIds) && slotIds.some((s) => typeof s === 'string' && s.startsWith('Domingo-'))) {
    const error = new Error(
      'No se pueden seleccionar horarios los domingos para la disponibilidad de zonas. Los domingos están reservados para los brackets eliminatorios.'
    );
    error.statusCode = 400;
    throw error;
  }

  // Filtrar solo los slots que pertenezcan a la grilla actual del club (organizador)
  const organizador = pareja.categoria.torneo.organizador;
  const slotsValidos = getSlotsValidosSet(organizador);
  const slotsFiltrados = Array.isArray(slotIds)
    ? [...new Set(slotIds.filter((s) => slotsValidos.has(s)))]
    : [];

  await prisma.$transaction(async (tx) => {
    // Borrar anteriores
    await tx.slotPareja.deleteMany({
      where: { parejaId },
    });

    // Crear nuevos
    if (slotsFiltrados.length > 0) {
      await tx.slotPareja.createMany({
        data: slotsFiltrados.map((slotId) => ({
          parejaId,
          slotId,
        })),
      });
    }
  });

  return slotsFiltrados;
}

async function setDisponibilidadDoble(organizadorId, parejaId1, slotsToAdd1 = [], parejaId2, slotsToAdd2 = []) {
  if (!parejaId1 || !parejaId2) {
    const error = new Error('Se requieren los IDs de ambas parejas.');
    error.statusCode = 400;
    throw error;
  }

  const [pareja1, pareja2] = await Promise.all([
    getParejaAndVerifyPermisos(organizadorId, parejaId1),
    getParejaAndVerifyPermisos(organizadorId, parejaId2),
  ]);

  if (pareja1.categoria?.estado !== 'BORRADOR' || pareja2.categoria?.estado !== 'BORRADOR') {
    const error = new Error(
      'La disponibilidad no se puede modificar una vez iniciada la categoría. Para cambiar un horario, reprogramá el partido.'
    );
    error.statusCode = 400;
    throw error;
  }

  if (
    (Array.isArray(slotsToAdd1) && slotsToAdd1.some((s) => typeof s === 'string' && s.startsWith('Domingo-'))) ||
    (Array.isArray(slotsToAdd2) && slotsToAdd2.some((s) => typeof s === 'string' && s.startsWith('Domingo-')))
  ) {
    const error = new Error(
      'No se pueden seleccionar horarios los domingos para la disponibilidad de zonas. Los domingos están reservados para los brackets eliminatorios.'
    );
    error.statusCode = 400;
    throw error;
  }

  const org1 = pareja1.categoria.torneo.organizador;
  const org2 = pareja2.categoria.torneo.organizador;
  const slotsValidos1 = getSlotsValidosSet(org1);
  const slotsValidos2 = getSlotsValidosSet(org2);

  // Traer slots actuales directamente desde la base de datos para evitar pisar cambios concurrentes
  const currentP1 = pareja1.slotsSeleccionados.map((s) => s.slotId);
  const currentP2 = pareja2.slotsSeleccionados.map((s) => s.slotId);

  const add1 = Array.isArray(slotsToAdd1) ? slotsToAdd1 : [slotsToAdd1];
  const add2 = Array.isArray(slotsToAdd2) ? slotsToAdd2 : [slotsToAdd2];

  const finalP1 = [...new Set([...currentP1, ...add1])].filter((s) => slotsValidos1.has(s));
  const finalP2 = [...new Set([...currentP2, ...add2])].filter((s) => slotsValidos2.has(s));

  // Transacción atómica: ambas parejas se actualizan o ninguna
  await prisma.$transaction(async (tx) => {
    // Actualizar Pareja 1
    await tx.slotPareja.deleteMany({
      where: { parejaId: parejaId1 },
    });
    if (finalP1.length > 0) {
      await tx.slotPareja.createMany({
        data: finalP1.map((slotId) => ({
          parejaId: parejaId1,
          slotId,
        })),
      });
    }

    // Actualizar Pareja 2
    await tx.slotPareja.deleteMany({
      where: { parejaId: parejaId2 },
    });
    if (finalP2.length > 0) {
      await tx.slotPareja.createMany({
        data: finalP2.map((slotId) => ({
          parejaId: parejaId2,
          slotId,
        })),
      });
    }

    // Set resolucionManual = true
    await tx.pareja.updateMany({
      where: { id: { in: [parejaId1, parejaId2] } },
      data: { resolucionManual: true },
    });
  });

  return {
    pareja1Slots: finalP1,
    pareja2Slots: finalP2,
  };
}

async function removerDisponibilidadDoble(organizadorId, parejaId1, slotsToRemove1 = [], parejaId2, slotsToRemove2 = []) {
  if (!parejaId1 || !parejaId2) {
    const error = new Error('Se requieren los IDs de ambas parejas.');
    error.statusCode = 400;
    throw error;
  }

  const [pareja1, pareja2] = await Promise.all([
    getParejaAndVerifyPermisos(organizadorId, parejaId1),
    getParejaAndVerifyPermisos(organizadorId, parejaId2),
  ]);

  if (pareja1.categoria?.estado !== 'BORRADOR' || pareja2.categoria?.estado !== 'BORRADOR') {
    const error = new Error(
      'La disponibilidad no se puede modificar una vez iniciada la categoría. Para cambiar un horario, reprogramá el partido.'
    );
    error.statusCode = 400;
    throw error;
  }

  const rem1 = Array.isArray(slotsToRemove1) ? slotsToRemove1 : [slotsToRemove1].filter(Boolean);
  const rem2 = Array.isArray(slotsToRemove2) ? slotsToRemove2 : [slotsToRemove2].filter(Boolean);

  await prisma.$transaction(async (tx) => {
    if (rem1.length > 0) {
      await tx.slotPareja.deleteMany({
        where: {
          parejaId: parejaId1,
          slotId: { in: rem1 },
        },
      });
    }
    if (rem2.length > 0) {
      await tx.slotPareja.deleteMany({
        where: {
          parejaId: parejaId2,
          slotId: { in: rem2 },
        },
      });
    }

    // Unset resolucionManual
    await tx.pareja.updateMany({
      where: { id: { in: [parejaId1, parejaId2] } },
      data: { resolucionManual: false },
    });
  });

  return { success: true };
}

module.exports = {
  getDisponibilidad,
  setDisponibilidad,
  setDisponibilidadDoble,
  removerDisponibilidadDoble,
  getParejaAndVerifyPermisos,
};
