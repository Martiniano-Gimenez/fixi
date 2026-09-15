const prisma = require('../lib/prisma');
const { getCategoriaById } = require('./categoria.service');

function ordenarZonaParejas(zonaParejas, formato) {
  if (!Array.isArray(zonaParejas)) return [];
  return [...zonaParejas].sort((a, b) => {
    if (formato === 'MINI_BRACKET') {
      const posA = a.posicion || 99;
      const posB = b.posicion || 99;
      if (posA !== posB) return posA - posB;
    }

    if (b.puntos !== a.puntos) return b.puntos - a.puntos;
    if (b.pg !== a.pg) return b.pg - a.pg;

    const diffSetsA = (a.sf || 0) - (a.sc || 0);
    const diffSetsB = (b.sf || 0) - (b.sc || 0);
    if (diffSetsB !== diffSetsA) return diffSetsB - diffSetsA;

    const diffGamesA = (a.gf || 0) - (a.gc || 0);
    const diffGamesB = (b.gf || 0) - (b.gc || 0);
    if (diffGamesB !== diffGamesA) return diffGamesB - diffGamesA;

    return 0;
  });
}

function nombreRonda(ronda) {
  const nombres = {
    2: 'Final',
    4: 'Semifinal',
    8: 'Cuartos de Final',
    16: 'Octavos de Final',
    32: 'Dieciseisavos de Final',
    64: 'Treintaidosavos de Final',
  };
  return nombres[ronda] || `Ronda de ${ronda}`;
}

/**
 * Generar eliminatoria: obtener clasificadas y crear bracket por categoría
 * @param {string} organizadorId - ID del organizador
 * @param {string} categoriaId - ID de la categoría
 */
