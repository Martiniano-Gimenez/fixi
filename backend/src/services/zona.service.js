const prisma = require('../lib/prisma');
const { getTorneoById } = require('./torneo.service');
const { calcularSolapamientoMinutos } = require('./disponibilidad.service');


// Fisher-Yates shuffle
function shuffleArray(array) {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

/**
 * Función auxiliar para generar partidos de una zona
 */
async function generarPartidosZonaHelper(tx, torneoId, zonaId, formato, size, parejasEnEstaZona) {
  if (formato === 'ROUND_ROBIN') {
    if (size === 2) {
      // 1 partido: P1 vs P2
      await tx.partido.create({
        data: {
          torneoId,
          zonaId,
          pareja1Id: parejasEnEstaZona[0].id,
          pareja2Id: parejasEnEstaZona[1].id,
          posicionEnRonda: 1,
        },
      });
    } else if (size === 3) {
      // 3 partidos: P1vsP2, P1vsP3, P2vsP3
      const enfrentamientos = [[0, 1], [0, 2], [1, 2]];
      for (let k = 0; k < enfrentamientos.length; k++) {
        const [p1Idx, p2Idx] = enfrentamientos[k];
        await tx.partido.create({
          data: {
            torneoId,
            zonaId,
            pareja1Id: parejasEnEstaZona[p1Idx].id,
            pareja2Id: parejasEnEstaZona[p2Idx].id,
            posicionEnRonda: k + 1,
          },
        });
      }
    } else if (size === 4) { // just in case
      const enfrentamientos = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
      for (let k = 0; k < enfrentamientos.length; k++) {
        const [p1Idx, p2Idx] = enfrentamientos[k];
        await tx.partido.create({
          data: {
            torneoId,
            zonaId,
            pareja1Id: parejasEnEstaZona[p1Idx].id,
            pareja2Id: parejasEnEstaZona[p2Idx].id,
            posicionEnRonda: k + 1,
          },
        });
      }
    }
  } else if (formato === 'MINI_BRACKET') {
    // Zonas de 4: Partido 1 (pos 1): P1 vs P2, Partido 2 (pos 2): P3 vs P4
    await tx.partido.create({
      data: {
        torneoId,
        zonaId,
        pareja1Id: parejasEnEstaZona[0].id,
        pareja2Id: parejasEnEstaZona[1].id,
        posicionEnRonda: 1,
      },
    });
    await tx.partido.create({
      data: {
        torneoId,
        zonaId,
        pareja1Id: parejasEnEstaZona[2].id,
        pareja2Id: parejasEnEstaZona[3].id,
        posicionEnRonda: 2,
      },
    });
    // P3 y P4 se crean sin parejas, se llenan cuando terminen P1 y P2
    await tx.partido.create({
      data: { torneoId, zonaId, posicionEnRonda: 3 },
    });
    await tx.partido.create({
      data: { torneoId, zonaId, posicionEnRonda: 4 },
    });
  }
}

/**
 * Lógica de inicio de torneo y generación de zonas
 */
async function iniciarTorneo(organizadorId, torneoId) {
  const torneo = await getTorneoById(organizadorId, torneoId); // verifica permisos y trae torneo

  if (torneo.estado !== 'BORRADOR') {
    const error = new Error('El torneo ya fue iniciado.');
    error.statusCode = 400;
    throw error;
  }

  const parejas = await prisma.pareja.findMany({ where: { torneoId } });
  const numParejas = parejas.length;

  if (numParejas < 2) {
    const error = new Error('Se necesitan al menos 2 parejas para iniciar el torneo.');
    error.statusCode = 400;
    throw error;
  }

  // Mezclar parejas al azar
  const parejasMezcladas = shuffleArray(parejas);

  // Calcular distribución de zonas
  // Base 3. Sobra 1 -> una zona de 4. Sobran 2 -> una zona de 2.
  const zonas3 = Math.floor(numParejas / 3);
  const resto = numParejas % 3;

  let configuracionZonas = Array(zonas3).fill(3);
  if (resto === 1) {
    if (zonas3 > 0) {
      configuracionZonas[0] = 4; // Una de las zonas pasa a ser de 4
    } else {
      // Solo hay 1 pareja, pero validamos que >= 2 arriba.
      // Si llegamos acá es porque había 4 parejas (1 zona de 3, sobra 1 => 1 zona de 4) - wait, Math.floor(4/3)=1, resto=1. configuracionZonas[0]=4.
    }
  } else if (resto === 2) {
    configuracionZonas.push(2); // Agregamos una zona de 2
  }

  // Para nombrar zonas A, B, C...
  const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  // Usar transacción para que todo (Zonas, ParejasZona, Partidos) se cree atómicamente
  await prisma.$transaction(async (tx) => {
    let parejaIndex = 0;

    for (let i = 0; i < configuracionZonas.length; i++) {
      const size = configuracionZonas[i];
      const nombreZona = `Zona ${letras[i] || i}`;
      const formato = size === 4 ? 'MINI_BRACKET' : 'ROUND_ROBIN';
      const clasifican = size === 4 ? 3 : 2;

      // Crear zona
      const zona = await tx.zona.create({
        data: {
          torneoId,
          nombre: nombreZona,
          clasifican,
          formato,
        },
      });

      const parejasEnEstaZona = parejasMezcladas.slice(parejaIndex, parejaIndex + size);
      parejaIndex += size;

      // Crear ZonaPareja (tabla de posiciones)
      for (const p of parejasEnEstaZona) {
        await tx.zonaPareja.create({
          data: {
            zonaId: zona.id,
            parejaId: p.id,
          },
        });
      }

      // Crear Partidos de la zona
      await generarPartidosZonaHelper(tx, torneoId, zona.id, formato, size, parejasEnEstaZona);
    }

    // Actualizar estado del torneo
    await tx.torneo.update({
      where: { id: torneoId },
      data: { estado: 'EN_CURSO' },
    });
  });

  return { message: 'Torneo iniciado y zonas generadas.' };
}

/**
 * Limpia todos los resultados de las zonas (sets, estados de partidos y estadísticas)
 */
async function limpiarResultadosZonas(organizadorId, torneoId) {
  const torneo = await getTorneoById(organizadorId, torneoId);

  await prisma.$transaction(async (tx) => {
    // 1. Obtener partidos de las zonas
    const partidosZonas = await tx.partido.findMany({
      where: { torneoId, zonaId: { not: null } }
    });
    const partidoIds = partidosZonas.map(p => p.id);

    if (partidoIds.length > 0) {
      // 2. Borrar todos los sets
      await tx.setPartido.deleteMany({
        where: { partidoId: { in: partidoIds } }
      });

      // 3. Resetear el estado de TODOS los partidos de zonas
      await tx.partido.updateMany({
        where: { id: { in: partidoIds } },
        data: { estado: 'PENDIENTE', ganadorId: null }
      });

      // 4. Limpiar las parejas SÓLO de los partidos dinámicos (3 y 4) en zonas MINI_BRACKET
      const zonasMiniBracket = await tx.zona.findMany({
        where: { torneoId, formato: 'MINI_BRACKET' }
      });
      if (zonasMiniBracket.length > 0) {
        await tx.partido.updateMany({
          where: { 
            id: { in: partidoIds }, 
            zonaId: { in: zonasMiniBracket.map(z => z.id) },
            posicionEnRonda: { in: [3, 4] } 
          },
          data: { pareja1Id: null, pareja2Id: null, origenPareja1: null, origenPareja2: null }
        });
      }
    }

    // 5. Resetear estadísticas de zonas
    const zonas = await tx.zona.findMany({ where: { torneoId } });
    if (zonas.length > 0) {
      await tx.zonaPareja.updateMany({
        where: { zonaId: { in: zonas.map(z => z.id) } },
        data: {
          pj: 0, pg: 0, pp: 0, sf: 0, sc: 0, gf: 0, gc: 0, puntos: 0
        }
      });
    }

    // 6. Si hay eliminatoria generada, la borramos para evitar inconsistencias
    const faseViejas = await tx.faseEliminatoria.findMany({ where: { torneoId } });
    if (faseViejas.length > 0) {
      await tx.partido.deleteMany({
        where: { faseEliminatoriaId: { in: faseViejas.map(f => f.id) } }
      });
      await tx.faseEliminatoria.deleteMany({ where: { torneoId } });
    }
  });

  return { message: 'Resultados de zonas reseteados.' };
}

/**
 * Reestructura manualmente las zonas del torneo
 * Payload: { zonas: [{ id, nombre, parejas: [id1, id2...] }] }
 */
async function reestructurarZonas(organizadorId, torneoId, zonasPayload) {
  const torneo = await getTorneoById(organizadorId, torneoId);
  
  if (torneo.estado === 'BORRADOR') {
    throw new Error('El torneo está en borrador. Iniciá el torneo primero.');
  }

  await prisma.$transaction(async (tx) => {
    // 1. Verificar si hay eliminatoria y borrarla para evitar inconsistencias severas
    const fases = await tx.faseEliminatoria.findMany({ where: { torneoId } });
    if (fases.length > 0) {
      await tx.partido.deleteMany({
        where: { faseEliminatoriaId: { in: fases.map(f => f.id) } }
      });
      await tx.faseEliminatoria.deleteMany({ where: { torneoId } });
    }

    // 2. Iterar por cada zona que nos llega
    for (const zPayload of zonasPayload) {
      const zona = await tx.zona.findUnique({ where: { id: zPayload.id } });
      if (!zona) continue;

      const size = zPayload.parejas.length;
      if (size < 2) continue; // Una zona vacía o de 1 no debería generarse

      const formato = size === 4 ? 'MINI_BRACKET' : 'ROUND_ROBIN';
      const clasifican = size >= 4 ? 3 : 2;

      // Actualizar formato y clasifican
      await tx.zona.update({
        where: { id: zona.id },
        data: { formato, clasifican }
      });

      // Borrar todos los partidos y sets de la zona actual
      const partidosViejos = await tx.partido.findMany({ where: { zonaId: zona.id } });
      if (partidosViejos.length > 0) {
        await tx.setPartido.deleteMany({ where: { partidoId: { in: partidosViejos.map(p => p.id) } } });
        await tx.partido.deleteMany({ where: { zonaId: zona.id } });
      }

      // Borrar ZonaPareja actual
      await tx.zonaPareja.deleteMany({ where: { zonaId: zona.id } });

      // Insertar nuevos ZonaPareja
      const parejasEnEstaZona = [];
      for (const pId of zPayload.parejas) {
        await tx.zonaPareja.create({
          data: { zonaId: zona.id, parejaId: pId }
        });
        parejasEnEstaZona.push({ id: pId });
      }

      // Volver a generar los partidos usando el helper
      await generarPartidosZonaHelper(tx, torneoId, zona.id, formato, size, parejasEnEstaZona);
    }
  });

  return { message: 'Zonas reestructuradas correctamente.' };
}

// ─── Helpers para disponibilidad ─────────────────────────────────────────────

/**
 * Calcula la distribución de zonas: Array de tamaños (ej. [3,3,4])
 * Misma lógica que el sorteo aleatorio.
 */
function calcularConfigZonas(numParejas) {
  const zonas3 = Math.floor(numParejas / 3);
  const resto = numParejas % 3;
  const config = Array(zonas3).fill(3);
  if (resto === 1 && zonas3 > 0) {
    config[0] = 4;
  } else if (resto === 2) {
    config.push(2);
  }
  return config;
}

/**
 * Arma grupos de parejas maximizando compatibilidad horaria.
 * Estrategia: Fase 1 greedy (más restringida primero), Fase 2 backtracking con límite.
 *
 * @param {Array} parejas — cada una con campo `disponibilidades`
 * @param {number[]} configZonas — array de tamaños de zona
 * @param {number[][]} matriz — matriz[i][j] = minutos de solapamiento entre parejas i y j
 * @returns {{ grupos: number[][], sinGrupo: number[] }}
 *   grupos: arrays de índices de pareja por zona; sinGrupo: índices sin asignar
 */
function armarGruposPorDisponibilidad(parejas, configZonas, matriz) {
  const n = parejas.length;
  const asignado = new Array(n).fill(false);
  const grupos = [];

  // Calcular "grado de compatibilidad" de cada pareja: cuántas otras tiene solapamiento > 0
  const compatibilidad = parejas.map((_, i) => {
    let count = 0;
    for (let j = 0; j < n; j++) {
      if (i !== j && matriz[i][j] > 0) count++;
    }
    return count;
  });

  // ── Fase 1: Greedy ──────────────────────────────────────────────────────────
  // Para cada zona (en el orden dado), intentar armar un grupo válido.
  // "Más restringida primero": ordenar las parejas libres por compatibilidad ASC.
  for (const size of configZonas) {
    const libres = [];
    for (let i = 0; i < n; i++) {
      if (!asignado[i]) libres.push(i);
    }

    // Candidatos ordenados por compatibilidad ASC (más difícil de ubicar primero)
    const candidatos = [...libres].sort((a, b) => compatibilidad[a] - compatibilidad[b]);

    // Intentar armar un grupo de `size` empezando desde el más restringido
    const grupo = intentarArmarGrupo(candidatos, size, asignado, matriz);

    if (grupo !== null) {
      grupo.forEach((idx) => (asignado[idx] = true));
      grupos.push(grupo);
    }
    // Si no encontró grupo, no agrega nada y esas parejas quedarán en sinGrupo
  }

  const sinGrupo = [];
  for (let i = 0; i < n; i++) {
    if (!asignado[i]) sinGrupo.push(i);
  }

  return { grupos, sinGrupo };
}

/**
 * Intenta armar un grupo de tamaño `size` usando backtracking con límite de 5000 iteraciones.
 * Devuelve array de índices o null si no es posible.
 */
function intentarArmarGrupo(candidatos, size, asignado, matriz) {
  const MAX_ITER = 5000;
  let iteraciones = 0;

  // Verificar si un conjunto de índices es completamente compatible entre sí
  function esGrupoValido(grupo) {
    for (let a = 0; a < grupo.length; a++) {
      for (let b = a + 1; b < grupo.length; b++) {
        if (matriz[grupo[a]][grupo[b]] === 0) return false;
      }
    }
    return true;
  }

  function backtrack(inicio, grupoActual) {
    iteraciones++;
    if (iteraciones > MAX_ITER) return null; // límite duro

    if (grupoActual.length === size) {
      return [...grupoActual];
    }

    for (let i = inicio; i < candidatos.length; i++) {
      const idx = candidatos[i];
      if (asignado[idx]) continue;

      // Poda: verificar compatibilidad con todos los ya seleccionados
      let compatible = true;
      for (const prev of grupoActual) {
        if (matriz[idx][prev] === 0) {
          compatible = false;
          break;
        }
      }
      if (!compatible) continue;

      grupoActual.push(idx);
      const resultado = backtrack(i + 1, grupoActual);
      if (resultado !== null) return resultado;
      grupoActual.pop();

      if (iteraciones > MAX_ITER) return null;
    }

    return null;
  }

  // Intentar primero con parejas que tienen más compatibilidad en common (maximize min overlap)
  const candidatosOrdenados = [...candidatos].sort((a, b) => {
    // Score: suma de solapamientos con todos los candidatos
    const scoreA = candidatos.reduce((acc, c) => acc + matriz[a][c], 0);
    const scoreB = candidatos.reduce((acc, c) => acc + matriz[b][c], 0);
    return scoreB - scoreA; // DESC: más compatible primero en backtracking
  });

  return backtrack(0, []);
}

// ─── Función principal: Iniciar torneo por disponibilidad ─────────────────────

/**
 * Inicia el torneo armando zonas por compatibilidad horaria.
 * Las parejas sin compatibilidad quedan en zonas "pendientes manuales".
 */
async function iniciarTorneoConDisponibilidad(organizadorId, torneoId) {
  const torneo = await getTorneoById(organizadorId, torneoId);

  if (torneo.estado !== 'BORRADOR') {
    const error = new Error('El torneo ya fue iniciado.');
    error.statusCode = 400;
    throw error;
  }

  const parejas = await prisma.pareja.findMany({
    where: { torneoId },
    include: { disponibilidades: true },
  });

  const numParejas = parejas.length;

  if (numParejas < 2) {
    const error = new Error('Se necesitan al menos 2 parejas para iniciar el torneo.');
    error.statusCode = 400;
    throw error;
  }

  // Guardia: ninguna pareja tiene disponibilidad cargada
  const conDisponibilidad = parejas.filter((p) => p.disponibilidades.length > 0);
  if (conDisponibilidad.length === 0) {
    const error = new Error(
      'Ninguna pareja tiene disponibilidad horaria cargada. Usá el inicio por sorteo o cargá disponibilidad primero.'
    );
    error.statusCode = 400;
    throw error;
  }

  // Construir matriz de solapamiento N×N
  const n = numParejas;
  const matriz = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const minutos = calcularSolapamientoMinutos(
        parejas[i].disponibilidades,
        parejas[j].disponibilidades
      );
      matriz[i][j] = minutos;
      matriz[j][i] = minutos;
    }
  }

  const configZonas = calcularConfigZonas(numParejas);
  const { grupos, sinGrupo } = armarGruposPorDisponibilidad(parejas, configZonas, matriz);

  const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const resumenZonasCreadas = [];
  const resumenZonasManual = [];

  await prisma.$transaction(async (tx) => {
    let letraIndex = 0;

    // Crear zonas automáticas con grupos válidos
    for (const grupo of grupos) {
      const size = grupo.length;
      const nombreZona = `Zona ${letras[letraIndex] || letraIndex}`;
      const formato = size === 4 ? 'MINI_BRACKET' : 'ROUND_ROBIN';
      const clasifican = size === 4 ? 3 : 2;

      const zona = await tx.zona.create({
        data: { torneoId, nombre: nombreZona, clasifican, formato },
      });

      const parejasEnZona = grupo.map((idx) => parejas[idx]);

      for (const p of parejasEnZona) {
        await tx.zonaPareja.create({ data: { zonaId: zona.id, parejaId: p.id } });
      }

      await generarPartidosZonaHelper(tx, torneoId, zona.id, formato, size, parejasEnZona);

      resumenZonasCreadas.push({
        nombre: nombreZona,
        parejas: parejasEnZona.map((p) => ({ id: p.id, jugador1: p.jugador1, jugador2: p.jugador2 })),
      });

      letraIndex++;
    }

    // Crear zonas placeholder para parejas sin grupo (requieren armado manual)
    if (sinGrupo.length > 0) {
      const nombreZona = `Zona ${letras[letraIndex] || letraIndex}`;
      letraIndex++;

      await tx.zona.create({
        data: {
          torneoId,
          nombre: nombreZona,
          clasifican: 2,
          formato: 'ROUND_ROBIN',
          requiereArmadoManual: true,
        },
      });

      const parejasSinGrupo = sinGrupo.map((idx) => ({
        id: parejas[idx].id,
        jugador1: parejas[idx].jugador1,
        jugador2: parejas[idx].jugador2,
      }));

      resumenZonasManual.push({
        nombre: nombreZona,
        parejas: parejasSinGrupo,
      });
    }

    // Actualizar estado del torneo
    await tx.torneo.update({
      where: { id: torneoId },
      data: { estado: 'EN_CURSO' },
    });
  });

  return {
    message: 'Torneo iniciado por disponibilidad horaria.',
    zonasCreadas: resumenZonasCreadas,
    zonasManual: resumenZonasManual,
    parejasSinDisponibilidad: parejas
      .filter((p) => p.disponibilidades.length === 0)
      .map((p) => ({ id: p.id, jugador1: p.jugador1, jugador2: p.jugador2 })),
  };
}

