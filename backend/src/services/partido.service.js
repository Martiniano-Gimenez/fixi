const prisma = require('../lib/prisma');
const { getCategoriaById } = require('./categoria.service');
const { parseSlotToDate } = require('./zona.service');
const { requireTorneoFecha } = require('../utils/dateUtils');

async function getPartidoAndVerifyPermisos(organizadorId, partidoId) {
  const partido = await prisma.partido.findUnique({
    where: { id: partidoId },
    include: {
      categoria: {
        include: {
          torneo: true,
        },
      },
      zona: true,
      faseEliminatoria: true,
    },
  });

  if (!partido) {
    const error = new Error('Partido no encontrado.');
    error.statusCode = 404;
    throw error;
  }

  if (partido.categoria.torneo.organizadorId !== organizadorId) {
    const error = new Error('No tenés permisos sobre este partido.');
    error.statusCode = 403;
    throw error;
  }

  return partido;
}

/**
 * Recalcula todas las estadísticas de una zona (ROUND_ROBIN).
 * Se llama cada vez que se carga o edita el resultado de un partido de la zona.
 */
async function recalcularStatsZona(zonaId) {
  const zonaParejas = await prisma.zonaPareja.findMany({ where: { zonaId } });
  const partidos = await prisma.partido.findMany({
    where: { zonaId, estado: 'FINALIZADO' },
    include: { sets: true },
  });

  // Resetear stats en memoria
  const stats = {};
  for (const zp of zonaParejas) {
    stats[zp.parejaId] = {
      pj: 0, pg: 0, pp: 0,
      sf: 0, sc: 0,
      gf: 0, gc: 0,
      puntos: 0,
    };
  }

  // Acumular stats de partidos finalizados
  for (const p of partidos) {
    if (!p.pareja1Id || !p.pareja2Id || !p.ganadorId) continue;
    
    const s1 = stats[p.pareja1Id];
    const s2 = stats[p.pareja2Id];

    if (!s1 || !s2) continue; // Por las dudas

    s1.pj += 1;
    s2.pj += 1;

    if (p.ganadorId === p.pareja1Id) {
      s1.pg += 1;
      s1.puntos += 3;
      s2.pp += 1;
    } else if (p.ganadorId === p.pareja2Id) {
      s2.pg += 1;
      s2.puntos += 3;
      s1.pp += 1;
    }

    let setsP1 = 0;
    let setsP2 = 0;

    for (const set of p.sets) {
      s1.gf += set.gamesPareja1;
      s1.gc += set.gamesPareja2;
      s2.gf += set.gamesPareja2;
      s2.gc += set.gamesPareja1;

      if (set.gamesPareja1 > set.gamesPareja2) setsP1++;
      else if (set.gamesPareja2 > set.gamesPareja1) setsP2++;
    }

    s1.sf += setsP1;
    s1.sc += setsP2;
    s2.sf += setsP2;
    s2.sc += setsP1;
  }

  // Guardar stats recalculadas
  for (const zp of zonaParejas) {
    const s = stats[zp.parejaId];
    await prisma.zonaPareja.update({
      where: { id: zp.id },
      data: s,
    });
  }
}

/**
 * Lógica para zonas de 4 (MINI_BRACKET): Propaga los ganadores y perdedores
 * de los partidos 1 y 2 hacia los partidos 3 y 4.
 */