async function generarEliminatoria(organizadorId, categoriaId) {
  await getCategoriaById(organizadorId, categoriaId);

  // 0. Verificar si todos los partidos de las zonas están finalizados
  const partidosPendientes = await prisma.partido.count({
    where: {
      categoriaId,
      zonaId: { not: null },
      estado: { not: 'FINALIZADO' },
    },
  });

  const gruposFinalizados = partidosPendientes === 0;

  // 1. Obtener zonas de la categoría
  const zonas = await prisma.zona.findMany({
    where: { categoriaId },
    orderBy: { nombre: 'asc' },
    include: {
      zonaParejas: {
        include: { pareja: true },
      },
    },
  });

  if (zonas.length === 0) {
    const error = new Error('La categoría no tiene zonas generadas.');
    error.statusCode = 400;
    throw error;
  }

  // 2. Recolectar y clasificar parejas
  const primeros = [];
  const segundos = [];
  const otros = [];

  zonas.forEach((zona) => {
    const ordenadas = ordenarZonaParejas(zona.zonaParejas, zona.formato);
    const topZona = ordenadas.slice(0, zona.clasifican);
    
    for (let index = 0; index < zona.clasifican; index++) {
      let parejaId = null;
      let pareja = null;
      
      if (gruposFinalizados && topZona[index]) {
        parejaId = topZona[index].parejaId;
        pareja = topZona[index].pareja;
      }

      const p = {
        parejaId,
        pareja,
        zonaOrigen: zona.nombre,
        origenTxt: `${index + 1}° ${zona.nombre}`,
      };

      if (index === 0) primeros.push(p);
      else if (index === 1) segundos.push(p);
      else otros.push(p);
    }
  });

  const clasificadas = [...primeros, ...segundos, ...otros];

  if (clasificadas.length === 0) {
    const error = new Error('No hay parejas para clasificar.');
    error.statusCode = 400;
    throw error;
  }

  // 2.5. Si existen fases eliminatorias viejas, POBLAMOS el bracket en lugar de borrarlo
  const faseViejas = await prisma.faseEliminatoria.findMany({
    where: { categoriaId },
  });
  
  if (faseViejas.length > 0) {
    const clasificadasMap = new Map();
    clasificadas.forEach(c => clasificadasMap.set(c.origenTxt, c));

    const primeraRondaNum = Math.max(...faseViejas.map(f => f.ronda));
    const fasePrimeraRonda = faseViejas.find(f => f.ronda === primeraRondaNum);
    const esDieciseisavos = primeraRondaNum >= 32;
    
    const partidosPrimeraRonda = await prisma.partido.findMany({ 
      where: { faseEliminatoriaId: fasePrimeraRonda.id },
      orderBy: { posicionEnRonda: 'asc' },
    });

    for (const partido of partidosPrimeraRonda) {
      const updateData = {};
      if (esDieciseisavos && partido.estado !== 'FINALIZADO') {
        updateData.sinHorarioAsignado = true;
      }
      
      // Solo actualizar parejas si el partido de primera ronda aún no comenzó (PENDIENTE)
      if (partido.estado === 'PENDIENTE') {
        if (partido.origenPareja1) {
          const c1 = clasificadasMap.get(partido.origenPareja1);
          if (c1 && c1.parejaId) updateData.pareja1Id = c1.parejaId;
        }
        
        if (partido.origenPareja2) {
          const c2 = clasificadasMap.get(partido.origenPareja2);
          if (c2 && c2.parejaId) updateData.pareja2Id = c2.parejaId;
        }
      }

      // Determinar parejas efectivas tras el update
      const pareja1Id = updateData.pareja1Id !== undefined ? updateData.pareja1Id : partido.pareja1Id;
      const pareja2Id = updateData.pareja2Id !== undefined ? updateData.pareja2Id : partido.pareja2Id;

      // Detectar BYE: un slot tiene origen pero la pareja contraria no tiene origen (es BYE)
      const esBye = (partido.origenPareja1 && !partido.origenPareja2) || 
                    (!partido.origenPareja1 && partido.origenPareja2);
      
      if (esBye && partido.estado !== 'FINALIZADO') {
        if (pareja1Id && !pareja2Id) {
          updateData.estado = 'FINALIZADO';
          updateData.ganadorId = pareja1Id;
        } else if (pareja2Id && !pareja1Id) {
          updateData.estado = 'FINALIZADO';
          updateData.ganadorId = pareja2Id;
        }
      }
      
      // Partidos ya finalizados previamente (caso edge de re-ejecución)
      if (partido.estado === 'FINALIZADO') {
        if (pareja1Id && !pareja2Id) {
          updateData.ganadorId = pareja1Id;
        } else if (pareja2Id && !pareja1Id) {
          updateData.ganadorId = pareja2Id;
        }
      }

      if (Object.keys(updateData).length > 0) {
        await prisma.partido.update({ 
          where: { id: partido.id }, 
          data: updateData 
        });

        // Propagar ganador de BYE a la siguiente ronda
        if (updateData.ganadorId) {
          const { propagarEliminatoria } = require('./partido.service');
          const updatedPartido = { ...partido, ...updateData };
          await propagarEliminatoria(updatedPartido, updateData.ganadorId);
        }
      }
    }

    return { 
      message: 'Clasificados asignados al bracket exitosamente.',
      primeraRonda: primeraRondaNum,
      esDieciseisavos,
    };
  }

  // 3. Determinar estructura de rondas
  const totalParejas = clasificadas.length;
  const potencias = [2, 4, 8, 16, 32, 64];
  let potencia = 2;
  for (const p of potencias) {
    if (p >= totalParejas) {
      potencia = p;
      break;
    }
  }

  const rondas = [];
  let r = potencia;
  while (r >= 2) {
    rondas.push(r);
    r = r / 2;
  }

  // 4. Crear FaseEliminatoria para cada ronda
  const fases = {};
  for (const ronda of rondas) {
    const fase = await prisma.faseEliminatoria.create({
      data: {
        categoriaId,
        nombre: nombreRonda(ronda),
        ronda,
      },
    });
    fases[ronda] = fase.id;
  }

  // 5. Lógica de Seeding Dinámico
  const M = potencia / 2;

  function getMatchSequence(m) {
    if (m === 1) return [1];
    let seq = [1, 2];
    let currentM = 2;
    while (currentM < m) {
      const nextSeq = [];
      const sum = currentM * 2 + 1;
      for (const val of seq) {
        if (val % 2 !== 0) nextSeq.push(val, sum - val);
        else nextSeq.push(sum - val, val);
      }
      seq = nextSeq;
      currentM *= 2;
    }
    return seq;
  }

  const seq = getMatchSequence(M);
  const matchSlots = Array.from({ length: M }, () => ({ p1: null, p2: null }));

  // 5.1. Ubicar a los 1ros
  for (let i = 0; i < primeros.length; i++) {
    if (i < M) {
      const matchIdx = seq[i] - 1;
      matchSlots[matchIdx].p1 = primeros[i];
    }
  }

  // 5.2. Asignar BYEs a los mejores 1ros
  const numByes = potencia - totalParejas;
  for (let i = 0; i < numByes; i++) {
    if (i < M) {
      const matchIdx = seq[i] - 1;
      matchSlots[matchIdx].p2 = { isBye: true };
    }
  }

  // 5.3. Ubicar a los 2dos (y 1ros excedentes si clasificó 1 solo por zona, o 3ros si los hay)
  const restoClasificados = [...primeros.slice(M), ...segundos, ...otros];
  for (let i = 0; i < restoClasificados.length; i++) {
    const equipo = restoClasificados[i];
    const idealSeqIdx = i ^ 1; 
    let placed = false;

    if (idealSeqIdx < M) {
      const idealMatchIdx = seq[idealSeqIdx] - 1;
      if (matchSlots[idealMatchIdx].p2 === null) {
        matchSlots[idealMatchIdx].p2 = equipo;
        placed = true;
      }
    }

    if (!placed) {
      const firstMatchIdx = i < seq.length ? seq[i] - 1 : 0;
      const isFirstTopHalf = firstMatchIdx < M / 2;

      const searchIndices = [];
      for (let k = 0; k < M; k++) {
        const idx = seq[k] - 1;
        const isIdxTopHalf = idx < M / 2;
        if (isIdxTopHalf !== isFirstTopHalf) {
          searchIndices.push(idx);
        }
      }

      for (const idx of searchIndices) {
        if (matchSlots[idx].p1 !== null && matchSlots[idx].p2 === null) {
          matchSlots[idx].p2 = equipo;
          placed = true;
          break;
        }
      }

      if (!placed) {
        for (const idx of searchIndices) {
          if (matchSlots[idx].p1 === null) {
            matchSlots[idx].p1 = equipo;
            placed = true;
            break;
          }
        }
      }

      if (!placed) {
        for (let j = 0; j < M; j++) {
          if (matchSlots[j].p1 === null) { matchSlots[j].p1 = equipo; placed = true; break; }
          if (matchSlots[j].p2 === null) { matchSlots[j].p2 = equipo; placed = true; break; }
        }
      }
    }
  }

  // 6. Crear Partidos en la base de datos
  const primeraRonda = rondas[0];
  const esDieciseisavos = esRondaDieciseisavos(primeraRonda);
  const partidosPrimeraRonda = [];

  for (let i = 0; i < M; i++) {
    const slot = matchSlots[i];
    const p1 = slot.p1?.isBye ? null : slot.p1;
    const p2 = slot.p2?.isBye ? null : slot.p2;
    
    const isBye = slot.p1?.isBye || slot.p2?.isBye;
    let estado = 'PENDIENTE';
    let ganadorId = null;

    if (isBye && gruposFinalizados) {
      estado = 'FINALIZADO';
      if (p1) ganadorId = p1.parejaId;
      if (p2) ganadorId = p2.parejaId;
    }

    const partido = await prisma.partido.create({
      data: {
        categoriaId,
        faseEliminatoriaId: fases[primeraRonda],
        posicionEnRonda: i + 1,
        pareja1Id: p1?.parejaId || null,
        origenPareja1: p1?.origenTxt || null,
        pareja2Id: p2?.parejaId || null,
        origenPareja2: p2?.origenTxt || null,
        ganadorId,
        estado,
        sinHorarioAsignado: esDieciseisavos && !isBye,
      },
    });

    partidosPrimeraRonda.push(partido);
  }

  // 7. Crear Partidos vacíos para rondas posteriores y propagar BYEs directamente
  const partidosPorRondaYPos = {};

  for (let i = 1; i < rondas.length; i++) {
    const r = rondas[i];
    const cantPartidosEnRonda = Math.floor(r / 2);

    for (let j = 0; j < cantPartidosEnRonda; j++) {
      const p = await prisma.partido.create({
        data: {
          categoriaId,
          faseEliminatoriaId: fases[r],
          posicionEnRonda: j + 1,
          pareja1Id: null,
          pareja2Id: null,
          estado: 'PENDIENTE',
        },
      });
      partidosPorRondaYPos[`${r}:${j + 1}`] = p.id;
    }
  }

  // 8. Propagar ganadores / orígenes de BYEs a la siguiente ronda
  for (const partido of partidosPrimeraRonda) {
    if (partido.estado !== 'FINALIZADO') continue;

    let parejaAvanza = partido.ganadorId || null;
    let origenAvanza = null;

    if (partido.ganadorId) {
      if (partido.ganadorId === partido.pareja1Id) origenAvanza = partido.origenPareja1;
      else if (partido.ganadorId === partido.pareja2Id) origenAvanza = partido.origenPareja2;
    } else {
      if (partido.origenPareja1 && !partido.origenPareja2) {
        parejaAvanza = partido.pareja1Id;
        origenAvanza = partido.origenPareja1;
      } else if (partido.origenPareja2 && !partido.origenPareja1) {
        parejaAvanza = partido.pareja2Id;
        origenAvanza = partido.origenPareja2;
      }
    }

    if (!origenAvanza) continue;

    const posActual = partido.posicionEnRonda;
    const posSiguiente = Math.ceil(posActual / 2);
    const esSlotP1 = posActual % 2 === 1;

    const siguienteRondaNum = primeraRonda / 2;
    const partidoDestinoId = partidosPorRondaYPos[`${siguienteRondaNum}:${posSiguiente}`];

    if (!partidoDestinoId) continue;

    await prisma.partido.update({
      where: { id: partidoDestinoId },
      data: esSlotP1
        ? { pareja1Id: parejaAvanza, origenPareja1: origenAvanza }
        : { pareja2Id: parejaAvanza, origenPareja2: origenAvanza },
    });
  }

  return {
    totalParejas,
    potencia,
    rondas,
    fases,
    primeraRonda,
    esDieciseisavos,
  };
}

function esRondaDieciseisavos(ronda) {
  return Number(ronda) >= 32;
}

async function getFasesEliminatorias(organizadorId, categoriaId) {
  await getCategoriaById(organizadorId, categoriaId);

  return await prisma.faseEliminatoria.findMany({
    where: { categoriaId },
    orderBy: { ronda: 'desc' },
    include: {
      partidos: {
        orderBy: { posicionEnRonda: 'asc' },
        include: {
          pareja1: true,
          pareja2: true,
          ganador: true,
          sets: { orderBy: { numero: 'asc' } },
        },
      },
    },
  });
}

async function borrarEliminatoria(organizadorId, categoriaId) {
  await getCategoriaById(organizadorId, categoriaId);

  await prisma.$transaction(async (tx) => {
    await tx.partido.deleteMany({
      where: {
        categoriaId,
        faseEliminatoriaId: { not: null },
      },
    });

    await tx.faseEliminatoria.deleteMany({
      where: { categoriaId },
    });
  });

  return { message: 'Fase eliminatoria borrada exitosamente.' };
}

module.exports = {
  ordenarZonaParejas,
  generarEliminatoria,
  getFasesEliminatorias,
  borrarEliminatoria,
  esRondaDieciseisavos,
};
