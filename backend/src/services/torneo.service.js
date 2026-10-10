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

  if (!fecha || (typeof fecha === 'string' && !fecha.trim())) {
    const error = new Error('La fecha de inicio del torneo es obligatoria.');
    error.statusCode = 400;
    throw error;
  }

  const parsedFecha = parseFechaLocal(fecha);
  if (!parsedFecha) {
    const error = new Error('La fecha del torneo no es válida.');
    error.statusCode = 400;
    throw error;
  }

  if (parsedFecha.getDay() !== 5) {
    const error = new Error('La fecha de inicio debe ser un viernes (el torneo se juega de viernes a domingo).');
    error.statusCode = 400;
    throw error;
  }

  const slug = generarSlug(nombre.trim());

  return await prisma.torneo.create({
    data: {
      organizadorId,
      nombre: nombre.trim(),
      fecha: parsedFecha,
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

  let parsedFecha;
  if (data.fecha !== undefined) {
    if (torneo.estado !== 'BORRADOR') {
      const nuevaFecha = data.fecha ? parseFechaLocal(data.fecha) : null;
      const fechaActual = torneo.fecha ? parseFechaLocal(torneo.fecha) : null;
      const fechaCambio = nuevaFecha === null
        ? fechaActual !== null
        : (fechaActual === null || nuevaFecha.getTime() !== fechaActual.getTime());

      if (fechaCambio) {
        const error = new Error('No se puede modificar la fecha de un torneo que ya inició. Reiniciá el torneo para poder cambiarla.');
        error.statusCode = 400;
        throw error;
      }
    }

    if (!data.fecha || (typeof data.fecha === 'string' && !data.fecha.trim())) {
      const error = new Error('La fecha de inicio del torneo es obligatoria.');
      error.statusCode = 400;
      throw error;
    }

    parsedFecha = parseFechaLocal(data.fecha);
    if (!parsedFecha) {
      const error = new Error('La fecha del torneo no es válida.');
      error.statusCode = 400;
      throw error;
    }

    if (parsedFecha.getDay() !== 5) {
      const error = new Error('La fecha de inicio debe ser un viernes (el torneo se juega de viernes a domingo).');
      error.statusCode = 400;
      throw error;
    }
  }

  const updateData = {};
  if (data.nombre !== undefined && data.nombre.trim()) updateData.nombre = data.nombre.trim();
  if (data.fecha !== undefined) updateData.fecha = parsedFecha;
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

      await tx.pareja.updateMany({
        where: { categoriaId: { in: categoriaIds } },
        data: { resolucionManual: false },
      });
    }

    await tx.overrideCanchasDia.deleteMany({
      where: { torneoId: torneo.id },
    });

    await tx.torneo.update({
      where: { id: torneo.id },
      data: {
        estado: 'BORRADOR',
        canchasDisponiblesOverride: null,
        overrideActivoDesde: null,
      },
    });
  });

  let canchasOverridesService;
  try {
    // Se aísla require() en try/catch únicamente para prevenir fallos por dependencias circulares durante la inicialización temprana
    canchasOverridesService = require('./canchasOverrides.service');
  } catch (err) {
    // Ignorar únicamente error de resolución de módulo por ciclo de dependencias
  }
  if (canchasOverridesService) {
    // Si la caché no está inicializada, applyCacheMutation lanzará el error explícito sin ser silenciado
    canchasOverridesService.applyCacheMutation('CLEAR', { torneoId });
  }

  try {
    const { preCheckSessions } = require('./organizador.service');
    if (preCheckSessions && preCheckSessions.delete) {
      preCheckSessions.delete(torneoId);
    }
  } catch (err) {
    // Ignorar si hay ciclo de dependencias
  }

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