async function propagarMiniBracket(zonaId) {
  const partidos = await prisma.partido.findMany({
    where: { zonaId },
    orderBy: { posicionEnRonda: 'asc' },
  });

  const p1 = partidos.find(p => p.posicionEnRonda === 1);
  const p2 = partidos.find(p => p.posicionEnRonda === 2);
  const pGanadores = partidos.find(p => p.posicionEnRonda === 3);
  const pPerdedores = partidos.find(p => p.posicionEnRonda === 4);

  if (!p1 || !p2 || !pGanadores || !pPerdedores) return;

  const getPerdedor = (partido) => {
    if (!partido.ganadorId) return null;
    return partido.ganadorId === partido.pareja1Id ? partido.pareja2Id : partido.pareja1Id;
  };

  // Si P1 terminó, propagamos su ganador y perdedor al slot 1 de P3 y P4
  if (p1.estado === 'FINALIZADO' && p1.ganadorId) {
    await prisma.partido.update({
      where: { id: pGanadores.id },
      data: { pareja1Id: p1.ganadorId },
    });
    await prisma.partido.update({
      where: { id: pPerdedores.id },
      data: { pareja1Id: getPerdedor(p1) },
    });
  }

  // Si P2 terminó, propagamos su ganador y perdedor al slot 2 de P3 y P4
  if (p2.estado === 'FINALIZADO' && p2.ganadorId) {
    await prisma.partido.update({
      where: { id: pGanadores.id },
      data: { pareja2Id: p2.ganadorId },
    });
    await prisma.partido.update({
      where: { id: pPerdedores.id },
      data: { pareja2Id: getPerdedor(p2) },
    });
  }

  // --- LÓGICA DE POSICIONES EXACTAS ---
  await prisma.zonaPareja.updateMany({
    where: { zonaId },
    data: { posicion: 0 }
  });

  // Partido 3 define 1ro y 2do
  if (pGanadores.estado === 'FINALIZADO' && pGanadores.ganadorId) {
    const loser = getPerdedor(pGanadores);
    await prisma.zonaPareja.updateMany({
      where: { zonaId, parejaId: pGanadores.ganadorId },
      data: { posicion: 1 }
    });
    if (loser) {
      await prisma.zonaPareja.updateMany({
        where: { zonaId, parejaId: loser },
        data: { posicion: 2 }
      });
    }
  }

  // Partido 4 define 3ro y 4to
  if (pPerdedores.estado === 'FINALIZADO' && pPerdedores.ganadorId) {
    const loser = getPerdedor(pPerdedores);
    await prisma.zonaPareja.updateMany({
      where: { zonaId, parejaId: pPerdedores.ganadorId },
      data: { posicion: 3 }
    });
    if (loser) {
      await prisma.zonaPareja.updateMany({
        where: { zonaId, parejaId: loser },
        data: { posicion: 4 }
      });
    }
  }

  // Actualizar stats visuales de la tabla
  await recalcularStatsZona(zonaId);
}

function validarSetPadel(gamesP1, gamesP2, setNum) {
  if (typeof gamesP1 !== 'number' || typeof gamesP2 !== 'number' || isNaN(gamesP1) || isNaN(gamesP2)) {
    const error = new Error(`Los games del Set ${setNum} deben ser números válidos.`);
    error.statusCode = 400;
    throw error;
  }
  if (gamesP1 < 0 || gamesP2 < 0) {
    const error = new Error(`Los games del Set ${setNum} no pueden ser negativos.`);
    error.statusCode = 400;
    throw error;
  }
  if (gamesP1 === gamesP2) {
    const error = new Error(`El Set ${setNum} no puede terminar en empate (${gamesP1}-${gamesP2}).`);
    error.statusCode = 400;
    throw error;
  }

  const max = Math.max(gamesP1, gamesP2);
  const min = Math.min(gamesP1, gamesP2);

  if (max < 6) {
    const error = new Error(`El Set ${setNum} (${gamesP1}-${gamesP2}) está incompleto. Se gana con al menos 6 games.`);
    error.statusCode = 400;
    throw error;
  }
  if (max === 6 && max - min < 2) {
    const error = new Error(`El Set ${setNum} (${gamesP1}-${gamesP2}) es inválido. Si van 6-5 debe jugarse hasta 7-5 o 7-6.`);
    error.statusCode = 400;
    throw error;
  }
  if (max === 7 && min !== 5 && min !== 6) {
    const error = new Error(`El Set ${setNum} (${gamesP1}-${gamesP2}) es inválido. Quien gana 7 games debe ser por 7-5 o 7-6.`);
    error.statusCode = 400;
    throw error;
  }
  if (max > 7) {
    const error = new Error(`El Set ${setNum} (${gamesP1}-${gamesP2}) es inválido. En pádel un set no puede tener más de 7 games.`);
    error.statusCode = 400;
    throw error;
  }
}

