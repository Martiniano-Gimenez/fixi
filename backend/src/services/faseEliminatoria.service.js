const prisma = require('../lib/prisma');
const { getCategoriaById } = require('./categoria.service');
const { DURACION_PARTIDO_MIN } = require('./slots.service');
const {
  calcularFinDeZonasCategoria,
  calcularDescansosEliminatoria,
  indexarPartidosEliminatoria,
  resolverPadresEHijoEliminatoria,
} = require('../utils/bracketWarnings');

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
 * @param {object|null} [externalTx] - Transacción externa opcional
 */
async function generarEliminatoria(organizadorId, categoriaId, externalTx = null) {
  const db = externalTx || prisma;
  await getCategoriaById(organizadorId, categoriaId, externalTx);

  // 0. Verificar si todos los partidos de las zonas están finalizados
  const partidosPendientes = await db.partido.count({
    where: {
      categoriaId,
      zonaId: { not: null },
      estado: { not: 'FINALIZADO' },
    },
  });

  const gruposFinalizados = partidosPendientes === 0;

  // 1. Obtener zonas de la categoría
  const zonas = await db.zona.findMany({
    where: { categoriaId },
    orderBy: { nombre: 'asc' },
    include: {
      zonaParejas: {
        include: { pareja: true },
      },
      partidos: {
        select: { estado: true },
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
    
    // Una zona individual está finalizada si tiene partidos y todos están FINALIZADO
    const zonaFinalizada = Array.isArray(zona.partidos) && zona.partidos.length > 0 && zona.partidos.every((p) => p.estado === 'FINALIZADO');

    for (let index = 0; index < zona.clasifican; index++) {
      let parejaId = null;
      let pareja = null;
      
      if ((gruposFinalizados || zonaFinalizada) && topZona[index]) {
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
  const faseViejas = await db.faseEliminatoria.findMany({
    where: { categoriaId },
  });
  
  if (faseViejas.length > 0) {
    const clasificadasMap = new Map();
    clasificadas.forEach(c => clasificadasMap.set(c.origenTxt, c));

    const primeraRondaNum = Math.max(...faseViejas.map(f => f.ronda));
    const fasePrimeraRonda = faseViejas.find(f => f.ronda === primeraRondaNum);
    const esDieciseisavos = primeraRondaNum >= 32;
    
    const partidosPrimeraRonda = await db.partido.findMany({ 
      where: { faseEliminatoriaId: fasePrimeraRonda.id },
      orderBy: { posicionEnRonda: 'asc' },
    });

    for (const partido of partidosPrimeraRonda) {
      const updateData = {};
      
      // Detectar BYE: usar el campo persistente esBye del partido
      const esBye = Boolean(partido.esBye);

      if (esDieciseisavos && partido.estado !== 'FINALIZADO' && !esBye) {
        updateData.sinHorarioAsignado = true;
      } else if (esBye) {
        updateData.sinHorarioAsignado = false;
        updateData.fechaHora = null;
        updateData.canchaNumero = null;
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
        await db.partido.update({ 
          where: { id: partido.id }, 
          data: updateData 
        });

        // Propagar ganador de BYE a la siguiente ronda
        if (updateData.ganadorId) {
          const { propagarEliminatoria } = require('./partido.service');
          const updatedPartido = { ...partido, ...updateData };
          await propagarEliminatoria(updatedPartido, updateData.ganadorId, db);
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
    const fase = await db.faseEliminatoria.create({
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

    if (isBye && (gruposFinalizados || (p1?.parejaId || p2?.parejaId))) {
      estado = 'FINALIZADO';
      if (p1?.parejaId) ganadorId = p1.parejaId;
      if (p2?.parejaId) ganadorId = p2.parejaId;
    }

    const partido = await db.partido.create({
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
        esBye: isBye,
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
      const p = await db.partido.create({
        data: {
          categoriaId,
          faseEliminatoriaId: fases[r],
          posicionEnRonda: j + 1,
          pareja1Id: null,
          pareja2Id: null,
          estado: 'PENDIENTE',
          esBye: false,
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

    await db.partido.update({
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

  const fases = await prisma.faseEliminatoria.findMany({
    where: { categoriaId },
    orderBy: { ronda: 'desc' },
    include: {
      partidos: {
        orderBy: { posicionEnRonda: 'asc' },
        include: {
          categoria: { select: { id: true, nombre: true } },
          faseEliminatoria: { select: { id: true, nombre: true, ronda: true } },
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
      },
    },
  });

  if (!fases || fases.length === 0) return fases;

  function nombreCortoRonda(ronda, nombreOriginal) {
    if (ronda === 32) return 'Dieciseisavos';
    if (ronda === 16) return 'Octavos';
    if (ronda === 8) return 'Cuartos';
    if (ronda === 4) return 'Semifinal';
    if (ronda === 2) return 'Final';
    if (nombreOriginal) {
      return nombreOriginal.replace(/\s+de\s+Final$/i, '').trim();
    }
    return `Ronda de ${ronda}`;
  }

  // 1. Identificar BYEs en la primera ronda (usando campo persistente esBye)
  if (fases[0] && Array.isArray(fases[0].partidos)) {
    for (const p of fases[0].partidos) {
      if (p.esBye) {
        // Los BYE no se juegan, no reciben horario ni se cuentan como "Sin horario"
        p.sinHorarioAsignado = false;
      }
    }
  }

  // 2. Proyectar origen/pareja en las rondas siguientes:
  // - Si viene de un BYE: avanza la pareja clasificada o el origen directo ("1° Zona A")
  // - Si viene de cruce pendiente: placeholder explícito ("Ganador Dieciseisavos #2", "Ganador Octavos #1", etc.)
  for (let idx = 1; idx < fases.length; idx++) {
    const fase = fases[idx];
    const fasePrevia = fases[idx - 1];
    const nombrePrevia = nombreCortoRonda(fasePrevia.ronda, fasePrevia.nombre);
    const prevMap = new Map(fasePrevia.partidos.map((p) => [p.posicionEnRonda, p]));

    for (const p of fase.partidos) {
      p.esBye = false;

      // Slot 1 viene del partido (2 * pos - 1) de la ronda previa
      const posPrev1 = 2 * p.posicionEnRonda - 1;
      const prev1 = prevMap.get(posPrev1);
      if (prev1 && prev1.esBye) {
        const parejaAvance = prev1.pareja1 || prev1.pareja2 || prev1.displayPareja1 || null;
        const origenAvance = prev1.origenPareja1 || prev1.origenPareja2 || prev1.displayOrigenPareja1 || null;
        p.displayOrigenPareja1 = origenAvance;
        if (parejaAvance) {
          p.displayPareja1 = parejaAvance;
        }
      } else if (!p.pareja1 && !p.displayPareja1) {
        p.displayOrigenPareja1 = `Ganador ${nombrePrevia} #${posPrev1}`;
      }

      // Slot 2 viene del partido (2 * pos) de la ronda previa
      const posPrev2 = 2 * p.posicionEnRonda;
      const prev2 = prevMap.get(posPrev2);
      if (prev2 && prev2.esBye) {
        const parejaAvance = prev2.pareja1 || prev2.pareja2 || prev2.displayPareja2 || null;
        const origenAvance = prev2.origenPareja1 || prev2.origenPareja2 || prev2.displayOrigenPareja2 || null;
        p.displayOrigenPareja2 = origenAvance;
        if (parejaAvance) {
          p.displayPareja2 = parejaAvance;
        }
      } else if (!p.pareja2 && !p.displayPareja2) {
        p.displayOrigenPareja2 = `Ganador ${nombrePrevia} #${posPrev2}`;
      }
    }
  }

  // 3. Calcular advertencias no bloqueantes en lote para cruces con horario manual
  const hayPartidosManualesConHorario = fases.some((f) =>
    f.partidos?.some((p) => p.horarioManual && p.fechaHora)
  );

  if (hayPartidosManualesConHorario) {
    const zonasCategoria = await prisma.zona.findMany({
      where: { categoriaId },
      select: {
        id: true,
        partidos: {
          select: {
            id: true,
            zonaId: true,
            fechaHora: true,
            sinHorarioAsignado: true,
          },
        },
      },
    });

    const zonasIds = zonasCategoria.map((z) => z.id);
    const totalZonas = zonasCategoria.length;
    const partidosZona = zonasCategoria.flatMap((z) => z.partidos || []);

    const finZonas = calcularFinDeZonasCategoria({
      partidosZona,
      totalZonas,
      zonasIds,
      duracionMs: DURACION_PARTIDO_MIN * 60 * 1000,
    });

    const todosPartidosEliminatoria = fases.flatMap((f) => f.partidos || []);
    const eliminatoriasMap = indexarPartidosEliminatoria(todosPartidosEliminatoria);

    for (const p of todosPartidosEliminatoria) {
      if (p.horarioManual && p.fechaHora) {
        const { padres, hijo } = resolverPadresEHijoEliminatoria({
          partido: p,
          eliminatoriasMap,
        });

        const resultado = calcularDescansosEliminatoria({
          partido: p,
          fechaHoraPropuesta: p.fechaHora,
          padres,
          hijo,
          finZonas,
          duracionMs: DURACION_PARTIDO_MIN * 60 * 1000,
        });

        p.advertencias = resultado.advertencias;
      }
    }
  }

  return fases;
}

async function borrarEliminatoria(organizadorId, categoriaId, externalTx = null) {
  await getCategoriaById(organizadorId, categoriaId, externalTx);
  const db = externalTx || prisma;

  const performDelete = async (tx) => {
    await tx.partido.deleteMany({
      where: {
        categoriaId,
        faseEliminatoriaId: { not: null },
      },
    });

    await tx.faseEliminatoria.deleteMany({
      where: { categoriaId },
    });
  };

  if (externalTx) {
    await performDelete(externalTx);
  } else {
    await prisma.$transaction(async (tx) => {
      await performDelete(tx);
    });
  }

  return { message: 'Fase eliminatoria borrada exitosamente.' };
}

function simularSincronizacionHelper(
  primeraFase,
  partidosElimActuales,
  lugaresEnPrimeraRonda,
  totalClasificadosEsperados,
  potenciaEsperada
) {
  const tamanoActual = primeraFase ? primeraFase.ronda : 0;
  const tamanoNuevo = potenciaEsperada;

  const rondaActual = tamanoActual ? nombreRonda(tamanoActual) : 'Sin cuadro';
  const rondaNueva = nombreRonda(tamanoNuevo);

  const byesActuales = tamanoActual ? Math.max(0, tamanoActual - lugaresEnPrimeraRonda) : 0;
  const byesNuevos = Math.max(0, tamanoNuevo - totalClasificadosEsperados);

  const partidosActuales = partidosElimActuales.length;
  const partidosNuevos = tamanoNuevo > 1 ? tamanoNuevo - 1 : 0;

  const horariosQueCambian = partidosElimActuales.filter((p) => p.fechaHora !== null).length;

  return {
    tamanoActual,
    tamanoNuevo,
    rondaActual,
    rondaNueva,
    rondasTexto: `${rondaActual} → ${rondaNueva}`,
    totalClasificadosActual: lugaresEnPrimeraRonda,
    totalClasificadosNuevo: totalClasificadosEsperados,
    byesActuales,
    byesNuevos,
    partidosActuales,
    partidosNuevos,
    partidosAEliminar: partidosActuales,
    partidosACrear: partidosNuevos,
    horariosQueCambian,
  };
}

/**
 * Evalúa el estado del cuadro eliminatorio con respecto a los clasificados esperados por las zonas.
 * @param {string} categoriaId - ID de la categoría
 * @param {object|null} [externalTx] - Transacción externa opcional
 */
async function estadoCuadro(categoriaId, externalTx = null) {
  const db = externalTx || prisma;

  const zonas = await db.zona.findMany({
    where: { categoriaId },
    orderBy: { nombre: 'asc' },
    include: {
      zonaParejas: true,
      partidos: { select: { estado: true } },
    },
  });

  const totalClasificadosEsperados = zonas.reduce((acc, z) => acc + (z.clasifican || 0), 0);

  const fases = await db.faseEliminatoria.findMany({
    where: { categoriaId },
    orderBy: { ronda: 'desc' },
    include: {
      partidos: {
        orderBy: { posicionEnRonda: 'asc' },
      },
    },
  });

  const partidosElim = fases.flatMap((f) => f.partidos);
  const huboJuegoEliminatoria = partidosElim.some((p) => p.estado !== 'PENDIENTE');

  let lugaresEnPrimeraRonda = 0;
  const placeholdersActuales = new Set();
  const primeraFase = fases[0] || null;

  if (primeraFase && primeraFase.partidos) {
    for (const p of primeraFase.partidos) {
      if (p.origenPareja1 || p.pareja1Id) {
        lugaresEnPrimeraRonda++;
        if (p.origenPareja1) placeholdersActuales.add(p.origenPareja1);
      }
      if (p.origenPareja2 || p.pareja2Id) {
        lugaresEnPrimeraRonda++;
        if (p.origenPareja2) placeholdersActuales.add(p.origenPareja2);
      }
    }
  }

  const potencias = [2, 4, 8, 16, 32, 64];
  let potenciaEsperada = 2;
  for (const p of potencias) {
    if (p >= totalClasificadosEsperados) {
      potenciaEsperada = p;
      break;
    }
  }

  const rondaActual = primeraFase ? primeraFase.ronda : 0;
  const tamanoNoCoincide = rondaActual !== potenciaEsperada;

  let faltanPlaceholders = false;
  for (const z of zonas) {
    for (let k = 1; k <= z.clasifican; k++) {
      const orig = `${k}° ${z.nombre}`;
      if (!placeholdersActuales.has(orig)) {
        faltanPlaceholders = true;
        break;
      }
    }
    if (faltanPlaceholders) break;
  }

  const desactualizado = fases.length === 0
    ? totalClasificadosEsperados > 0
    : (tamanoNoCoincide || faltanPlaceholders || lugaresEnPrimeraRonda !== totalClasificadosEsperados);

  const puedeSincronizar = Boolean(desactualizado && !huboJuegoEliminatoria);

  const simulacion = simularSincronizacionHelper(
    primeraFase,
    partidosElim,
    lugaresEnPrimeraRonda,
    totalClasificadosEsperados,
    potenciaEsperada
  );

  return {
    totalClasificadosEsperados,
    lugaresEnPrimeraRonda,
    desactualizado,
    huboJuegoEliminatoria,
    puedeSincronizar,
    simulacion,
  };
}

/**
 * Sincroniza el cuadro eliminatorio cuando cambiaron los clasificados de las zonas.
 * @param {string} organizadorId
 * @param {string} categoriaId
 * @param {object} [options]
 * @param {boolean} [options.simular]
 */
async function sincronizarCuadro(organizadorId, categoriaId, { simular = false } = {}) {
  const categoria = await getCategoriaById(organizadorId, categoriaId);
  const torneo = await prisma.torneo.findUnique({
    where: { id: categoria.torneoId },
  });

  if (!torneo || torneo.estado !== 'EN_CURSO' || categoria.estado !== 'EN_CURSO') {
    const error = new Error('El torneo y la categoría deben estar en estado EN_CURSO para sincronizar el cuadro.');
    error.statusCode = 400;
    throw error;
  }

  // Si es simulación, devolver sin alterar la base de datos
  if (simular) {
    const estado = await estadoCuadro(categoriaId);
    return {
      simulacion: true,
      ...estado.simulacion,
    };
  }

  // Validar si ya hay partidos eliminatorios jugados
  const partidosJugados = await prisma.partido.count({
    where: {
      categoriaId,
      faseEliminatoriaId: { not: null },
      estado: { not: 'PENDIENTE' },
    },
  });

  if (partidosJugados > 0) {
    const error = new Error('No se puede sincronizar el cuadro porque ya hay partidos eliminatorios jugados.');
    error.statusCode = 400;
    throw error;
  }

  let resultadoGenerar = null;
  let schedulingResult = null;

  await prisma.$transaction(async (tx) => {
    const partidosJugadosTx = await tx.partido.count({
      where: {
        categoriaId,
        faseEliminatoriaId: { not: null },
        estado: { not: 'PENDIENTE' },
      },
    });
    if (partidosJugadosTx > 0) {
      const error = new Error('No se puede sincronizar el cuadro porque ya hay partidos eliminatorios jugados.');
      error.statusCode = 400;
      throw error;
    }

    // 1. Borrar eliminatorias existentes
    await borrarEliminatoria(organizadorId, categoriaId, tx);

    // 2. Generar eliminatorias nuevas
    resultadoGenerar = await generarEliminatoria(organizadorId, categoriaId, tx);

    // 3. Programar horarios de eliminatorias
    const { programarHorariosEliminatorias } = require('./eliminatoriaScheduler.service');
    try {
      schedulingResult = await programarHorariosEliminatorias(organizadorId, categoria.torneoId, categoriaId, tx);
    } catch (errSched) {
      console.warn(`[sincronizarCuadro] Aviso al programar horarios de eliminatorias:`, errSched.message);
      schedulingResult = {
        error: errSched.message,
        partidosAgendados: 0,
        partidosSinHorario: 0,
      };
    }
  }, {
    maxWait: 10000,
    timeout: 30000,
  });

  return {
    message: 'Cuadro eliminatorio sincronizado exitosamente.',
    categoriaId,
    primeraRonda: resultadoGenerar?.primeraRonda,
    totalParejas: resultadoGenerar?.totalParejas,
    potencia: resultadoGenerar?.potencia,
    schedulingResult,
  };
}

module.exports = {
  ordenarZonaParejas,
  generarEliminatoria,
  getFasesEliminatorias,
  borrarEliminatoria,
  esRondaDieciseisavos,
  estadoCuadro,
  sincronizarCuadro,
};
