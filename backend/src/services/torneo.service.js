const prisma = require('../lib/prisma');
const crypto = require('crypto');

function generarSlug(nombre) {
  const base = nombre.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
  const randomStr = crypto.randomBytes(3).toString('hex');
  return `${base}-${randomStr}`;
}

async function createTorneo(organizadorId, { nombre, fecha }) {
  if (!nombre) {
    const error = new Error('El nombre del torneo es obligatorio.');
    error.statusCode = 400;
    throw error;
  }

  const slug = generarSlug(nombre);

  return await prisma.torneo.create({
    data: {
      organizadorId,
      nombre,
      fecha: fecha ? new Date(fecha) : null,
      slug,
    },
  });
}

async function getTorneos(organizadorId) {
  return await prisma.torneo.findMany({
    where: { organizadorId },
    orderBy: { createdAt: 'desc' },
  });
}

async function getTorneoById(organizadorId, torneoId) {
  const torneo = await prisma.torneo.findUnique({
    where: { id: torneoId },
    include: {
      parejas: { orderBy: { orden: 'asc' } },
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
  const torneo = await getTorneoById(organizadorId, torneoId); // Verifica existencia y permisos

  // Solo permitimos editar ciertos campos
  const updateData = {};
  if (data.nombre) updateData.nombre = data.nombre;
  if (data.fecha !== undefined) updateData.fecha = data.fecha ? new Date(data.fecha) : null;
  if (data.estado) updateData.estado = data.estado;
  if (data.cantidadCanchas !== undefined) updateData.cantidadCanchas = Number(data.cantidadCanchas);
  if (data.duracionPartidoMin !== undefined) updateData.duracionPartidoMin = Number(data.duracionPartidoMin);

  return await prisma.torneo.update({
    where: { id: torneo.id },
    data: updateData,
  });
}

async function reiniciarTorneo(organizadorId, torneoId) {
  const torneo = await getTorneoById(organizadorId, torneoId);
  
  if (torneo.estado === 'BORRADOR') {
    throw new Error('El torneo ya está en estado BORRADOR.');
  }

  await prisma.$transaction(async (tx) => {
    // Borrar fases eliminatorias (SetNull en partidos, así que mejor borramos los partidos primero o después)
    // Borramos partidos primero
    await tx.partido.deleteMany({
      where: { torneoId: torneo.id }
    });

    // Borrar fases eliminatorias
    await tx.faseEliminatoria.deleteMany({
      where: { torneoId: torneo.id }
    });

    // Borrar zonas (borra ZonaPareja por cascade)
    await tx.zona.deleteMany({
      where: { torneoId: torneo.id }
    });

    // Volver el torneo a BORRADOR
    await tx.torneo.update({
      where: { id: torneo.id },
      data: { estado: 'BORRADOR' }
    });
  });

  return { message: 'Torneo reiniciado con éxito' };
}

module.exports = {
  createTorneo,
  getTorneos,
  getTorneoById,
  updateTorneo,
  reiniciarTorneo,
};