/**
 * Cargar el resultado parcial o total de un partido (sets).
 */
async function cargarResultado(organizadorId, partidoId, data) {
  const partido = await getPartidoAndVerifyPermisos(organizadorId, partidoId);
  const { sets } = data;

  if (!partido.pareja1Id || !partido.pareja2Id) {
    const error = new Error('El partido no tiene las parejas definidas todavía.');
    error.statusCode = 400;
    throw error;
  }

  if (!Array.isArray(sets) || sets.length === 0) {
    const error = new Error('Debes proveer al menos un set.');
    error.statusCode = 400;
    throw error;
  }

  if (sets.length > 3) {
    const error = new Error('Un partido no puede tener más de 3 sets.');
    error.statusCode = 400;
    throw error;
  }

  // Validar cada set según reglas de pádel
  sets.forEach((s, idx) => {
    validarSetPadel(s.gamesPareja1, s.gamesPareja2, idx + 1);
  });

  // Determinar si ya hay ganador
  let setsGanadosP1 = 0;
  let setsGanadosP2 = 0;

  for (const set of sets) {
    if (set.gamesPareja1 > set.gamesPareja2) setsGanadosP1++;
    else if (set.gamesPareja2 > set.gamesPareja1) setsGanadosP2++;
  }

  // Validar que no se envíe set 3 innecesario (si ya estaban 2-0)
  if (sets.length > 2) {
    const w1 = sets[0].gamesPareja1 > sets[0].gamesPareja2 ? 1 : 2;
    const w2 = sets[1].gamesPareja1 > sets[1].gamesPareja2 ? 1 : 2;
    if (w1 === w2) {
      const error = new Error(`Pareja ${w1} ya ganó los primeros 2 sets. No se puede agregar un tercer set.`);
      error.statusCode = 400;
      throw error;
    }
  }

  // Calcular el estado y ganador resultante
  let ganadorId = null;
  let nuevoEstado = 'EN_CURSO';

  if (setsGanadosP1 >= 2) {
    ganadorId = partido.pareja1Id;
    nuevoEstado = 'FINALIZADO';
  } else if (setsGanadosP2 >= 2) {
    ganadorId = partido.pareja2Id;
    nuevoEstado = 'FINALIZADO';
  }

  await prisma.$transaction(async (tx) => {
    // Reemplazar todos los sets con los nuevos
    await tx.setPartido.deleteMany({ where: { partidoId } });

    await tx.setPartido.createMany({
      data: sets.map((s, index) => ({
        partidoId,
        numero: index + 1,
        gamesPareja1: s.gamesPareja1,
        gamesPareja2: s.gamesPareja2,
      })),
    });

    // Actualizar estado y ganador del partido
    await tx.partido.update({
      where: { id: partidoId },
      data: {
        estado: nuevoEstado,
        ganadorId,
      },
    });
  });

  // Disparar lógica post-resultado solo cuando el partido está FINALIZADO
  if (nuevoEstado === 'FINALIZADO') {
    if (partido.zonaId) {
      const zona = await prisma.zona.findUnique({ where: { id: partido.zonaId } });
      if (zona.formato === 'ROUND_ROBIN') {
        await recalcularStatsZona(partido.zonaId);
      } else if (zona.formato === 'MINI_BRACKET') {
        await propagarMiniBracket(partido.zonaId);
      }

      // Auto-asignación de clasificados y programación de domingo si concluyó la fase de grupos
      try {
        await verificarYAutoAsignarEliminatoria(organizadorId, partido.categoriaId);
      } catch (errAuto) {
        console.error('[Auto-Eliminatoria] Error al auto-asignar eliminatoria tras partido de zona:', errAuto);
      }
    }

    if (partido.faseEliminatoriaId) {
      await propagarEliminatoria(partido, ganadorId);
    }
  } else {
    // Si el partido estaba FINALIZADO y ahora vuelve a EN_CURSO (edición parcial),
    // revertimos las stats y la propagación del bracket
    if (partido.estado === 'FINALIZADO') {
      if (partido.zonaId) {
        const zona = await prisma.zona.findUnique({ where: { id: partido.zonaId } });
        if (zona.formato === 'ROUND_ROBIN') {
          await recalcularStatsZona(partido.zonaId);
        } else if (zona.formato === 'MINI_BRACKET') {
          await propagarMiniBracket(partido.zonaId);
        }
      }
      if (partido.faseEliminatoriaId) {
        await propagarEliminatoria(partido, null);
      }
    }
  }

  return { message: nuevoEstado === 'FINALIZADO' ? 'Partido finalizado.' : 'Set guardado. Partido en curso.' };
}

