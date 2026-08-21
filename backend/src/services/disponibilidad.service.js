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

module.exports = {
  getDisponibilidad,
  setDisponibilidad,
};
