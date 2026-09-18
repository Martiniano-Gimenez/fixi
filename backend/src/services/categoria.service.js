const prisma = require('../lib/prisma');

async function getCategoriaById(organizadorId, categoriaId, tx = null) {
  const db = tx || prisma;
  const categoria = await db.categoria.findUnique({
    where: { id: categoriaId },
    include: {
      torneo: {
        include: {
          organizador: {
            select: {
              id: true,
              nombre: true,
              cantidadCanchas: true,
              viernesInicio: true,
              viernesFin: true,
              sabadoInicio: true,
              sabadoFin: true,
            },
          },
        },
      },
      parejas: {
        orderBy: { orden: 'asc' },
        include: {
          slotsSeleccionados: true,
        },
      },
    },
  });

  if (!categoria) {
    const error = new Error('Categoría no encontrada.');
    error.statusCode = 404;
    throw error;
  }

  if (categoria.torneo.organizadorId !== organizadorId) {
    const error = new Error('No tenés permisos para acceder a esta categoría.');
    error.statusCode = 403;
    throw error;
  }

  return categoria;
}

async function createCategoria(organizadorId, torneoId, { nombre }) {
  if (!nombre || !nombre.trim()) {
    const error = new Error('El nombre de la categoría es obligatorio.');
    error.statusCode = 400;
    throw error;
  }

  // Verificar que el torneo pertenezca al organizador
  const torneo = await prisma.torneo.findUnique({
    where: { id: torneoId },
  });

  if (!torneo) {
    const error = new Error('Torneo no encontrado.');
    error.statusCode = 404;
    throw error;
  }

  if (torneo.organizadorId !== organizadorId) {
    const error = new Error('No tenés permisos para agregar categorías a este torneo.');
    error.statusCode = 403;
    throw error;
  }

  return await prisma.categoria.create({
    data: {
      torneoId,
      nombre: nombre.trim(),
    },
  });
}

async function getCategorias(organizadorId, torneoId) {
  const torneo = await prisma.torneo.findUnique({
    where: { id: torneoId },
  });

  if (!torneo) {
    const error = new Error('Torneo no encontrado.');
    error.statusCode = 404;
    throw error;
  }

  if (torneo.organizadorId !== organizadorId) {
    const error = new Error('No tenés permisos para ver este torneo.');
    error.statusCode = 403;
    throw error;
  }

  return await prisma.categoria.findMany({
    where: { torneoId },
    include: {
      parejas: {
        select: { id: true },
      },
      zonas: {
        select: { id: true },
      },
      partidos: {
        select: { id: true, estado: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
}

async function updateCategoria(organizadorId, categoriaId, data) {
  const categoria = await getCategoriaById(organizadorId, categoriaId);

  const updateData = {};
  if (data.nombre !== undefined && data.nombre.trim()) {
    updateData.nombre = data.nombre.trim();
  }
  if (data.estado !== undefined) {
    updateData.estado = data.estado;
  }
  return await prisma.categoria.update({
    where: { id: categoria.id },
    data: updateData,
  });
}

async function deleteCategoria(organizadorId, categoriaId) {
  const categoria = await getCategoriaById(organizadorId, categoriaId);

  await prisma.categoria.delete({
    where: { id: categoria.id },
  });

  return { message: 'Categoría eliminada con éxito' };
}

async function reiniciarCategoria(organizadorId, categoriaId) {
  const categoria = await getCategoriaById(organizadorId, categoriaId);

  if (categoria.estado === 'BORRADOR') {
    throw new Error('La categoría ya está en estado BORRADOR.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.partido.deleteMany({
      where: { categoriaId: categoria.id },
    });

    await tx.faseEliminatoria.deleteMany({
      where: { categoriaId: categoria.id },
    });

    await tx.zona.deleteMany({
      where: { categoriaId: categoria.id },
    });

    await tx.categoria.update({
      where: { id: categoria.id },
      data: { estado: 'BORRADOR' },
    });

    await tx.pareja.updateMany({
      where: { categoriaId: categoria.id },
      data: { resolucionManual: false },
    });
  });

  return { message: 'Categoría reiniciada con éxito' };
}

module.exports = {
  getCategoriaById,
  createCategoria,
  getCategorias,
  updateCategoria,
  deleteCategoria,
  reiniciarCategoria,
};