/**
 * Cuando se carga el resultado de un partido de fase eliminatoria,
 * busca el partido de la siguiente ronda y asigna el ganador en el slot correcto.
 */
async function propagarEliminatoria(partido, ganadorId, externalTx = null) {
  const db = externalTx || prisma;
  const faseActual = await db.faseEliminatoria.findUnique({
    where: { id: partido.faseEliminatoriaId },
  });

  if (!faseActual) return;

  if (faseActual.ronda <= 2) return; // Es la final (ronda=2), no hay siguiente ronda

  const siguienteRondaNum = faseActual.ronda / 2;

  // Buscar la fase de la siguiente ronda dentro de la misma categoría
  const faseSiguiente = await db.faseEliminatoria.findFirst({
    where: {
      categoriaId: partido.categoriaId,
      ronda: siguienteRondaNum,
    },
  });

  if (!faseSiguiente) return;

  const posActual = partido.posicionEnRonda;
  const posSiguiente = Math.ceil(posActual / 2);
  const esSlotP1 = posActual % 2 === 1; // impar → pareja1

  // Buscar el partido destino en la siguiente ronda
  const partidoDestino = await db.partido.findFirst({
    where: {
      faseEliminatoriaId: faseSiguiente.id,
      posicionEnRonda: posSiguiente,
    },
  });

  if (!partidoDestino) return;

  // Determine origenPareja of the winner
  let origenGanador = null;
  let parejaGanadoraId = ganadorId;

  if (ganadorId) {
    if (ganadorId === partido.pareja1Id) origenGanador = partido.origenPareja1;
    else if (ganadorId === partido.pareja2Id) origenGanador = partido.origenPareja2;
  } else if (partido.estado === 'FINALIZADO') {
    if (partido.origenPareja1 && !partido.origenPareja2) {
      origenGanador = partido.origenPareja1;
      parejaGanadoraId = partido.pareja1Id;
    } else if (partido.origenPareja2 && !partido.origenPareja1) {
      origenGanador = partido.origenPareja2;
      parejaGanadoraId = partido.pareja2Id;
    }
  }

  await db.partido.update({
    where: { id: partidoDestino.id },
    data: esSlotP1
      ? { pareja1Id: parejaGanadoraId, origenPareja1: origenGanador }
      : { pareja2Id: parejaGanadoraId, origenPareja2: origenGanador },
  });
}

/**
 * Borra el resultado de un partido y revierte su estado a PENDIENTE.
 */
