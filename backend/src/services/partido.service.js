const prisma = require('../lib/prisma');

async function getPartidoAndVerifyPermisos(organizadorId, partidoId) {
  const partido = await prisma.partido.findUnique({
    where: { id: partidoId },
    include: {
      torneo: true,
      zona: true,
      faseEliminatoria: true,
    },
  });

  if (!partido) {
    const error = new Error('Partido no encontrado.');
    error.statusCode = 404;
    throw error;
  }

  if (partido.torneo.organizadorId !== organizadorId) {
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

  // partidos[0] = P1vsP2 (pos 1)
  // partidos[1] = P3vsP4 (pos 2)
  // partidos[2] = Ganadores (pos 3)
  // partidos[3] = Perdedores (pos 4)

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
 * Cargar el resultado de un partido (sets).
 */
async function cargarResultado(organizadorId, partidoId, data) {
  const partido = await getPartidoAndVerifyPermisos(organizadorId, partidoId);
  const { sets } = data; // Array: [{ numero: 1, gamesPareja1: 6, gamesPareja2: 4 }, ...]

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

  // Validar cada set según reglas de pádel
  sets.forEach((s, idx) => {
    validarSetPadel(s.gamesPareja1, s.gamesPareja2, idx + 1);
  });

  // Validar y calcular ganador del partido
  let setsGanadosP1 = 0;
  let setsGanadosP2 = 0;

  for (const set of sets) {
    if (set.gamesPareja1 > set.gamesPareja2) setsGanadosP1++;
    else if (set.gamesPareja2 > set.gamesPareja1) setsGanadosP2++;
  }

  let ganadorId = null;
  if (setsGanadosP1 >= 2) ganadorId = partido.pareja1Id;
  else if (setsGanadosP2 >= 2) ganadorId = partido.pareja2Id;

  if (!ganadorId) {
    const error = new Error('El resultado ingresado no define un ganador (se necesitan ganar 2 sets).');
    error.statusCode = 400;
    throw error;
  }

  await prisma.$transaction(async (tx) => {
    // Borrar sets anteriores si es una edición
    await tx.setPartido.deleteMany({ where: { partidoId } });

    // Crear nuevos sets
    await tx.setPartido.createMany({
      data: sets.map((s, index) => ({
        partidoId,
        numero: index + 1,
        gamesPareja1: s.gamesPareja1,
        gamesPareja2: s.gamesPareja2,
      })),
    });

    // Actualizar partido
    await tx.partido.update({
      where: { id: partidoId },
      data: {
        estado: 'FINALIZADO',
        ganadorId,
      },
    });
  });

  // Si es partido de zona, ejecutamos lógica secundaria
  if (partido.zonaId) {
    const zona = await prisma.zona.findUnique({ where: { id: partido.zonaId } });
    if (zona.formato === 'ROUND_ROBIN') {
      await recalcularStatsZona(partido.zonaId);
    } else if (zona.formato === 'MINI_BRACKET') {
      await propagarMiniBracket(partido.zonaId);
      // Opcional: recalcularStatsZona(partido.zonaId) también sirve para el mini-bracket para tener tabla, aunque no define posiciones directamente.
      // La clasificación del mini-bracket se saca por quién gana P3 y P4.
    }
  }

  // Ticket 4.2: Si es eliminatoria, propagar ganador a la siguiente ronda
  if (partido.faseEliminatoriaId) {
    await propagarEliminatoria(partido, ganadorId);
  }

  return { message: 'Resultado cargado exitosamente.' };
}

/**
 * Cuando se carga el resultado de un partido de fase eliminatoria,
 * busca el partido de la siguiente ronda y asigna el ganador en el slot correcto.
 */
async function propagarEliminatoria(partido, ganadorId) {
  // Obtener la fase actual para conocer su ronda
  const faseActual = await prisma.faseEliminatoria.findUnique({
    where: { id: partido.faseEliminatoriaId },
  });

  if (!faseActual) return;

  // La siguiente ronda tiene la mitad de partidos (ronda / 2)
  // Si ronda === 2 → siguiente es Final (ronda 1)
  // Si ronda === 1 → ya es la final, no hay siguiente
  if (faseActual.ronda <= 2) return; // Es la final (ronda=2), no hay siguiente ronda

  const siguienteRondaNum = faseActual.ronda / 2;

  // Buscar la fase de la siguiente ronda
  const faseSiguiente = await prisma.faseEliminatoria.findFirst({
    where: {
      torneoId: partido.torneoId,
      ronda: siguienteRondaNum,
    },
  });

  if (!faseSiguiente) return;

  // Determinar qué slot ocupa el ganador en la siguiente ronda:
  // Los partidos se emparejan de a 2: pos 1 y 2 alimentan partido 1; pos 3 y 4 → partido 2; etc.
  // posicionEnRonda del partido actual → Math.ceil(pos / 2) = posición en siguiente ronda
  // Si posición es impar → slot pareja1; si es par → slot pareja2
  const posActual = partido.posicionEnRonda;
  const posSiguiente = Math.ceil(posActual / 2);
  const esSlotP1 = posActual % 2 === 1; // impar → pareja1

  // Buscar el partido destino en la siguiente ronda
  const partidoDestino = await prisma.partido.findFirst({
    where: {
      faseEliminatoriaId: faseSiguiente.id,
      posicionEnRonda: posSiguiente,
    },
  });

  if (!partidoDestino) return;

  // Determine origenPareja of the winner
  let origenGanador = null;
  if (ganadorId) {
    if (ganadorId === partido.pareja1Id) origenGanador = partido.origenPareja1;
    else if (ganadorId === partido.pareja2Id) origenGanador = partido.origenPareja2;
  }

  // Asignar el ganador en el slot correcto (puede ser null si se borra el resultado)
  await prisma.partido.update({
    where: { id: partidoDestino.id },
    data: esSlotP1
      ? { pareja1Id: ganadorId, origenPareja1: origenGanador }
      : { pareja2Id: ganadorId, origenPareja2: origenGanador },
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
    // Borrar sets
    await tx.setPartido.deleteMany({ where: { partidoId } });

    // Actualizar partido
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

module.exports = {
  cargarResultado,
  borrarResultado,
  updateFechaHora,
};
