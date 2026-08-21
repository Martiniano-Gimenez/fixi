const prisma = require('../lib/prisma');
const { getCategoriaById } = require('./categoria.service');

async function createPareja(organizadorId, categoriaId, data) {
  await getCategoriaById(organizadorId, categoriaId); // Verifica existencia y permisos

  if (!data.jugador1 || !data.jugador2) {
    const error = new Error('Los nombres de ambos jugadores son obligatorios.');
    error.statusCode = 400;
    throw error;
  }

  // Asignar el orden (seed) basado en la cantidad actual
  const parejasCount = await prisma.pareja.count({ where: { categoriaId } });

  return await prisma.pareja.create({
    data: {
      categoriaId,
      jugador1: data.jugador1.trim(),
      jugador2: data.jugador2.trim(),
      orden: parejasCount + 1,
    },
  });
}

async function getParejasByCategoria(organizadorId, categoriaId) {
  await getCategoriaById(organizadorId, categoriaId); // Verifica permisos

  return await prisma.pareja.findMany({
    where: { categoriaId },
    include: {
      slotsSeleccionados: true,
    },
    orderBy: { orden: 'asc' },
  });
}

async function getParejaAndVerifyPermisos(organizadorId, parejaId) {
  const pareja = await prisma.pareja.findUnique({
    where: { id: parejaId },
    include: {
      categoria: {
        include: {
          torneo: true,
        },
      },
    },
  });

  if (!pareja) {
    const error = new Error('Pareja no encontrada.');
    error.statusCode = 404;
    throw error;
  }

  if (pareja.categoria.torneo.organizadorId !== organizadorId) {
    const error = new Error('No tenés permisos sobre esta pareja.');
    error.statusCode = 403;
    throw error;
  }

  return pareja;
}

async function updatePareja(organizadorId, parejaId, data) {
  const pareja = await getParejaAndVerifyPermisos(organizadorId, parejaId);

  const updateData = {};
  if (data.jugador1) updateData.jugador1 = data.jugador1.trim();
  if (data.jugador2) updateData.jugador2 = data.jugador2.trim();
  if (data.orden !== undefined) updateData.orden = data.orden;

  return await prisma.pareja.update({
    where: { id: pareja.id },
    data: updateData,
  });
}

async function deletePareja(organizadorId, parejaId) {
  const pareja = await getParejaAndVerifyPermisos(organizadorId, parejaId);

  return await prisma.pareja.delete({
    where: { id: pareja.id },
  });
}

module.exports = {
  createPareja,
  getParejasByCategoria,
  updatePareja,
  deletePareja,
};