async function borrarResultado(organizadorId, partidoId) {
  const partido = await getPartidoAndVerifyPermisos(organizadorId, partidoId);

  if (partido.estado !== 'FINALIZADO') {
    return { message: 'El partido no está finalizado.' };
  }

  await prisma.$transaction(async (tx) => {
    await tx.setPartido.deleteMany({ where: { partidoId } });

    await tx.partido.update({
      where: { id: partidoId },
      data: {
        estado: 'PENDIENTE',
        ganadorId: null,
      },
    });
  });

  // Si es partido de zona, recalcular stats
  if (partido.zonaId) {
    const zona = await prisma.zona.findUnique({ where: { id: partido.zonaId } });
    if (zona.formato === 'ROUND_ROBIN') {
      await recalcularStatsZona(partido.zonaId);
    } else if (zona.formato === 'MINI_BRACKET') {
      await propagarMiniBracket(partido.zonaId);
    }
  }

  // Si es eliminatoria, limpiar la propagación
  if (partido.faseEliminatoriaId) {
    await propagarEliminatoria(partido, null);
  }

  return { message: 'Resultado borrado exitosamente.' };
}

async function updateFechaHora(organizadorId, partidoId, fechaHora) {
  await getPartidoAndVerifyPermisos(organizadorId, partidoId);
  const partido = await prisma.partido.update({
    where: { id: partidoId },
    data: { fechaHora: fechaHora ? new Date(fechaHora) : null },
  });
  return partido;
}