// ─── Función: Asignación automática de horarios ───────────────────────────────

/**
 * Convierte "HH:MM" a minutos desde medianoche.
 */
function horaAMinutos(hora) {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Convierte minutos desde medianoche a "HH:MM".
 */
function minutosAHora(minutos) {
  const h = Math.floor(minutos / 60).toString().padStart(2, '0');
  const m = (minutos % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Dado un día ("Viernes" | "Sabado"), devuelve la fecha del próximo día de esa semana
 * a partir de hoy. Se usa para construir DateTime de los partidos.
 */
function proximaFechaPorDia(dia) {
  const hoy = new Date();
  const diaSemana = hoy.getDay(); // 0=Dom, 1=Lun, ..., 5=Vie, 6=Sáb
  const targetDia = dia === 'Viernes' ? 5 : 6;
  let diff = targetDia - diaSemana;
  if (diff <= 0) diff += 7;
  const fecha = new Date(hoy);
  fecha.setDate(hoy.getDate() + diff);
  fecha.setHours(0, 0, 0, 0);
  return fecha;
}

/**
 * Calcula el rango horario común entre dos parejas (intersección de franjas por día).
 * Devuelve array de { dia, inicioMin, finMin }.
 */
function calcularRangoComun(franjasA, franjasB) {
  const rangos = [];
  for (const fA of franjasA) {
    for (const fB of franjasB) {
      if (fA.dia !== fB.dia) continue;
      const inicio = Math.max(horaAMinutos(fA.horaInicio), horaAMinutos(fB.horaInicio));
      const fin = Math.min(horaAMinutos(fA.horaFin), horaAMinutos(fB.horaFin));
      if (fin > inicio) {
        rangos.push({ dia: fA.dia, inicioMin: inicio, finMin: fin });
      }
    }
  }
  return rangos;
}

/**
 * Asigna automáticamente horarios y canchas a los partidos de zonas.
 * Ordena partidos por flexibilidad ASC (más restringidos primero).
 * Respeta: cancha libre, pareja sin colisión horaria.
 */
async function asignarHorariosAutomatico(organizadorId, torneoId) {
  const torneo = await getTorneoById(organizadorId, torneoId);

  if (torneo.estado === 'BORRADOR') {
    const error = new Error('El torneo está en borrador. Iniciá el torneo primero.');
    error.statusCode = 400;
    throw error;
  }

  const { cantidadCanchas, duracionPartidoMin } = torneo;

  // Cargar partidos pendientes de zonas con disponibilidades de sus parejas
  const partidos = await prisma.partido.findMany({
    where: {
      torneoId,
      zonaId: { not: null },
      estado: 'PENDIENTE',
      pareja1Id: { not: null },
      pareja2Id: { not: null },
    },
    include: {
      pareja1: { include: { disponibilidades: true } },
      pareja2: { include: { disponibilidades: true } },
    },
  });

  // Calcular rango común para cada partido
  const partidosConRango = partidos.map((p) => {
    const rangos = calcularRangoComun(
      p.pareja1.disponibilidades,
      p.pareja2.disponibilidades
    );
    const totalMinutos = rangos.reduce((acc, r) => acc + (r.finMin - r.inicioMin), 0);
    return { partido: p, rangos, totalMinutos };
  });

  // Ordenar por flexibilidad ASC (menos minutos disponibles = va primero)
  partidosConRango.sort((a, b) => a.totalMinutos - b.totalMinutos);

  // Mapa de ocupación: Map<string, Set<number>>
  // clave = "dia-cancha-inicioMin", valor = true si ocupado
  // Representamos cada partido asignado como { parejaIds: [], dia, inicioMin, finMin }
  const asignaciones = []; // { parejaIds, dia, inicioMin, finMin, cancha }

  const updates = [];

  for (const { partido, rangos } of partidosConRango) {
    if (rangos.length === 0) {
      // Sin solapamiento: marcar directamente
      updates.push({ id: partido.id, sinHorarioAsignado: true, fechaHora: null, canchaNumero: null });
      continue;
    }

    let slotEncontrado = false;

    for (const rango of rangos) {
      if (slotEncontrado) break;

      // Iterar slots dentro del rango
      for (
        let slotInicio = rango.inicioMin;
        slotInicio + duracionPartidoMin <= rango.finMin;
        slotInicio += duracionPartidoMin
      ) {
        const slotFin = slotInicio + duracionPartidoMin;

        // Verificar colisión de parejas con asignaciones previas
        const hayColisionPareja = asignaciones.some(
          (a) =>
            a.dia === rango.dia &&
            (a.parejaIds.includes(partido.pareja1Id) || a.parejaIds.includes(partido.pareja2Id)) &&
            a.inicioMin < slotFin &&
            a.finMin > slotInicio
        );
        if (hayColisionPareja) continue;

        // Buscar cancha libre
        let canchaLibre = null;
        for (let c = 1; c <= cantidadCanchas; c++) {
          const canchaOcupada = asignaciones.some(
            (a) =>
              a.dia === rango.dia &&
              a.cancha === c &&
              a.inicioMin < slotFin &&
              a.finMin > slotInicio
          );
          if (!canchaOcupada) {
            canchaLibre = c;
            break;
          }
        }

        if (canchaLibre !== null) {
          asignaciones.push({
            parejaIds: [partido.pareja1Id, partido.pareja2Id],
            dia: rango.dia,
            inicioMin: slotInicio,
            finMin: slotFin,
            cancha: canchaLibre,
          });

          // Construir DateTime: próxima fecha del día + hora
          const fecha = proximaFechaPorDia(rango.dia);
          const [h, m] = minutosAHora(slotInicio).split(':').map(Number);
          fecha.setHours(h, m, 0, 0);

          updates.push({
            id: partido.id,
            fechaHora: fecha,
            canchaNumero: canchaLibre,
            sinHorarioAsignado: false,
          });

          slotEncontrado = true;
          break;
        }
      }
    }

    if (!slotEncontrado) {
      updates.push({ id: partido.id, sinHorarioAsignado: true, fechaHora: null, canchaNumero: null });
    }
  }

  // Persistir en DB
  await prisma.$transaction(
    updates.map((u) =>
      prisma.partido.update({
        where: { id: u.id },
        data: {
          fechaHora: u.fechaHora,
          canchaNumero: u.canchaNumero,
          sinHorarioAsignado: u.sinHorarioAsignado,
        },
      })
    )
  );

  const asignados = updates.filter((u) => !u.sinHorarioAsignado).length;
  const sinHorario = updates.filter((u) => u.sinHorarioAsignado).length;

  return {
    message: 'Asignación de horarios completada.',
    asignados,
    sinHorario,
    total: updates.length,
  };
}

module.exports = {
  iniciarTorneo,
  limpiarResultadosZonas,
  reestructurarZonas,
  iniciarTorneoConDisponibilidad,
  asignarHorariosAutomatico,
};

