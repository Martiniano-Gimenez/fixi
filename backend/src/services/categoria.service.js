const prisma = require('../lib/prisma');
const canchasOverridesService = require('./canchasOverrides.service');
const { validarNombre, claveNombre } = require('../utils/nombres');
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

async function exigirNombreCategoriaDisponible(tx, torneoId, nombre, categoriaId) {
  const categorias = await tx.categoria.findMany({ where: { torneoId, ...(categoriaId ? { id: { not: categoriaId } } : {}) }, select: { nombre: true } });
  if (categorias.some((c) => claveNombre(c.nombre) === claveNombre(nombre))) {
    throw Object.assign(new Error('Ya hay una categoría con ese nombre en este torneo.'), { statusCode: 409 });
  }
}

async function createCategoria(organizadorId, torneoId, { nombre }) {
  const nombreValidado = validarNombre(nombre, 'de la categoría', 40);

  return await prisma.$transaction(async (tx) => {
    // Verificar propiedad y estado dentro de la misma transacción que el alta.
    const torneo = await tx.torneo.findUnique({ where: { id: torneoId } });
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
    exigirTorneoNoFinalizado(torneo);
    await exigirNombreCategoriaDisponible(tx, torneoId, nombreValidado);
    return tx.categoria.create({ data: { torneoId, nombre: nombreValidado } });
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
  return prisma.$transaction(async (tx) => {
    const categoria = await getCategoriaById(organizadorId, categoriaId, tx);
    if (data.estado !== undefined && data.estado !== categoria.estado) {
      const error = new Error('El estado de la categoría se actualiza automáticamente con los resultados.');
      error.statusCode = 400;
      throw error;
    }

    const updateData = {};
    if (data.nombre !== undefined) {
      updateData.nombre = validarNombre(data.nombre, 'de la categoría', 40);
      if (claveNombre(updateData.nombre) !== claveNombre(categoria.nombre)) {
        await exigirNombreCategoriaDisponible(tx, categoria.torneoId, updateData.nombre, categoriaId);
      }
    }
    if (data.estado !== undefined) updateData.estado = data.estado;
    return tx.categoria.update({ where: { id: categoria.id }, data: updateData });
  });
}

async function deleteCategoria(organizadorId, categoriaId) {
  const overridesActualizados = await prisma.$transaction(async (tx) => {
    const categoria = await getCategoriaById(organizadorId, categoriaId, tx);
    exigirTorneoNoFinalizado(categoria.torneo);
    const partidos = await tx.partido.findMany({ where: { categoriaId }, select: { id: true } });
    const actualizados = await canchasOverridesService.quitarPartidosDeRegistros(tx, categoria.torneoId, partidos.map((p) => p.id));
    await tx.categoria.delete({ where: { id: categoria.id } });
    if (categoria.torneo.estado !== 'BORRADOR') await recalcularEstadoTorneo(tx, categoria.torneoId);
    return actualizados;
  });
  canchasOverridesService.aplicarLimpiezaRegistros(overridesActualizados);

  return { message: 'Categoría eliminada con éxito' };
}

async function reiniciarCategoria(organizadorId, categoriaId) {
  const categoria = await getCategoriaById(organizadorId, categoriaId);
  exigirTorneoNoFinalizado(categoria.torneo);

  if (categoria.estado === 'BORRADOR') {
    throw Object.assign(new Error('La categoría ya está en estado BORRADOR.'), { statusCode: 400 });
  }

  const overridesActualizados = await prisma.$transaction(async (tx) => {
    const partidos = await tx.partido.findMany({
      where: { categoriaId: categoria.id },
      select: { id: true },
    });
    const actualizados = await canchasOverridesService.quitarPartidosDeRegistros(tx, categoria.torneoId, partidos.map((p) => p.id));

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

  canchasOverridesService.aplicarLimpiezaRegistros(overridesActualizados);

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