async function updateBracketMatch(organizadorId, partidoId, data) {
  const partido = await getPartidoAndVerifyPermisos(organizadorId, partidoId);

  if (!partido.faseEliminatoriaId) {
    const error = new Error('El partido no pertenece a una fase eliminatoria.');
    error.statusCode = 400;
    throw error;
  }

  if (partido.estado === 'FINALIZADO') {
    const error = new Error('No se puede editar un partido que ya finalizó.');
    error.statusCode = 400;
    throw error;
  }

  if (partido.esBye) {
    const error = new Error('No se pueden editar cruces de un partido pase directo (BYE).');
    error.statusCode = 400;
    throw error;
  }

  const { origenPareja1, origenPareja2, liberarEnOtros } = data;

  const nuevoOrigen1 = origenPareja1 !== undefined ? (origenPareja1 || null) : partido.origenPareja1;
  const nuevoOrigen2 = origenPareja2 !== undefined ? (origenPareja2 || null) : partido.origenPareja2;

  if (nuevoOrigen1 && nuevoOrigen2 && nuevoOrigen1 === nuevoOrigen2) {
    const error = new Error('No podés asignar el mismo origen en ambos lados del partido.');
    error.statusCode = 400;
    throw error;
  }

  // Detectar colisiones con otros partidos de la misma ronda
  let partidosEnConflicto = [];
  if (nuevoOrigen1 || nuevoOrigen2) {
    const otrosPartidos = await prisma.partido.findMany({
      where: {
        faseEliminatoriaId: partido.faseEliminatoriaId,
        id: { not: partidoId },
      },
    });

    partidosEnConflicto = otrosPartidos.filter((p) => {
      const match1 = nuevoOrigen1 && (p.origenPareja1 === nuevoOrigen1 || p.origenPareja2 === nuevoOrigen1);
      const match2 = nuevoOrigen2 && (p.origenPareja1 === nuevoOrigen2 || p.origenPareja2 === nuevoOrigen2);
      return match1 || match2;
    });

    // Si algún partido en colisión está FINALIZADO, nunca se puede modificar
    for (const p of partidosEnConflicto) {
      if (p.estado === 'FINALIZADO') {
        const error = new Error(
          `No se puede mover el origen porque el Partido #${p.posicionEnRonda} ya está finalizado.`
        );
        error.statusCode = 400;
        throw error;
      }
    }

    // Si hay colisión y no se autorizó la liberación, arrojar error descriptivo
    if (partidosEnConflicto.length > 0 && !liberarEnOtros) {
      const primerConflicto = partidosEnConflicto[0];
      const origenConflictivo =
        (nuevoOrigen1 && (primerConflicto.origenPareja1 === nuevoOrigen1 || primerConflicto.origenPareja2 === nuevoOrigen1))
          ? nuevoOrigen1
          : nuevoOrigen2;
      const error = new Error(
        `El origen "${origenConflictivo}" ya está asignado en el Partido #${primerConflicto.posicionEnRonda} de esta ronda.`
      );
      error.statusCode = 400;
      throw error;
    }
  }

  // Preparar update del partido actual
  const updateDataActual = {};
  let pareja1IdActual = partido.pareja1Id;
  let pareja2IdActual = partido.pareja2Id;

  if (origenPareja1 !== undefined) {
    updateDataActual.origenPareja1 = nuevoOrigen1;
    if (!nuevoOrigen1) {
      pareja1IdActual = null;
    }
  }
  if (origenPareja2 !== undefined) {
    updateDataActual.origenPareja2 = nuevoOrigen2;
    if (!nuevoOrigen2) {
      pareja2IdActual = null;
    }
  }

  // Si hay partidos en conflicto y liberarEnOtros está activo, ejecutar transacción atómica
  if (partidosEnConflicto.length > 0 && liberarEnOtros) {
    return await prisma.$transaction(async (tx) => {
      // Liberar en los partidos en conflicto y rastrear parejas físicas a transferir
      for (const p of partidosEnConflicto) {
        const updateConflicto = {};
        if (nuevoOrigen1 && p.origenPareja1 === nuevoOrigen1) {
          updateConflicto.origenPareja1 = null;
          if (p.pareja1Id) {
            pareja1IdActual = p.pareja1Id;
            updateConflicto.pareja1Id = null;
          }
        }
        if (nuevoOrigen1 && p.origenPareja2 === nuevoOrigen1) {
          updateConflicto.origenPareja2 = null;
          if (p.pareja2Id) {
            pareja1IdActual = p.pareja2Id;
            updateConflicto.pareja2Id = null;
          }
        }
        if (nuevoOrigen2 && p.origenPareja1 === nuevoOrigen2) {
          updateConflicto.origenPareja1 = null;
          if (p.pareja1Id) {
            pareja2IdActual = p.pareja1Id;
            updateConflicto.pareja1Id = null;
          }
        }
        if (nuevoOrigen2 && p.origenPareja2 === nuevoOrigen2) {
          updateConflicto.origenPareja2 = null;
          if (p.pareja2Id) {
            pareja2IdActual = p.pareja2Id;
            updateConflicto.pareja2Id = null;
          }
        }

        await tx.partido.update({
          where: { id: p.id },
          data: updateConflicto,
        });
      }

      updateDataActual.pareja1Id = pareja1IdActual;
      updateDataActual.pareja2Id = pareja2IdActual;

      const updated = await tx.partido.update({
        where: { id: partidoId },
        data: updateDataActual,
      });

      return updated;
    });
  }

  // Sin colisiones: actualizar directamente
  if (origenPareja1 !== undefined && !nuevoOrigen1) {
    updateDataActual.pareja1Id = null;
  }
  if (origenPareja2 !== undefined && !nuevoOrigen2) {
    updateDataActual.pareja2Id = null;
  }

  const updated = await prisma.partido.update({
    where: { id: partidoId },
    data: updateDataActual,
  });

  return updated;
}

async function getPartidosByCategoria(organizadorId, categoriaId, filters = {}) {
  await getCategoriaById(organizadorId, categoriaId);

  const { zonaId, faseId } = filters;

  const where = { categoriaId };
  if (zonaId) where.zonaId = zonaId;
  if (faseId) where.faseEliminatoriaId = faseId;

  return await prisma.partido.findMany({
    where,
    include: {
      categoria: { select: { id: true, nombre: true } },
      zona: { select: { id: true, nombre: true } },
      pareja1: {
        include: {
          slotsSeleccionados: true,
        },
      },
      pareja2: {
        include: {
          slotsSeleccionados: true,
        },
      },
      ganador: true,
      sets: { orderBy: { numero: 'asc' } },
    },
    orderBy: [
      { zonaId: 'asc' },
      { faseEliminatoriaId: 'asc' },
      { posicionEnRonda: 'asc' }
    ]
  });
}

