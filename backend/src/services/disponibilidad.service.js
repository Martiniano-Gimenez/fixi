const prisma = require('../lib/prisma');
const { getSlotsValidosSet } = require('./slots.service');

async function getDisponibilidad(parejaId) {
  const slots = await prisma.slotPareja.findMany({
    where: { parejaId },
    select: { slotId: true },
  });
  return slots.map((s) => s.slotId);
}

async function setDisponibilidad(parejaId, slotIds) {
  const pareja = await prisma.pareja.findUnique({
    where: { id: parejaId },
    include: {
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

async function setDisponibilidadDoble(parejaId1, slotsToAdd1 = [], parejaId2, slotsToAdd2 = []) {
  if (!parejaId1 || !parejaId2) {
    const error = new Error('Se requieren los IDs de ambas parejas.');
    error.statusCode = 400;
    throw error;
  }

  const [pareja1, pareja2] = await Promise.all([
    prisma.pareja.findUnique({
      where: { id: parejaId1 },
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
    }),
    prisma.pareja.findUnique({
      where: { id: parejaId2 },
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
    }),
  ]);

  if (!pareja1 || !pareja2) {
    const error = new Error('Una o ambas parejas no fueron encontradas.');
    error.statusCode = 404;
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
  });

  return {
    pareja1Slots: finalP1,
    pareja2Slots: finalP2,
  };
}

async function removerDisponibilidadDoble(parejaId1, slotsToRemove1 = [], parejaId2, slotsToRemove2 = []) {
  if (!parejaId1 || !parejaId2) {
    const error = new Error('Se requieren los IDs de ambas parejas.');
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
  });

  return { success: true };
}

module.exports = {
  getDisponibilidad,
  setDisponibilidad,
  setDisponibilidadDoble,
  removerDisponibilidadDoble,
};
