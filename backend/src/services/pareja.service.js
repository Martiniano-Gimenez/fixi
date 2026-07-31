const prisma = require('../lib/prisma');
const { getTorneoById } = require('./torneo.service');

async function createPareja(organizadorId, torneoId, data) {
  const torneo = await getTorneoById(organizadorId, torneoId); // Verifica existencia y permisos

  if (torneo.estado !== 'BORRADOR') {
    const error = new Error('No se pueden agregar parejas a un torneo que ya no está en borrador.');
    error.statusCode = 400;
    throw error;
  }

  if (!data.jugador1 || !data.jugador2) {
    const error = new Error('Los nombres de ambos jugadores son obligatorios.');
    error.statusCode = 400;
    throw error;
  }

  // Asignar el orden (seed) basado en la cantidad actual
  const parejasCount = await prisma.pareja.count({ where: { torneoId } });

  return await prisma.pareja.create({
    data: {
      torneoId,
      jugador1: data.jugador1,
      jugador2: data.jugador2,
      orden: parejasCount + 1,
    },
  });
}

async function getParejasByTorneo(organizadorId, torneoId) {
  await getTorneoById(organizadorId, torneoId); // Verifica permisos

  return await prisma.pareja.findMany({
    where: { torneoId },
    orderBy: { orden: 'asc' },
  });
}

async function getParejaAndVerifyPermisos(organizadorId, parejaId) {
  const pareja = await prisma.pareja.findUnique({
    where: { id: parejaId },
    include: { torneo: true },
  });

  if (!pareja) {
    const error = new Error('Pareja no encontrada.');
    error.statusCode = 404;
    throw error;
  }

  if (pareja.torneo.organizadorId !== organizadorId) {
    const error = new Error('No tenés permisos sobre esta pareja.');
    error.statusCode = 403;
    throw error;
  }

  return pareja;
}

async function updatePareja(organizadorId, parejaId, data) {
  const pareja = await getParejaAndVerifyPermisos(organizadorId, parejaId);

  const updateData = {};
  if (data.jugador1) updateData.jugador1 = data.jugador1;
  if (data.jugador2) updateData.jugador2 = data.jugador2;
  if (data.orden !== undefined) updateData.orden = data.orden;

  return await prisma.pareja.update({
    where: { id: pareja.id },
    data: updateData,
  });
}

async function deletePareja(organizadorId, parejaId) {
  const pareja = await getParejaAndVerifyPermisos(organizadorId, parejaId);

  if (pareja.torneo.estado !== 'BORRADOR') {
    const error = new Error('No se pueden eliminar parejas de un torneo que ya no está en borrador.');
    error.statusCode = 400;
    throw error;
  }

  return await prisma.pareja.delete({
    where: { id: pareja.id },
  });
}

module.exports = {
  createPareja,
  getParejasByTorneo,
  updatePareja,
  deletePareja,
};
