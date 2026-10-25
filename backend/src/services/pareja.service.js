const prisma = require('../lib/prisma');
const { getCategoriaById } = require('./categoria.service');

async function createPareja(organizadorId, categoriaId, data) {
  const categoria = await getCategoriaById(organizadorId, categoriaId); // Verifica existencia y permisos

  if (categoria.estado !== 'BORRADOR') {
    const error = new Error(
      "No se pueden agregar parejas una vez iniciado el torneo. Usá 'Agregar Pareja a Zona' desde el detalle de la categoría."
    );
    error.statusCode = 400;
    throw error;
  }

  if (!data.jugador1 || !data.jugador2) {
    const error = new Error('Los nombres de ambos jugadores son obligatorios.');
    error.statusCode = 400;
    throw error;
  }

  // Asignar el orden (seed) como max(orden) + 1: con count + 1 un hueco repetía un orden existente
  const { _max } = await prisma.pareja.aggregate({ where: { categoriaId }, _max: { orden: true } });

  return await prisma.pareja.create({
    data: {
      categoriaId,
      jugador1: data.jugador1.trim(),
      jugador2: data.jugador2.trim(),
      orden: (_max.orden ?? 0) + 1,
    },
  });
}

async function getParejasByCategoria(organizadorId, categoriaId) {
  await getCategoriaById(organizadorId, categoriaId); // Verifica permisos

  return await prisma.pareja.findMany({
    where: { categoriaId },
    include: {
      slotsSeleccionados: true,
      zonaParejas: {
        include: {
          zona: {
            select: {
              id: true,
              nombre: true,
              formato: true,
              _count: {
                select: {
                  zonaParejas: true,
                },
              },
              partidos: {
                select: {
                  id: true,
                  estado: true,
                  pareja1Id: true,
                  pareja2Id: true,
                },
              },
            },
          },
        },
      },
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

  if (pareja.categoria.estado !== 'BORRADOR') {
    const error = new Error('No se pueden modificar parejas una vez iniciado el torneo.');
    error.statusCode = 400;
    throw error;
  }

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
  const categoriaId = pareja.categoriaId;

  if (pareja.categoria.estado !== 'BORRADOR') {
    const error = new Error('No se pueden eliminar parejas una vez iniciado el torneo.');
    error.statusCode = 400;
    throw error;
  }

  await prisma.pareja.delete({
    where: { id: pareja.id },
  });

  // Re-secuenciar el orden de las parejas restantes de la categoría
  const restantes = await prisma.pareja.findMany({
    where: { categoriaId },
    orderBy: { orden: 'asc' },
  });

  for (let i = 0; i < restantes.length; i++) {
    if (restantes[i].orden !== i + 1) {
      await prisma.pareja.update({
        where: { id: restantes[i].id },
        data: { orden: i + 1 },
      });
    }
  }

  return { message: 'Pareja eliminada correctamente.' };
}

module.exports = {
  createPareja,
  getParejasByCategoria,
  updatePareja,
  deletePareja,
};
