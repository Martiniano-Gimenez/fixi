const prisma = require('../lib/prisma');

/**
 * El número `ronda` representa la cantidad de participantes en esa fase:
 *   ronda=2  → Final (1 partido)
 *   ronda=4  → Semifinal (2 partidos)
 *   ronda=8  → Cuartos de Final (4 partidos)
 *   ronda=16 → Octavos de Final (8 partidos)
 */
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
 * Generar eliminatoria: obtener clasificadas y crear bracket
 * @param {string} organizadorId - ID del organizador (para verificación)
 * @param {string} torneoId - ID del torneo
 */
async function generarEliminatoria(organizadorId, torneoId) {
  // Verificar que el torneo existe y pertenece al organizador
  const torneo = await prisma.torneo.findUnique({
    where: { id: torneoId },
  });

  if (!torneo) {
    const error = new Error('Torneo no encontrado.');
    error.statusCode = 404;
    throw error;
  }

  if (torneo.organizadorId !== organizadorId) {
    const error = new Error('No tenés permisos para este torneo.');
    error.statusCode = 403;
    throw error;
  }

  // 0. Verificar si todos los partidos de las zonas están finalizados
  const partidosPendientes = await prisma.partido.count({
    where: {
      torneoId,
      zonaId: { not: null },
      estado: { not: 'FINALIZADO' },
    },
  });

  const gruposFinalizados = partidosPendientes === 0;

  // 1. Obtener zonas del torneo
  const zonas = await prisma.zona.findMany({
    where: { torneoId },
    orderBy: { nombre: 'asc' },
    include: {
      zonaParejas: {
        orderBy: [
          { puntos: 'desc' },
          { pg: 'desc' },
        ],
        include: { pareja: true },
      },
    },
  });

  if (zonas.length === 0) {
    const error = new Error('El torneo no tiene zonas generadas.');
    error.statusCode = 400;
    throw error;
  }

  // 2. Recolectar y clasificar parejas
  const primeros = [];
  const segundos = [];
  const otros = [];

  zonas.forEach((zona) => {
    const topZona = zona.zonaParejas.slice(0, zona.clasifican);
    
    for (let index = 0; index < zona.clasifican; index++) {
      let parejaId = null;
      let pareja = null;
      
      // Solo asignar las parejas reales si la fase de grupos terminó
      if (gruposFinalizados && topZona[index]) {
        parejaId = topZona[index].parejaId;
        pareja = topZona[index].pareja;
      }

      const p = {
        parejaId,
        pareja,
        zonaOrigen: zona.nombre,
        origenTxt: `${index + 1}° ${zona.nombre}`, // Ej: "1° A"
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
    where: { torneoId },
  });
  
  if (faseViejas.length > 0) {
    // Armar diccionario de clasificadas para búsqueda rápida
    const clasificadasMap = new Map();
    clasificadas.forEach(c => clasificadasMap.set(c.origenTxt, c));

    // Obtener la ronda más alta (la primera ronda del torneo)
    const primeraRondaNum = Math.max(...faseViejas.map(f => f.ronda));
    const fasePrimeraRonda = faseViejas.find(f => f.ronda === primeraRondaNum);
    
    // Obtener los partidos de esa primera ronda
    const partidosPrimeraRonda = await prisma.partido.findMany({ 
      where: { faseEliminatoriaId: fasePrimeraRonda.id } 
    });

    // Actualizar las parejas basándonos en los orígenes definidos en la estructura
    for (const partido of partidosPrimeraRonda) {
      const updateData = {};
      
      if (partido.origenPareja1) {
        const c1 = clasificadasMap.get(partido.origenPareja1);
        if (c1) updateData.pareja1Id = c1.parejaId;
      }
      
      if (partido.origenPareja2) {
        const c2 = clasificadasMap.get(partido.origenPareja2);
        if (c2) updateData.pareja2Id = c2.parejaId;
      }
      
      if (Object.keys(updateData).length > 0) {
        await prisma.partido.update({ 
          where: { id: partido.id }, 
          data: updateData 
        });
      }
    }

    return { message: 'Clasificados asignados al bracket exitosamente.' };
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
        torneoId,
        nombre: nombreRonda(ronda),
        ronda,
      },
    });
    fases[ronda] = fase.id;
  }

  // 5. Lógica de Seeding Dinámico
  const M = potencia / 2; // Cantidad de partidos en primera ronda

  // Función para generar la secuencia estándar de partidos (ej: 1, 8, 5, 4, 3, 6, 7, 2 para M=8)
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

  // 5.3. Ubicar a los 2dos (y 3ros si los hay)
  const restoClasificados = [...segundos, ...otros];
  for (let i = 0; i < restoClasificados.length; i++) {
    const equipo = restoClasificados[i];
    
    // El "compañero de cluster" ideal (ej. el 2B va al lugar complementario del 1B)
    const idealSeqIdx = i ^ 1; 
    let placed = false;

    if (idealSeqIdx < M) {
      const idealMatchIdx = seq[idealSeqIdx] - 1;
      if (matchSlots[idealMatchIdx].p2 === null) {
        matchSlots[idealMatchIdx].p2 = equipo;
        placed = true;
      }
    }

    // Fallback: Buscar en la mitad opuesta del 1ro correspondiente
    if (!placed) {
      const firstMatchIdx = i < seq.length ? seq[i] - 1 : 0;
      const isFirstTopHalf = firstMatchIdx < M / 2;

      // Orden de búsqueda en la mitad opuesta según secuencia de seeds
      const searchIndices = [];
      for (let k = 0; k < M; k++) {
        const idx = seq[k] - 1;
        const isIdxTopHalf = idx < M / 2;
        if (isIdxTopHalf !== isFirstTopHalf) {
          searchIndices.push(idx);
        }
      }

      // Pass 1: Completar un partido que tenga p1 pero no p2
      for (const idx of searchIndices) {
        if (matchSlots[idx].p1 !== null && matchSlots[idx].p2 === null) {
          matchSlots[idx].p2 = equipo;
          placed = true;
          break;
        }
      }

      // Pass 2: Ocupar un partido vacío
      if (!placed) {
        for (const idx of searchIndices) {
          if (matchSlots[idx].p1 === null) {
            matchSlots[idx].p1 = equipo;
            placed = true;
            break;
          }
        }
      }

      // Pass 3: Safety net (cualquier hueco)
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
  const partidosPrimeraRonda = [];

  for (let i = 0; i < M; i++) {
    const slot = matchSlots[i];
    const p1 = slot.p1?.isBye ? null : slot.p1;
    const p2 = slot.p2?.isBye ? null : slot.p2;
    
    // Si uno de los dos es BYE, el otro pasa directo (estado FINALIZADO, ganador asignado)
    const isBye = slot.p1?.isBye || slot.p2?.isBye;
    let estado = 'PENDIENTE';
    let ganadorId = null;

    if (isBye) {
      estado = 'FINALIZADO';
      if (p1) ganadorId = p1.parejaId;
      if (p2) ganadorId = p2.parejaId;
    }

    const partido = await prisma.partido.create({
      data: {
        torneoId,
        faseEliminatoriaId: fases[primeraRonda],
        posicionEnRonda: i + 1,
        pareja1Id: p1?.parejaId || null,
        origenPareja1: p1?.origenTxt || null,
        pareja2Id: p2?.parejaId || null,
        origenPareja2: p2?.origenTxt || null,
        ganadorId,
        estado,
      },
    });

    partidosPrimeraRonda.push(partido);
  }

  // 7. Crear Partidos vacíos para rondas posteriores
  for (let i = 1; i < rondas.length; i++) {
    const r = rondas[i];
    const cantPartidosEnRonda = Math.floor(r / 2);

    for (let j = 0; j < cantPartidosEnRonda; j++) {
      await prisma.partido.create({
        data: {
          torneoId,
          faseEliminatoriaId: fases[r],
          posicionEnRonda: j + 1,
          pareja1Id: null,
          pareja2Id: null,
          estado: 'PENDIENTE',
        },
      });
    }
  }

  // 8. Propagar ganadores de BYEs a la siguiente ronda
  for (const partido of partidosPrimeraRonda) {
    if (partido.estado === 'FINALIZADO' && partido.ganadorId) {
      const { propagarEliminatoria } = require('./partido.service');
      await propagarEliminatoria(partido, partido.ganadorId);
    }
  }

  return {
    totalParejas,
    potencia,
    rondas,
    fases,
  };
}

/**
 * Obtener fases eliminatorias y sus partidos
 * @param {string} organizadorId - ID del organizador (para verificación)
 * @param {string} torneoId - ID del torneo
 */
async function getFasesEliminatorias(organizadorId, torneoId) {
  // Verificar que el torneo existe y pertenece al organizador
  const torneo = await prisma.torneo.findUnique({
    where: { id: torneoId },
  });

  if (!torneo) {
    const error = new Error('Torneo no encontrado.');
    error.statusCode = 404;
    throw error;
  }

  if (torneo.organizadorId !== organizadorId) {
    const error = new Error('No tenés permisos para este torneo.');
    error.statusCode = 403;
    throw error;
  }

  // Obtener fases con sus partidos
  const fases = await prisma.faseEliminatoria.findMany({
    where: { torneoId },
    orderBy: { ronda: 'desc' }, // De mayor a menor (octavos, cuartos, semis, final)
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

  return fases;
}

/**
 * Borra toda la fase eliminatoria de un torneo.
 */
async function borrarEliminatoria(organizadorId, torneoId) {
  const torneo = await prisma.torneo.findUnique({ where: { id: torneoId } });
  
  if (!torneo) {
    const error = new Error('Torneo no encontrado.');
    error.statusCode = 404;
    throw error;
  }
  
  if (torneo.organizadorId !== organizadorId) {
    const error = new Error('No tenés permisos sobre este torneo.');
    error.statusCode = 403;
    throw error;
  }

  await prisma.$transaction(async (tx) => {
    // Borrar todos los partidos que pertenecen a una fase eliminatoria de este torneo
    await tx.partido.deleteMany({
      where: {
        torneoId,
        faseEliminatoriaId: { not: null },
      },
    });

    // Borrar las fases
    await tx.faseEliminatoria.deleteMany({
      where: { torneoId },
    });
  });

  return { message: 'Fase eliminatoria borrada exitosamente.' };
}

module.exports = {
  generarEliminatoria,
  getFasesEliminatorias,
  borrarEliminatoria,
};
