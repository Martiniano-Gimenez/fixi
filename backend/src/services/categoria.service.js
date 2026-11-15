const prisma = require('../lib/prisma');
const canchasOverridesService = require('./canchasOverrides.service');
const { recalcularEstadoTorneo, exigirTorneoNoFinalizado, incluirFinalPodio, conPodioCategoria } = require('./torneo.service');

async function recalcularEstadosPorPartido(tx, categoriaId) {
  const categoria = await tx.categoria.findUnique({ where: { id: categoriaId }, select: {
    torneoId: true, estado: true, torneo: { select: { estado: true } },
  } });
  const partidos = await tx.partido.findMany({ where: { categoriaId, esBye: false }, select: {
    estado: true, faseEliminatoria: { select: { ronda: true } },
  } });
  const terminada = partidos.some((partido) => partido.faseEliminatoria?.ronda === 2)
    && partidos.every((partido) => partido.estado === 'FINALIZADO');
  // Borrar un cuadro vacío no inicia una categoría ni un torneo en preparación.
  if (categoria.estado === 'BORRADOR' && partidos.length === 0) {
    if (categoria.torneo.estado !== 'BORRADOR') await recalcularEstadoTorneo(tx, categoria.torneoId);
    return;
  }
  await tx.categoria.update({ where: { id: categoriaId }, data: { estado: terminada ? 'FINALIZADO' : 'EN_CURSO' } });
  await recalcularEstadoTorneo(tx, categoria.torneoId);
}

async function exigirCategoriaConTorneoAbierto(organizadorId, categoriaId) {
  const categoria = await getCategoriaById(organizadorId, categoriaId);
  exigirTorneoNoFinalizado(categoria.torneo);
  return categoria;
}

async function getCategoriaById(organizadorId, categoriaId, tx = null) {
  const db = tx || prisma;
  const categoria = await db.categoria.findUnique({
    where: { id: categoriaId },
    include: {
      fasesEliminatorias: incluirFinalPodio,
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
              domingoInicio: true,
              domingoFin: true,
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

  return conPodioCategoria(categoria);
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
  if (data.estado !== undefined && data.estado !== categoria.estado) {
    const error = new Error('El estado de la categoría se actualiza automáticamente con los resultados.');
    error.statusCode = 400;
    throw error;
  }

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

  await prisma.$transaction(async (tx) => {
    await tx.categoria.delete({ where: { id: categoria.id } });
    if (categoria.torneo.estado !== 'BORRADOR') await recalcularEstadoTorneo(tx, categoria.torneoId);
  });

  return { message: 'Categoría eliminada con éxito' };
}

async function reiniciarCategoria(organizadorId, categoriaId) {
  const categoria = await getCategoriaById(organizadorId, categoriaId);
  exigirTorneoNoFinalizado(categoria.torneo);

  if (categoria.estado === 'BORRADOR') {
    throw new Error('La categoría ya está en estado BORRADOR.');
  }

  const overridesActualizados = await prisma.$transaction(async (tx) => {
    const partidos = await tx.partido.findMany({
      where: { categoriaId: categoria.id },
      select: { id: true },
    });
    const partidoIds = new Set(partidos.map((p) => p.id));
    const quitarPartidos = (registro) => {
      let datos = registro;
      if (typeof registro === 'string') {
        try { datos = JSON.parse(registro); } catch { return undefined; }
      }
      if (!datos || typeof datos !== 'object' || Array.isArray(datos)) return undefined;
      const restantes = Object.entries(datos).filter(([id]) => !partidoIds.has(id));
      if (restantes.length === Object.keys(datos).length) return undefined;
      const limpio = Object.fromEntries(restantes);
      return typeof registro === 'string' ? JSON.stringify(limpio) : limpio;
    };
    const overrides = await tx.overrideCanchasDia.findMany({ where: { torneoId: categoria.torneoId } });
    const actualizados = [];
    for (const override of overrides) {
      const horariosAntesLluvia = quitarPartidos(override.horariosAntesLluvia);
      const partidosSinSlot = quitarPartidos(override.partidosSinSlot);
      if (horariosAntesLluvia === undefined && partidosSinSlot === undefined) continue;
      const actualizado = await tx.overrideCanchasDia.update({
        where: { id: override.id },
        data: { horariosAntesLluvia, partidosSinSlot, updatedAt: override.updatedAt },
      });
      // La caché solo guarda partidosSinSlot; se actualiza después del commit.
      if (partidosSinSlot !== undefined) actualizados.push(actualizado);
    }

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
    await recalcularEstadoTorneo(tx, categoria.torneoId);
    return actualizados;
  });

  for (const override of overridesActualizados) {
    canchasOverridesService.applyCacheMutation('SET', {
      ...override,
      partidosSinSlot: typeof override.partidosSinSlot === 'string'
        ? JSON.parse(override.partidosSinSlot) : override.partidosSinSlot,
    });
  }

  return { message: 'Categoría reiniciada con éxito' };
}

module.exports = {
  recalcularEstadosPorPartido,
  exigirCategoriaConTorneoAbierto,
  getCategoriaById,
  createCategoria,
  getCategorias,
  updateCategoria,
  deleteCategoria,
  reiniciarCategoria,
};