async function asignarHorarioManual(organizadorId, partidoId, data = {}) {
  const partido = await getPartidoAndVerifyPermisos(organizadorId, partidoId);
  const { slotId, canchaNumero, fechaHora } = data;

  const torneo = await prisma.torneo.findUnique({
    where: { id: partido.categoria.torneoId },
  });
  const organizador = await prisma.organizador.findUnique({
    where: { id: organizadorId },
  });

  const refFecha = requireTorneoFecha(torneo);
  let targetDate = null;

  if (fechaHora) {
    targetDate = new Date(fechaHora);
  } else if (slotId) {
    targetDate = parseSlotToDate(slotId, refFecha);
  }

  if (!targetDate || isNaN(targetDate.getTime())) {
    const error = new Error('Fecha/horario inválido o no especificado.');
    error.statusCode = 400;
    throw error;
  }

  const canchaNum = parseInt(canchaNumero, 10);
  if (isNaN(canchaNum) || canchaNum < 1 || canchaNum > (organizador.cantidadCanchas || 1)) {
    const error = new Error(`El número de cancha debe ser entre 1 y ${organizador.cantidadCanchas || 1}.`);
    error.statusCode = 400;
    throw error;
  }

  const targetStartMs = targetDate.getTime();
  const targetEndMs = targetStartMs + 75 * 60 * 1000;

  // Validar colisión de cancha con otros partidos del torneo
  const otrosPartidos = await prisma.partido.findMany({
    where: {
      categoria: { torneoId: torneo.id },
      id: { not: partidoId },
      fechaHora: { not: null },
    },
    include: {
      pareja1: true,
      pareja2: true,
    },
  });

  for (const otro of otrosPartidos) {
    const oStartMs = new Date(otro.fechaHora).getTime();
    const oEndMs = oStartMs + 75 * 60 * 1000;

    const haySolapamiento = Math.max(targetStartMs, oStartMs) < Math.min(targetEndMs, oEndMs);
    if (haySolapamiento) {
      if (otro.canchaNumero === canchaNum) {
        const error = new Error(`La cancha ${canchaNum} ya está ocupada en ese horario por otro partido.`);
        error.statusCode = 409;
        throw error;
      }

      if (partido.pareja1Id && (otro.pareja1Id === partido.pareja1Id || otro.pareja2Id === partido.pareja1Id)) {
        const error = new Error(`La pareja "${partido.pareja1?.jugador1} / ${partido.pareja1?.jugador2}" ya tiene otro partido en ese horario.`);
        error.statusCode = 409;
        throw error;
      }
      if (partido.pareja2Id && (otro.pareja1Id === partido.pareja2Id || otro.pareja2Id === partido.pareja2Id)) {
        const error = new Error(`La pareja "${partido.pareja2?.jugador1} / ${partido.pareja2?.jugador2}" ya tiene otro partido en ese horario.`);
        error.statusCode = 409;
        throw error;
      }
    }
  }

  const updated = await prisma.partido.update({
    where: { id: partidoId },
    data: {
      fechaHora: targetDate,
      canchaNumero: canchaNum,
      sinHorarioAsignado: false,
    },
    include: {
      categoria: { select: { id: true, nombre: true } },
      zona: { select: { id: true, nombre: true } },
      pareja1: true,
      pareja2: true,
    },
  });

  return {
    message: 'Horario y cancha asignados correctamente.',
    partido: updated,
  };
}

/**
 * Actualiza el estado de un partido entre PENDIENTE y EN_CURSO.
 * No permite tocar partidos que ya están en FINALIZADO.
 */
