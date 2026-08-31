const prisma = require('../lib/prisma');
const crypto = require('crypto');
const { parseFechaLocal } = require('../utils/dateUtils');

function generarSlug(nombre) {
  const base = nombre.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
  const randomStr = crypto.randomBytes(3).toString('hex');
  return `${base}-${randomStr}`;
}

async function createTorneo(organizadorId, { nombre, fecha }) {
  if (!nombre || !nombre.trim()) {
    const error = new Error('El nombre del torneo es obligatorio.');
    error.statusCode = 400;
    throw error;
  }

  const slug = generarSlug(nombre.trim());

  return await prisma.torneo.create({
    data: {
      organizadorId,
      nombre: nombre.trim(),
      fecha: fecha ? parseFechaLocal(fecha) : null,
      slug,
    },
  });
}

async function getTorneos(organizadorId) {
  return await prisma.torneo.findMany({
    where: { organizadorId },
    include: {
      categorias: {
        include: {
          parejas: { select: { id: true } },
          zonas: { select: { id: true } },
          partidos: { select: { id: true, estado: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

async function getTorneoById(organizadorId, torneoId, tx = null) {
  const db = tx || prisma;
  const torneo = await db.torneo.findUnique({
    where: { id: torneoId },
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
      categorias: {
        include: {
          parejas: {
            orderBy: { orden: 'asc' },
            include: { slotsSeleccionados: true },
          },
          zonas: { select: { id: true, nombre: true } },
          partidos: { select: { id: true, estado: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
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

  return torneo;
}

async function updateTorneo(organizadorId, torneoId, data) {
  const torneo = await getTorneoById(organizadorId, torneoId);

  const updateData = {};
  if (data.nombre !== undefined && data.nombre.trim()) updateData.nombre = data.nombre.trim();
  if (data.fecha !== undefined) updateData.fecha = data.fecha ? parseFechaLocal(data.fecha) : null;
  if (data.estado !== undefined) updateData.estado = data.estado;

  return await prisma.torneo.update({
    where: { id: torneo.id },
    data: updateData,
  });
}

async function deleteTorneo(organizadorId, torneoId) {
  const torneo = await getTorneoById(organizadorId, torneoId);

  await prisma.torneo.delete({
    where: { id: torneo.id },
  });

  return { message: 'Torneo eliminado con éxito' };
}

async function reiniciarTorneo(organizadorId, torneoId) {
  const torneo = await getTorneoById(organizadorId, torneoId);

  const categoriaIds = torneo.categorias.map((c) => c.id);

  await prisma.$transaction(async (tx) => {
    if (categoriaIds.length > 0) {
      await tx.partido.deleteMany({
        where: { categoriaId: { in: categoriaIds } },
      });

      await tx.faseEliminatoria.deleteMany({
        where: { categoriaId: { in: categoriaIds } },
      });

      await tx.zona.deleteMany({
        where: { categoriaId: { in: categoriaIds } },
      });

      await tx.categoria.updateMany({
        where: { id: { in: categoriaIds } },
        data: { estado: 'BORRADOR' },
      });
    }

    await tx.torneo.update({
      where: { id: torneo.id },
      data: { estado: 'BORRADOR' },
    });
  });

  return { message: 'Torneo reiniciado con éxito' };
}

module.exports = {
  createTorneo,
  getTorneos,
  getTorneoById,
  updateTorneo,
  deleteTorneo,
  reiniciarTorneo,
};
