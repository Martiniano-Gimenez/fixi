const prisma = require('../lib/prisma');
const crypto = require('crypto');
const { parseFechaLocal } = require('../utils/dateUtils');

function exigirTorneoNoFinalizado(torneo) {
  if (torneo.estado === 'FINALIZADO') {
    const error = new Error('El torneo está finalizado. Solo se pueden corregir resultados o reiniciar el torneo.');
    error.statusCode = 400;
    throw error;
  }
}

const seleccionParejaPodio = { id: true, jugador1: true, jugador2: true };
const incluirFinalPodio = { where: { ronda: 2 }, include: { partidos: { include: {
  ganador: { select: seleccionParejaPodio }, pareja1: { select: seleccionParejaPodio }, pareja2: { select: seleccionParejaPodio },
} } } };

function conPodioCategoria(categoria) {
  const final = categoria.fasesEliminatorias?.flatMap((fase) => fase.partidos)
    .find((partido) => !partido.esBye && partido.estado === 'FINALIZADO' && partido.ganadorId);
  const campeones = categoria.estado === 'FINALIZADO' ? final?.ganador || null : null;
  const subcampeones = campeones ? (final.ganadorId === final.pareja1Id ? final.pareja2 : final.pareja1) : null;
  return { ...categoria, campeones, subcampeones };
}

async function recalcularEstadoTorneo(tx, torneoId) {
  const torneo = await tx.torneo.findUnique({ where: { id: torneoId }, select: { estado: true } });
  // El inicio por pre-check es el que saca al torneo de preparación.
  if (torneo?.estado === 'BORRADOR') return;

  const categorias = await tx.categoria.findMany({ where: { torneoId }, select: {
    estado: true, _count: { select: { parejas: true } },
  } });
  const jugables = categorias.filter((categoria) => categoria.estado !== 'BORRADOR' || categoria._count.parejas >= 2);
  const estado = jugables.length > 0 && jugables.every((categoria) => categoria.estado === 'FINALIZADO')
    ? 'FINALIZADO' : 'EN_CURSO';
  await tx.torneo.update({ where: { id: torneoId }, data: { estado } });
}

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
          partidos: { select: { id: true, estado: true, esBye: true } },
          fasesEliminatorias: incluirFinalPodio,
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

  return { ...torneo, categorias: torneo.categorias.map(conPodioCategoria) };
}

async function updateTorneo(organizadorId, torneoId, data) {
  const torneo = await getTorneoById(organizadorId, torneoId);
  const esInicio = torneo.estado === 'BORRADOR' && data.estado === 'EN_CURSO';
  if (data.estado !== undefined && data.estado !== torneo.estado) {
    const error = new Error(esInicio
      ? 'Para iniciar el torneo usá Iniciar torneo.'
      : 'El estado del torneo se actualiza automáticamente con los resultados.');
    error.statusCode = 400;
    throw error;
  }

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
    await tx.precheckPlan.deleteMany({ where: { torneoId: torneo.id } });

    await tx.torneo.update({
      where: { id: torneo.id },
      data: {
        estado: 'BORRADOR',
        canchasDisponiblesOverride: null,
        overrideActivoDesde: null,
        // Volver a BORRADOR no reabre la inscripción por link: la abre el organizador a mano
        inscripcionAbierta: false,
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
  exigirTorneoNoFinalizado,
  recalcularEstadoTorneo,
  incluirFinalPodio,
  conPodioCategoria,
  createTorneo,
  getTorneos,
  getTorneoById,
  updateTorneo,
  deleteTorneo,
  reiniciarTorneo,
};