async function updateEstado(organizadorId, partidoId, nuevoEstado) {
  if (!['EN_CURSO', 'PENDIENTE'].includes(nuevoEstado)) {
    const error = new Error('Estado inválido. Solo se permite "EN_CURSO" o "PENDIENTE".');
    error.statusCode = 400;
    throw error;
  }

  const partido = await getPartidoAndVerifyPermisos(organizadorId, partidoId);

  if (partido.estado === 'FINALIZADO') {
    const error = new Error('No se puede modificar el estado de un partido finalizado desde aquí. Editá o borrá el resultado.');
    error.statusCode = 400;
    throw error;
  }

  if (nuevoEstado === 'EN_CURSO' && partido.estado !== 'PENDIENTE') {
    const error = new Error('Solo se puede pasar a EN_CURSO un partido que esté PENDIENTE.');
    error.statusCode = 400;
    throw error;
  }

  if (nuevoEstado === 'PENDIENTE' && partido.estado !== 'EN_CURSO') {
    const error = new Error('Solo se puede volver a PENDIENTE un partido que esté EN_CURSO.');
    error.statusCode = 400;
    throw error;
  }

  let updated;
  await prisma.$transaction(async (tx) => {
    // Si se revierte a PENDIENTE, limpiamos cualquier set parcial cargado
    if (nuevoEstado === 'PENDIENTE') {
      await tx.setPartido.deleteMany({ where: { partidoId } });
    }

    updated = await tx.partido.update({
      where: { id: partidoId },
      data: { estado: nuevoEstado },
      include: {
        categoria: { select: { id: true, nombre: true } },
        zona: { select: { id: true, nombre: true } },
        pareja1: true,
        pareja2: true,
      },
    });
  });

  return {
    message: nuevoEstado === 'EN_CURSO' ? 'Partido marcado como En Juego.' : 'Partido devuelto a estado Pendiente.',
    partido: updated,
  };
}

/**
 * Auto-asigna clasificados al cuadro eliminatorio si se completaron todos los partidos de zona de la categoría.
 * También dispara la auto-programación de primera ronda de domingo si corresponde.
 */
async function verificarYAutoAsignarEliminatoria(organizadorId, categoriaId) {
  if (!categoriaId || !organizadorId) return null;

  // 1. Contar partidos de zona no finalizados en esta categoría
  const partidosPendientes = await prisma.partido.count({
    where: {
      categoriaId,
      zonaId: { not: null },
      estado: { not: 'FINALIZADO' },
    },
  });

  // Si aún quedan partidos de zona pendientes o en curso, no se auto-asigna
  if (partidosPendientes > 0) return null;

  // 2. Verificar si la categoría tiene fases eliminatorias creadas (bracket generado al inicio)
  const fasesCount = await prisma.faseEliminatoria.count({
    where: { categoriaId },
  });

  if (fasesCount === 0) return null;

  // 3. Ejecutar asignación de clasificados (poblado dinámico del bracket existente)
  const { generarEliminatoria } = require('./faseEliminatoria.service');
  const { asignarHorariosRondaUno } = require('./eliminatoriaScheduler.service');

  const resultado = await generarEliminatoria(organizadorId, categoriaId);

  // 4. Si no es dieciseisavos (que se juegan el sábado a la noche), programar domingo
  if (!resultado.esDieciseisavos) {
    const categoria = await prisma.categoria.findUnique({
      where: { id: categoriaId },
      select: { torneoId: true },
    });

    if (categoria?.torneoId) {
      try {
        await asignarHorariosRondaUno(organizadorId, categoria.torneoId, categoriaId);
      } catch (errSched) {
        console.warn(`[Auto-Scheduler] Aviso al auto-programar domingo para categoría ${categoriaId}:`, errSched.message);
      }
    }
  }

  return resultado;
}

module.exports = {
  cargarResultado,
  borrarResultado,
  updateFechaHora,
  updateBracketMatch,
  propagarEliminatoria,
  propagarMiniBracket,
  getPartidosByCategoria,
  asignarHorarioManual,
  updateEstado,
  verificarYAutoAsignarEliminatoria,
};
