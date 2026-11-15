const prisma = require('../lib/prisma');
const { getCategoriaById, recalcularEstadosPorPartido } = require('./categoria.service');
const { conReintentoOrden } = require('../utils/reintentoOrden');
const {
  calcularCompatibilidad,
  horaAMinutos,
  DURACION_PARTIDO_MIN,
  minutosCronologicosJornada,
  compararSlotsCronologicamente,
  ordenarSlotsCronologicamente,
  getSlotsValidosSet,
} = require('./slots.service');
const { parseFechaLocal, requireTorneoFecha, getDiaCalendarioConTrasnoche } = require('../utils/dateUtils');
const canchasOverridesService = require('./canchasOverrides.service');
const { calcularVentanaSabadoNoche } = require('../utils/ventanaSabadoNoche');
const { minutosDespuesDelCierre, calcularFinJornadaMs } = require('../utils/horarioClub');

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
async function generarPartidosZonaHelper(tx, categoriaId, zonaId, formato, size, parejasEnEstaZona, { sinHorarioAsignado = false } = {}) {
  const extraData = sinHorarioAsignado ? { sinHorarioAsignado: true } : {};

  if (formato === 'ROUND_ROBIN') {
    if (size === 2) {
      await tx.partido.create({
        data: {
          categoriaId,
          zonaId,
          pareja1Id: parejasEnEstaZona[0].id,
          pareja2Id: parejasEnEstaZona[1].id,
          posicionEnRonda: 1,
          ...extraData,
        },
      });
    } else if (size === 3) {
      const enfrentamientos = [[0, 1], [0, 2], [1, 2]];
      for (let k = 0; k < enfrentamientos.length; k++) {
        const [p1Idx, p2Idx] = enfrentamientos[k];
        await tx.partido.create({
          data: {
            categoriaId,
            zonaId,
            pareja1Id: parejasEnEstaZona[p1Idx].id,
            pareja2Id: parejasEnEstaZona[p2Idx].id,
            posicionEnRonda: k + 1,
            ...extraData,
          },
        });
      }
    } else if (size === 4) {
      const enfrentamientos = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
      for (let k = 0; k < enfrentamientos.length; k++) {
        const [p1Idx, p2Idx] = enfrentamientos[k];
        await tx.partido.create({
          data: {
            categoriaId,
            zonaId,
            pareja1Id: parejasEnEstaZona[p1Idx].id,
            pareja2Id: parejasEnEstaZona[p2Idx].id,
            posicionEnRonda: k + 1,
            ...extraData,
          },
        });
      }
    }
  } else if (formato === 'MINI_BRACKET') {
    await tx.partido.create({
      data: {
        categoriaId,
        zonaId,
        pareja1Id: parejasEnEstaZona[0].id,
        pareja2Id: parejasEnEstaZona[1].id,
        posicionEnRonda: 1,
        ...extraData,
      },
    });
    await tx.partido.create({
      data: {
        categoriaId,
        zonaId,
        pareja1Id: parejasEnEstaZona[2].id,
        pareja2Id: parejasEnEstaZona[3].id,
        posicionEnRonda: 2,
        ...extraData,
      },
    });
    await tx.partido.create({
      data: {
        categoriaId,
        zonaId,
        posicionEnRonda: 3,
        origenPareja1: 'Ganador Partido 1',
        origenPareja2: 'Ganador Partido 2',
        ...extraData,
      },
    });
    await tx.partido.create({
      data: {
        categoriaId,
        zonaId,
        posicionEnRonda: 4,
        origenPareja1: 'Perdedor Partido 1',
        origenPareja2: 'Perdedor Partido 2',
        ...extraData,
      },
    });
  }
}

/**
 * Lógica de inicio de categoría y generación de zonas (Sorteo aleatorio)
 */
async function iniciarCategoria(organizadorId, categoriaId, externalTx = null) {
  const db = externalTx || prisma;
  const categoria = await getCategoriaById(organizadorId, categoriaId, db);

  if (categoria.estado !== 'BORRADOR') {
    const error = new Error('La categoría ya fue iniciada.');
    error.statusCode = 400;
    throw error;
  }

  // Orden explícito (sesión 81): es la entrada de shuffleArray; sin orderBy salía en orden de inserción
  const parejas = await db.pareja.findMany({ where: { categoriaId }, orderBy: [{ orden: 'asc' }, { id: 'asc' }] });
  const numParejas = parejas.length;

  if (numParejas < 2) {
    const error = new Error('Se necesitan al menos 2 parejas para iniciar la categoría.');
    error.statusCode = 400;
    throw error;
  }

  const parejasMezcladas = shuffleArray(parejas);
  const configuracionZonas = calcularConfigZonas(numParejas);

  const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  const runOperation = async (tx) => {
    let parejaIndex = 0;

    for (let i = 0; i < configuracionZonas.length; i++) {
      const size = configuracionZonas[i];
      const nombreZona = `Zona ${letras[i] || i}`;
      const formato = size === 4 ? 'MINI_BRACKET' : 'ROUND_ROBIN';
      const clasifican = size === 4 ? 3 : 2;

      const zona = await tx.zona.create({
        data: {
          categoriaId,
          nombre: nombreZona,
          clasifican,
          formato,
        },
      });

      const parejasEnEstaZona = parejasMezcladas.slice(parejaIndex, parejaIndex + size);
      parejaIndex += size;

      for (const p of parejasEnEstaZona) {
        await tx.zonaPareja.create({
          data: {
            zonaId: zona.id,
            parejaId: p.id,
          },
        });
      }

      await generarPartidosZonaHelper(tx, categoriaId, zona.id, formato, size, parejasEnEstaZona);
    }

    await tx.categoria.update({
      where: { id: categoriaId },
      data: { estado: 'EN_CURSO' },
    });
    await recalcularEstadosPorPartido(tx, categoriaId);
  };

  if (externalTx) {
    await runOperation(externalTx);
  } else {
    await prisma.$transaction(runOperation);
  }

  return { message: 'Categoría iniciada y zonas generadas.' };
}

/**
 * Calcula distribución de zonas: ej. [3,3,4] o [3,3,2]
 */
function calcularConfigZonas(numParejas) {
  const zonas3 = Math.floor(numParejas / 3);
  const resto = numParejas % 3;

  let configuracionZonas = Array(zonas3).fill(3);
  if (resto === 1) {
    if (zonas3 > 0) {
      configuracionZonas[0] = 4;
    }
  } else if (resto === 2) {
    configuracionZonas.push(2);
  }
  return configuracionZonas;
}

/**
 * Matriz de compatibilidad del armado: cantidad de inicios (slotId) en común entre cada par de parejas.
 * Una pareja sin disponibilidad cargada (0 slots) es compatible con todas, igual que en
 * evaluarCompatibilidadZona y en el scheduler. Se marca con 1 porque el armado solo mira si el valor es > 0.
 * @param {string[][]} slotsPorPareja slotIds de cada pareja, en el orden de las parejas
 * @returns {number[][]}
 */
function construirMatrizCompatibilidad(slotsPorPareja) {
  const n = slotsPorPareja.length;
  const matriz = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    const slotsA = slotsPorPareja[i];
    for (let j = i + 1; j < n; j++) {
      const slotsB = slotsPorPareja[j];
      const compat = slotsA.length === 0 || slotsB.length === 0 ? 1 : calcularCompatibilidad(slotsA, slotsB);
      matriz[i][j] = compat;
      matriz[j][i] = compat;
    }
  }
  return matriz;
}

// Tope de nodos de la búsqueda exacta que repara el armado (ver repararArmadoExacto).
const MAX_ITER_REPARACION = 100000;

/**
 * Búsqueda exacta, con vuelta atrás entre zonas, de un armado con los mismos tamaños de configZonas que deje
 * MENOS de `sinGrupoActual` parejas sin zona (y, a igual cantidad, menos zonas que no son de 3).
 * Recorre las parejas en `orden` (el de los candidatos del armado voraz): la primera pareja libre va en una
 * zona de 3, de 4 o de 2 con parejas libres compatibles con todas, o queda sin zona. Poda con una cota:
 * parejas que ya no entran en ninguna zona de las que quedan, y la mayor suma de tamaños que queda por cubrir.
 * Es determinista y cuenta nodos; al pasar `maxIter` corta y devuelve lo mejor que encontró.
 * @returns {{ zonas: number[][] | null, iteraciones: number, llegoAlTope: boolean }}
 *   zonas: índices de las parejas de cada zona (la primera es la de menor posición en `orden`), o null si no
 *   encontró nada estrictamente mejor que `sinGrupoActual`.
 */
function repararArmadoExacto(orden, configZonas, matriz, sinGrupoActual, maxIter) {
  const n = orden.length;
  const quedan = { 2: 0, 3: 0, 4: 0 };
  for (const s of configZonas) quedan[s]++;
  const usado = Array.from({ length: n }, () => false);
  const zonas = [];
  let sin = 0;
  let no3 = 0;
  let iteraciones = 0;
  let llegoAlTope = false;
  let terminado = false;
  let mejor = null;
  let mejorSin = sinGrupoActual;
  let mejorNo3 = Infinity;

  // Mayor suma de tamaños de las zonas que quedan que no pase de `limite`.
  function maxCubrible(limite) {
    let best = 0;
    for (let a = 0; a <= quedan[2]; a++) {
      for (let c = 0; c <= quedan[4]; c++) {
        const resto = limite - 2 * a - 4 * c;
        if (resto < 0) continue;
        const b = Math.min(quedan[3], Math.floor(resto / 3));
        best = Math.max(best, 2 * a + 3 * b + 4 * c);
      }
    }
    return best;
  }

  // Condición necesaria para que la pareja libre i entre en alguna de las zonas que quedan.
  function puedeEntrar(i) {
    const vec = [];
    for (let j = 0; j < n; j++) if (j !== i && !usado[j] && matriz[i][j] > 0) vec.push(j);
    if (vec.length === 0) return false;
    if (quedan[2] > 0) return true;
    if (quedan[3] === 0 && quedan[4] === 0) return false;
    for (let a = 0; a < vec.length; a++) {
      for (let b = a + 1; b < vec.length; b++) if (matriz[vec[a]][vec[b]] > 0) return true;
    }
    return false;
  }

  function contarNodo() {
    iteraciones++;
    if (iteraciones > maxIter) {
      llegoAlTope = true;
      terminado = true;
    }
    return !terminado;
  }

  function elegir(vec, desde, faltan, zona, k) {
    if (!contarNodo()) return;
    if (faltan === 0) {
      zonas.push([...zona]);
      buscar(k + 1);
      zonas.pop();
      return;
    }
    for (let a = desde; a < vec.length && !terminado; a++) {
      const j = vec[a];
      if (!zona.every((x) => matriz[x][j] > 0)) continue;
      usado[j] = true;
      zona.push(j);
      elegir(vec, a + 1, faltan - 1, zona, k);
      zona.pop();
      usado[j] = false;
    }
  }

  function buscar(k) {
    if (!contarNodo()) return;
    while (k < n && usado[orden[k]]) k++;
    if (k === n) {
      if (sin < mejorSin || (mejor !== null && sin === mejorSin && no3 < mejorNo3)) {
        mejor = zonas.map((z) => [...z]);
        mejorSin = sin;
        mejorNo3 = no3;
        // Sin parejas sin zona se usaron todos los tamaños: no hay nada mejor.
        if (sin === 0) terminado = true;
      }
      return;
    }

    let libres = 0;
    let pueden = 0;
    for (let t = k; t < n; t++) {
      const j = orden[t];
      if (usado[j]) continue;
      libres++;
      if (puedeEntrar(j)) pueden++;
    }
    const cota = sin + libres - maxCubrible(pueden);
    if (cota > mejorSin || (cota === mejorSin && (mejor === null || no3 >= mejorNo3))) return;

    const i = orden[k];
    usado[i] = true;
    const vec = [];
    for (let t = k + 1; t < n; t++) {
      const j = orden[t];
      if (!usado[j] && matriz[i][j] > 0) vec.push(j);
    }
    for (const size of [3, 4, 2]) {
      if (quedan[size] === 0 || terminado) continue;
      quedan[size]--;
      if (size !== 3) no3++;
      elegir(vec, 0, size - 1, [i], k);
      quedan[size]++;
      if (size !== 3) no3--;
    }
    if (!terminado) {
      sin++;
      buscar(k + 1);
      sin--;
    }
    usado[i] = false;
  }

  buscar(0);
  return { zonas: mejor, iteraciones: Math.min(iteraciones, maxIter), llegoAlTope };
}

/**
 * Arma grupos de parejas maximizando compatibilidad por slots discretos.
 * Primero el armado voraz de siempre (un grupo por tamaño de configZonas, sin deshacer los anteriores). Si deja
 * parejas sin zona, repararArmadoExacto busca un armado con los mismos tamaños que deje estrictamente menos; si
 * lo encuentra, lo reemplaza, con las zonas en el orden de tamaños de configZonas. Si no, queda el voraz.
 * `reparacion` informa qué pasó (no lo usa la app; lo leen la suite 43 y el benchmark).
 */
function armarGruposPorCompatibilidad(parejas, configZonas, matriz, { maxIterReparacion = MAX_ITER_REPARACION } = {}) {
  const n = parejas.length;
  const asignado = new Array(n).fill(false);
  const grupos = [];

  const compatibilidad = parejas.map((_, i) => {
    let count = 0;
    for (let j = 0; j < n; j++) {
      if (i !== j && matriz[i][j] > 0) count++;
    }
    return count;
  });

  for (const size of configZonas) {
    const libres = [];
    for (let i = 0; i < n; i++) {
      if (!asignado[i]) libres.push(i);
    }

    const candidatos = [...libres].sort((a, b) => compatibilidad[a] - compatibilidad[b]);
    const grupo = intentarArmarGrupo(candidatos, size, asignado, matriz);

    if (grupo !== null) {
      grupo.forEach((idx) => (asignado[idx] = true));
      grupos.push(grupo);
    }
  }

  const sinGrupo = [];
  for (let i = 0; i < n; i++) {
    if (!asignado[i]) sinGrupo.push(i);
  }

  const reparacion = {
    intentada: false,
    aceptada: false,
    iteraciones: 0,
    llegoAlTope: false,
    sinGrupoAntes: sinGrupo.length,
    sinGrupoDespues: sinGrupo.length,
  };
  if (sinGrupo.length === 0 || configZonas.length === 0) {
    return { grupos, sinGrupo, reparacion };
  }

  reparacion.intentada = true;
  // Mismo orden que los candidatos del voraz: grado de compatibilidad ascendente, estable por índice.
  const orden = Array.from({ length: n }, (_, i) => i).sort((a, b) => compatibilidad[a] - compatibilidad[b]);
  const res = repararArmadoExacto(orden, configZonas, matriz, sinGrupo.length, maxIterReparacion);
  reparacion.iteraciones = res.iteraciones;
  reparacion.llegoAlTope = res.llegoAlTope;
  if (!res.zonas) {
    return { grupos, sinGrupo, reparacion };
  }

  // Zonas reparadas en el orden de tamaños de configZonas; entre las del mismo tamaño, por su primera pareja.
  const posicion = new Map(orden.map((idx, k) => [idx, k]));
  const porTamano = { 2: [], 3: [], 4: [] };
  for (const z of res.zonas) porTamano[z.length].push(z);
  for (const s of [2, 3, 4]) porTamano[s].sort((a, b) => posicion.get(a[0]) - posicion.get(b[0]));
  const gruposReparados = [];
  for (const size of configZonas) {
    if (porTamano[size].length > 0) gruposReparados.push(porTamano[size].shift());
  }
  const enZona = new Set(gruposReparados.flat());
  const sinGrupoReparado = [];
  for (let i = 0; i < n; i++) {
    if (!enZona.has(i)) sinGrupoReparado.push(i);
  }

  reparacion.aceptada = true;
  reparacion.sinGrupoDespues = sinGrupoReparado.length;
  return { grupos: gruposReparados, sinGrupo: sinGrupoReparado, reparacion };
}

function intentarArmarGrupo(candidatos, size, asignado, matriz) {
  const MAX_ITER = 5000;
  let iteraciones = 0;

  function backtrack(inicio, grupoActual) {
    iteraciones++;
    if (iteraciones > MAX_ITER) return null;

    if (grupoActual.length === size) {
      return [...grupoActual];
    }

    for (let i = inicio; i < candidatos.length; i++) {
      const idx = candidatos[i];
      if (asignado[idx]) continue;

      let compatible = true;
      for (const prev of grupoActual) {
        if (matriz[idx][prev] === 0) {
          compatible = false;
          break;
        }
      }
      if (!compatible) continue;

      grupoActual.push(idx);
      const res = backtrack(i + 1, grupoActual);
      if (res !== null) return res;
      grupoActual.pop();

      if (iteraciones > MAX_ITER) return null;
    }

    return null;
  }

  return backtrack(0, []);
}

/**
 * Iniciar categoría agrupando zonas por disponibilidad horaria
 */
async function iniciarCategoriaConDisponibilidad(organizadorId, categoriaId, externalTx = null, { armado = null } = {}) {
  const db = externalTx || prisma;
  const categoria = await getCategoriaById(organizadorId, categoriaId, db);

  if (categoria.estado !== 'BORRADOR') {
    const error = new Error('La categoría ya fue iniciada.');
    error.statusCode = 400;
    throw error;
  }

  // Orden explícito (sesión 81): define los índices de la matriz de compatibilidad y los empates de
  // armarGruposPorCompatibilidad. slotsSeleccionados por slotId es lo que ya devolvía el índice (sin efecto).
  const parejas = await db.pareja.findMany({
    where: { categoriaId },
    orderBy: [{ orden: 'asc' }, { id: 'asc' }],
    include: { slotsSeleccionados: { orderBy: { slotId: 'asc' } } },
  });

  const numParejas = parejas.length;
  if (numParejas < 2) {
    const error = new Error('Se necesitan al menos 2 parejas para iniciar la categoría.');
    error.statusCode = 400;
    throw error;
  }

  const conSlots = parejas.filter((p) => p.slotsSeleccionados.length > 0);
  if (!armado && conSlots.length === 0) {
    const error = new Error(
      'Ninguna pareja tiene disponibilidad horaria cargada. Usá el inicio por sorteo o cargá disponibilidad primero.'
    );
    error.statusCode = 400;
    throw error;
  }

  let grupos;
  let sinGrupo;
  if (armado) {
    // Armado impuesto por el optimizador del pre-check: grupos de parejaId en orden de juego (P1 = [0] vs [1], ...).
    const indice = new Map(parejas.map((p, i) => [p.id, i]));
    const aIndices = (ids) => ids.map((id) => {
      if (!indice.has(id)) throw Object.assign(new Error('El armado impuesto incluye una pareja que no es de la categoría.'), { statusCode: 409 });
      return indice.get(id);
    });
    grupos = armado.grupos.map(aIndices);
    sinGrupo = aIndices(armado.sinGrupo);
  } else {
    const matriz = construirMatrizCompatibilidad(parejas.map((p) => p.slotsSeleccionados.map((s) => s.slotId)));
    const configZonas = calcularConfigZonas(numParejas);
    ({ grupos, sinGrupo } = armarGruposPorCompatibilidad(parejas, configZonas, matriz));
  }

  const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const resumenZonasCreadas = [];
  const resumenZonasManual = [];

  const runOperation = async (tx) => {
    let letraIndex = 0;

    for (const grupo of grupos) {
      const size = grupo.length;
      const nombreZona = `Zona ${letras[letraIndex] || letraIndex}`;
      const formato = size === 4 ? 'MINI_BRACKET' : 'ROUND_ROBIN';
      const clasifican = size === 4 ? 3 : 2;

      const zona = await tx.zona.create({
        data: { categoriaId, nombre: nombreZona, clasifican, formato },
      });

      const parejasEnZona = grupo.map((idx) => parejas[idx]);

      for (const p of parejasEnZona) {
        await tx.zonaPareja.create({ data: { zonaId: zona.id, parejaId: p.id } });
      }

      await generarPartidosZonaHelper(tx, categoriaId, zona.id, formato, size, parejasEnZona);

      resumenZonasCreadas.push({
        nombre: nombreZona,
        parejas: parejasEnZona.map((p) => ({ id: p.id, jugador1: p.jugador1, jugador2: p.jugador2 })),
      });

      letraIndex++;
    }

    if (sinGrupo.length > 0) {
      const nombreZona = `Zona ${letras[letraIndex] || letraIndex}`;
      letraIndex++;

      const size = sinGrupo.length;
      const formato = size === 4 ? 'MINI_BRACKET' : 'ROUND_ROBIN';
      const clasifican = size === 4 ? 3 : 2;

      const zona = await tx.zona.create({
        data: {
          categoriaId,
          nombre: nombreZona,
          clasifican,
          formato,
          requiereArmadoManual: true,
        },
      });

      const parejasSinGrupo = sinGrupo.map((idx) => parejas[idx]);

      for (const p of parejasSinGrupo) {
        await tx.zonaPareja.create({
          data: {
            zonaId: zona.id,
            parejaId: p.id,
          },
        });
      }

      await generarPartidosZonaHelper(tx, categoriaId, zona.id, formato, size, parejasSinGrupo, { sinHorarioAsignado: true });

      resumenZonasManual.push({
        nombre: nombreZona,
        parejas: parejasSinGrupo.map((p) => ({
          id: p.id,
          jugador1: p.jugador1,
          jugador2: p.jugador2,
        })),
      });
    }

    await tx.categoria.update({
      where: { id: categoriaId },
      data: { estado: 'EN_CURSO' },
    });
    await recalcularEstadosPorPartido(tx, categoriaId);
  };

  if (externalTx) {
    await runOperation(externalTx);
  } else {
    await prisma.$transaction(runOperation);
  }

  return {
    message: 'Categoría iniciada por disponibilidad horaria.',
    zonasCreadas: resumenZonasCreadas,
    zonasManual: resumenZonasManual,
    parejasSinDisponibilidad: parejas
      .filter((p) => p.slotsSeleccionados.length === 0)
      .map((p) => ({ id: p.id, jugador1: p.jugador1, jugador2: p.jugador2 })),
  };
}

/**
 * Calcula la próxima fecha de un día ("Viernes" o "Sabado") a partir de una fecha base
 */
function proximaFechaPorDia(dia, fechaBase) {
  const diaMap = { 'Viernes': 5, 'Sabado': 6, 'Sábado': 6, 'Domingo': 0 };
  const targetDia = diaMap[dia] !== undefined ? diaMap[dia] : 5;
  const hoy = parseFechaLocal(fechaBase);
  const diaActual = hoy.getDay();
  let diff = targetDia - diaActual;
  if (diff < 0) diff += 7;
  const targetDate = new Date(hoy);
  targetDate.setDate(hoy.getDate() + diff);
  targetDate.setHours(0, 0, 0, 0);
  return targetDate;
}

/**
 * Convierte un slotId ("Viernes-18:00" o "Viernes-00:00") a una fecha completa DateTime.
 * Los slots de madrugada (00:00 a 05:59) corresponden a la trasnoche del día y por lo tanto
 * se ubican en la madrugada del día calendario siguiente.
 */
function parseSlotToDate(slotId, fechaBase) {
  if (!slotId || !fechaBase) return null;
  const [dia, horaStr] = slotId.split('-');
  if (!dia || !horaStr) return null;
  const [hh, mm] = horaStr.split(':').map(Number);
  if (isNaN(hh) || isNaN(mm)) return null;

  const baseDate = proximaFechaPorDia(dia, fechaBase);
  // Si la hora es de trasnoche (00:00 a 05:59), pertenece a la madrugada del día siguiente
  if (hh < 6) {
    baseDate.setDate(baseDate.getDate() + 1);
  }
  baseDate.setHours(hh, mm, 0, 0);
  return baseDate;
}

/**
 * Convierte un slotId a su ventana continua en milisegundos [startMs, endMs]
 */
function slotIdToMsWindow(slotId, refFecha) {
  const startDate = parseSlotToDate(slotId, refFecha);
  if (!startDate) return null;
  const startMs = startDate.getTime();
  const endMs = startMs + DURACION_PARTIDO_MIN * 60 * 1000;
  return { startMs, endMs, dia: slotId.split('-')[0] };
}

/**
 * Fusiona slots adyacentes de una lista de slotIds en ventanas continuas
 */
function fusionarSlotsEnVentanas(slotIds, refFecha) {
  const rawWindows = slotIds
    .map((s) => slotIdToMsWindow(s, refFecha))
    .filter(Boolean)
    .sort((a, b) => a.startMs - b.startMs);

  if (rawWindows.length === 0) return [];

  const merged = [];
  let current = { ...rawWindows[0] };

  for (let i = 1; i < rawWindows.length; i++) {
    const next = rawWindows[i];
    if (next.dia === current.dia && next.startMs <= current.endMs) {
      current.endMs = Math.max(current.endMs, next.endMs);
    } else {
      merged.push(current);
      current = { ...next };
    }
  }
  merged.push(current);
  return merged;
}

/**
 * Calcula la intersección de ventanas continuas entre dos listas de ventanas
 */
function interseccionVentanas(ventanasA, ventanasB) {
  const result = [];
  for (const a of ventanasA) {
    for (const b of ventanasB) {
      if (a.dia !== b.dia) continue;
      const startMs = Math.max(a.startMs, b.startMs);
      const endMs = Math.min(a.endMs, b.endMs);
      if (endMs - startMs >= DURACION_PARTIDO_MIN * 60 * 1000) {
        result.push({ dia: a.dia, startMs, endMs });
      }
    }
  }
  return result;
}

/**
 * Asigna automáticamente horarios y canchas a los partidos de zonas en dos pasadas
 * con línea de tiempo continua e independiente por cancha, respetando canchas compartidas
 * de TODO el club (cross-category y cruces con horario fijado).
 * Soporta recibir un categoriaId individual o un array de categoriaIds para optimización global (MCF Global).
 */
async function asignarHorariosAutomatico(organizadorId, categoriaIdOrIds, externalTx = null, options = {}) {
  const db = externalTx || prisma;
  const categoriaIds = Array.isArray(categoriaIdOrIds) ? categoriaIdOrIds : [categoriaIdOrIds];

  const categorias = await db.categoria.findMany({
    where: { id: { in: categoriaIds } },
    include: {
      torneo: true,
    },
  });

  if (categorias.length === 0) {
    const error = new Error('No se encontraron categorías.');
    error.statusCode = 404;
    throw error;
  }

  for (const c of categorias) {
    if (c.torneo.organizadorId !== organizadorId) {
      const error = new Error('No tenés permisos para gestionar una o más categorías seleccionadas.');
      error.statusCode = 403;
      throw error;
    }
  }

  const enBorrador = categorias.find((c) => c.estado === 'BORRADOR');
  if (enBorrador) {
    const error = new Error(`La categoría "${enBorrador.nombre}" está en borrador. Iniciá la categoría primero.`);
    error.statusCode = 400;
    throw error;
  }

  const organizador = await db.organizador.findUnique({
    where: { id: organizadorId },
  });

  const cantidadCanchas = Math.max(1, organizador?.cantidadCanchas || 1);
  const DURACION_MS = DURACION_PARTIDO_MIN * 60 * 1000;

  // 1. Cargar todos los partidos ya agendados de TODO el club
  const partidosYaAgendados = await db.partido.findMany({
    where: {
      categoria: {
        torneo: { organizadorId },
      },
      canchaNumero: { not: null },
      fechaHora: { not: null },
      sinHorarioAsignado: false,
    },
    select: {
      id: true,
      categoriaId: true,
      fechaHora: true,
      canchaNumero: true,
      pareja1Id: true,
      pareja2Id: true,
    },
  });

  const yaAgendadosIds = new Set(partidosYaAgendados.map((p) => p.id));

  // 2. Inicializar timelines de cada cancha y asignaciones de parejas
  const courtTimelines = new Map();
  for (let c = 1; c <= cantidadCanchas; c++) {
    courtTimelines.set(c, []);
  }

  const parejaAssignments = new Map();

  for (const p of partidosYaAgendados) {
    const pStart = new Date(p.fechaHora).getTime();
    const pEnd = pStart + DURACION_MS;
    const cancha = p.canchaNumero;

    if (cancha && courtTimelines.has(cancha)) {
      courtTimelines.get(cancha).push({ startMs: pStart, endMs: pEnd });
    }

    if (p.pareja1Id) {
      if (!parejaAssignments.has(p.pareja1Id)) parejaAssignments.set(p.pareja1Id, []);
      parejaAssignments.get(p.pareja1Id).push({ startMs: pStart, endMs: pEnd });
    }
    if (p.pareja2Id) {
      if (!parejaAssignments.has(p.pareja2Id)) parejaAssignments.set(p.pareja2Id, []);
      parejaAssignments.get(p.pareja2Id).push({ startMs: pStart, endMs: pEnd });
    }
  }

  // 3. Cargar partidos pendientes de zonas de las categorías especificadas (opcionalmente filtrado por zonaId)
  // Orden explícito (sesión 81): el greedy de las pasadas 0-2 y la fase 2 recorren los partidos en este orden.
  // Sin orderBy salían en orden de inserción. El id solo desempata si hubiera zonas con el mismo nombre.
  const partidos = await db.partido.findMany({
    where: {
      categoriaId: { in: categoriaIds },
      zonaId: options.zonaId ? options.zonaId : { not: null },
      estado: 'PENDIENTE',
    },
    orderBy: [{ categoria: { nombre: 'asc' } }, { zona: { nombre: 'asc' } }, { posicionEnRonda: 'asc' }, { id: 'asc' }],
    include: {
      categoria: { include: { torneo: true } },
      zona: {
        include: {
          zonaParejas: {
            include: {
              pareja: {
                include: { slotsSeleccionados: true },
              },
            },
          },
        },
      },
      pareja1: { include: { slotsSeleccionados: true } },
      pareja2: { include: { slotsSeleccionados: true } },
    },
  });

  const partidosFase1 = [];
  const partidosMiniBracketFase2 = [];

  for (const p of partidos) {
    if (yaAgendadosIds.has(p.id)) continue;
    if (p.zona?.requiereArmadoManual) continue;
    if (p.zona?.formato === 'MINI_BRACKET' && p.posicionEnRonda >= 3) {
      partidosMiniBracketFase2.push(p);
    } else if (p.pareja1Id && p.pareja2Id) {
      partidosFase1.push(p);
    }
  }

  const refFecha = requireTorneoFecha(categorias[0]?.torneo);
  const baseFriday = proximaFechaPorDia('Viernes', refFecha);
  const baseSaturday = proximaFechaPorDia('Sabado', refFecha);

  const friInicioMin = horaAMinutos(organizador.viernesInicio);
  const friFinMin = horaAMinutos(organizador.viernesFin);
  let friEffectiveFinMin = friFinMin;
  if (friEffectiveFinMin <= friInicioMin && organizador.viernesFin) {
    friEffectiveFinMin += 24 * 60;
  }
  const friDayStartMs = baseFriday.getTime() + friInicioMin * 60 * 1000;
  const friDayEndMs = baseFriday.getTime() + friEffectiveFinMin * 60 * 1000;
  const hasFriday = Boolean(organizador.viernesInicio && organizador.viernesFin && friDayEndMs > friDayStartMs);

  const satInicioMin = horaAMinutos(organizador.sabadoInicio);
  const satFinMin = horaAMinutos(organizador.sabadoFin);
  let satEffectiveFinMin = satFinMin;
  if (satEffectiveFinMin <= satInicioMin && organizador.sabadoFin) {
    satEffectiveFinMin += 24 * 60;
  }
  const satDayStartMs = baseSaturday.getTime() + satInicioMin * 60 * 1000;
  const satDayEndMs = baseSaturday.getTime() + satEffectiveFinMin * 60 * 1000;
  const hasSaturday = Boolean(organizador.sabadoInicio && organizador.sabadoFin && satDayEndMs > satDayStartMs);

  // 4. Preprocesar y clasificar partidos Fase 1 en grupos de prioridad (MCF Global)
  const grupo0 = []; // Máxima prioridad (resolución manual)
  const grupo1 = [];
  const grupo2 = [];

  for (const partido of partidosFase1) {
    const slotsP1 = ordenarSlotsCronologicamente((partido.pareja1?.slotsSeleccionados || []).map((s) => s.slotId));
    const slotsP2 = ordenarSlotsCronologicamente((partido.pareja2?.slotsSeleccionados || []).map((s) => s.slotId));

    const conSlotsP1 = slotsP1.length > 0;
    const conSlotsP2 = slotsP2.length > 0;

    let slotsComunes = [];
    let sharedWindows = [];

    if (conSlotsP1 && conSlotsP2) {
      const set2 = new Set(slotsP2);
      slotsComunes = slotsP1.filter((s) => set2.has(s));

      const win1 = fusionarSlotsEnVentanas(slotsP1, refFecha);
      const win2 = fusionarSlotsEnVentanas(slotsP2, refFecha);
      sharedWindows = interseccionVentanas(win1, win2);
    } else if (conSlotsP1 || conSlotsP2) {
      slotsComunes = conSlotsP1 ? slotsP1 : slotsP2;
      sharedWindows = fusionarSlotsEnVentanas(slotsComunes, refFecha);
    } else {
      if (hasFriday) {
        sharedWindows.push({ dia: 'Viernes', startMs: friDayStartMs, endMs: friDayEndMs });
      }
      if (hasSaturday) {
        sharedWindows.push({ dia: 'Sabado', startMs: satDayStartMs, endMs: satDayEndMs });
      }
    }

    slotsComunes = ordenarSlotsCronologicamente(slotsComunes);

    const item = { partido, slotsComunes, sharedWindows, numOptions: sharedWindows.length };

    if (partido.pareja1?.resolucionManual || partido.pareja2?.resolucionManual) {
      grupo0.push(item);
    } else if (slotsComunes.length === 1 || (slotsComunes.length === 0 && sharedWindows.length === 1)) {
      grupo1.push(item);
    } else {
      grupo2.push(item);
    }
  }

  // Ordenar grupo0 y grupo2 por menor cantidad de opciones (Most Constrained First)
  grupo0.sort((a, b) => a.numOptions - b.numOptions);
  grupo2.sort((a, b) => a.numOptions - b.numOptions);

  const updatesMap = new Map();

  function isCourtFree(cancha, startMs, endMs) {
    const timeline = courtTimelines.get(cancha) || [];
    for (const interval of timeline) {
      if (startMs < interval.endMs && endMs > interval.startMs) {
        return false;
      }
    }
    return true;
  }

  function isPairFree(parejaId, startMs, endMs) {
    if (!parejaId) return true;
    const intervals = parejaAssignments.get(parejaId) || [];
    for (const interval of intervals) {
      if (startMs < interval.endMs && endMs > interval.startMs) {
        return false;
      }
    }
    return true;
  }

  function findFreeCourtAt(startMs, endMs) {
    for (let c = 1; c <= cantidadCanchas; c++) {
      if (isCourtFree(c, startMs, endMs)) {
        return c;
      }
    }
    return null;
  }

  function tryAssignSlotWithGap(partido, slotId, sharedWindows) {
    const slotWin = slotIdToMsWindow(slotId, refFecha);
    if (!slotWin) return false;

    const startMs = slotWin.startMs;
    const endMs = slotWin.endMs;

    let withinShared = false;
    for (const w of sharedWindows) {
      if (w.dia === slotWin.dia && startMs >= w.startMs && endMs <= w.endMs) {
        withinShared = true;
        break;
      }
    }
    if (!withinShared) return false;

    if (!isPairFree(partido.pareja1Id, startMs, endMs) || !isPairFree(partido.pareja2Id, startMs, endMs)) {
      return false;
    }

    const canchaLibre = findFreeCourtAt(startMs, endMs);
    if (canchaLibre !== null) {
      courtTimelines.get(canchaLibre).push({ startMs, endMs });
      if (!parejaAssignments.has(partido.pareja1Id)) parejaAssignments.set(partido.pareja1Id, []);
      parejaAssignments.get(partido.pareja1Id).push({ startMs, endMs });
      if (!parejaAssignments.has(partido.pareja2Id)) parejaAssignments.set(partido.pareja2Id, []);
      parejaAssignments.get(partido.pareja2Id).push({ startMs, endMs });

      updatesMap.set(partido.id, {
        id: partido.id,
        sinHorarioAsignado: false,
        fechaHora: new Date(startMs),
        canchaNumero: canchaLibre,
      });
      return true;
    }
    return false;
  }

  function tryAssignContinuousWindows(partido, sharedWindows) {
    for (const window of sharedWindows) {
      const isFri = window.dia === 'Viernes';
      const dayStartMs = isFri ? friDayStartMs : satDayStartMs;
      const dayEndMs = isFri ? friDayEndMs : satDayEndMs;

      const wStart = Math.max(window.startMs, dayStartMs);
      const wEnd = Math.min(window.endMs, dayEndMs);

      let bestCandidateForWindow = null;

      for (let c = 1; c <= cantidadCanchas; c++) {
        let T = wStart;
        while (T + DURACION_MS <= wEnd) {
          const tEnd = T + DURACION_MS;
          if (isCourtFree(c, T, tEnd) && isPairFree(partido.pareja1Id, T, tEnd) && isPairFree(partido.pareja2Id, T, tEnd)) {
            if (bestCandidateForWindow === null || T < bestCandidateForWindow.T) {
              bestCandidateForWindow = { T, cancha: c };
            }
            break;
          }
          T += 15 * 60 * 1000;
        }
      }

      if (bestCandidateForWindow !== null) {
        courtTimelines.get(bestCandidateForWindow.cancha).push({
          startMs: bestCandidateForWindow.T,
          endMs: bestCandidateForWindow.T + DURACION_MS,
        });
        if (!parejaAssignments.has(partido.pareja1Id)) parejaAssignments.set(partido.pareja1Id, []);
        parejaAssignments.get(partido.pareja1Id).push({
          startMs: bestCandidateForWindow.T,
          endMs: bestCandidateForWindow.T + DURACION_MS,
        });
        if (!parejaAssignments.has(partido.pareja2Id)) parejaAssignments.set(partido.pareja2Id, []);
        parejaAssignments.get(partido.pareja2Id).push({
          startMs: bestCandidateForWindow.T,
          endMs: bestCandidateForWindow.T + DURACION_MS,
        });

        updatesMap.set(partido.id, {
          id: partido.id,
          sinHorarioAsignado: false,
          fechaHora: new Date(bestCandidateForWindow.T),
          canchaNumero: bestCandidateForWindow.cancha,
        });
        return true;
      }
    }
    return false;
  }

  // ================= PASADA 0 (Alta Prioridad - Resolución Manual) =================
  for (const { partido, slotsComunes, sharedWindows } of grupo0) {
    let asignado = false;
    for (const slotId of slotsComunes) {
      if (tryAssignSlotWithGap(partido, slotId, sharedWindows)) {
        asignado = true;
        break;
      }
    }
    if (!asignado) {
      if (!tryAssignContinuousWindows(partido, sharedWindows)) {
        updatesMap.set(partido.id, { id: partido.id, sinHorarioAsignado: true, fechaHora: null, canchaNumero: null });
      }
    }
  }

  // ================= PASADA 1 =================
  for (const { partido, slotsComunes, sharedWindows } of grupo1) {
    const ok = tryAssignSlotWithGap(partido, slotsComunes[0], sharedWindows);
    if (!ok) {
      const okContinuous = tryAssignContinuousWindows(partido, sharedWindows);
      if (!okContinuous) {
        updatesMap.set(partido.id, { id: partido.id, sinHorarioAsignado: true, fechaHora: null, canchaNumero: null });
      }
    }
  }

  // ================= PASADA 2 =================
  for (const { partido, slotsComunes, sharedWindows } of grupo2) {
    let asignado = false;
    for (const slotId of slotsComunes) {
      if (tryAssignSlotWithGap(partido, slotId, sharedWindows)) {
        asignado = true;
        break;
      }
    }
    if (!asignado) {
      if (!tryAssignContinuousWindows(partido, sharedWindows)) {
        updatesMap.set(partido.id, { id: partido.id, sinHorarioAsignado: true, fechaHora: null, canchaNumero: null });
      }
    }
  }

  // ================= FASE 2: MINI_BRACKET RONDA 2 (P3: Ganadores y P4: Perdedores) =================
  // Solo se procesan después de que P1 y P2 de la zona ya tienen horario confirmado (max(fin(P1), fin(P2))).
  const mbZonasMap = new Map();
  for (const p of partidosMiniBracketFase2) {
    if (!mbZonasMap.has(p.zonaId)) mbZonasMap.set(p.zonaId, []);
    mbZonasMap.get(p.zonaId).push(p);
  }

  for (const [zId, matches] of mbZonasMap.entries()) {
    const zona = matches[0]?.zona;
    if (!zona) continue;

    // Buscar P1 y P2 de esta zona
    const allZonaPartidos = partidos.filter((p) => p.zonaId === zId);
    const p1 = allZonaPartidos.find((p) => p.posicionEnRonda === 1);
    const p2 = allZonaPartidos.find((p) => p.posicionEnRonda === 2);

    const t1 = updatesMap.get(p1?.id)?.fechaHora || (p1?.fechaHora && !p1?.sinHorarioAsignado ? p1.fechaHora : null);
    const t2 = updatesMap.get(p2?.id)?.fechaHora || (p2?.fechaHora && !p2?.sinHorarioAsignado ? p2.fechaHora : null);

    const p3 = matches.find((p) => p.posicionEnRonda === 3);
    const p4 = matches.find((p) => p.posicionEnRonda === 4);

    if (!t1 || !t2) {
      if (p3) updatesMap.set(p3.id, { id: p3.id, sinHorarioAsignado: true, fechaHora: null, canchaNumero: null });
      if (p4) updatesMap.set(p4.id, { id: p4.id, sinHorarioAsignado: true, fechaHora: null, canchaNumero: null });
      continue;
    }

    const minStartMs = Math.max(new Date(t1).getTime(), new Date(t2).getTime()) + DURACION_MS;

    // Obtener las 4 parejas de la zona
    const zonePairs = (zona.zonaParejas || []).map((zp) => zp.pareja).filter(Boolean);
    const slotsLists = zonePairs.map((p) => ordenarSlotsCronologicamente((p.slotsSeleccionados || []).map((s) => s.slotId)));

    // Calcular intersección cuádruple de ventanas continuas
    let shared4 = [];
    const conSlotsLists = slotsLists.filter((l) => l.length > 0);
    if (conSlotsLists.length === 0) {
      if (hasFriday) shared4.push({ dia: 'Viernes', startMs: friDayStartMs, endMs: friDayEndMs });
      if (hasSaturday) shared4.push({ dia: 'Sabado', startMs: satDayStartMs, endMs: satDayEndMs });
    } else {
      const windowsList = conSlotsLists.map((l) => fusionarSlotsEnVentanas(l, refFecha));
      shared4 = windowsList[0];
      for (let i = 1; i < windowsList.length; i++) {
        shared4 = interseccionVentanas(shared4, windowsList[i]);
      }
    }

    // Calcular slots comunes exactos de las 4 parejas
    let commonSlots4 = [];
    if (conSlotsLists.length > 0) {
      commonSlots4 = conSlotsLists[0];
      for (let i = 1; i < conSlotsLists.length; i++) {
        commonSlots4 = commonSlots4.filter((s) => conSlotsLists[i].includes(s));
      }
      commonSlots4 = ordenarSlotsCronologicamente(commonSlots4);
    }

    // Programar P3 y P4
    const matchesToSchedule = [p3, p4].filter(Boolean);
    for (const m of matchesToSchedule) {
      let asignado = false;

      // 1. Probar slots comunes exactos posteriores a minStartMs
      for (const sId of commonSlots4) {
        const sWin = slotIdToMsWindow(sId, refFecha);
        if (!sWin || sWin.startMs < minStartMs) continue;

        let withinShared = false;
        for (const w of shared4) {
          if (w.dia === sWin.dia && sWin.startMs >= w.startMs && sWin.endMs <= w.endMs) {
            withinShared = true;
            break;
          }
        }
        if (!withinShared) continue;

        const canchaLibre = findFreeCourtAt(sWin.startMs, sWin.endMs);
        if (canchaLibre !== null) {
          courtTimelines.get(canchaLibre).push({ startMs: sWin.startMs, endMs: sWin.endMs });
          updatesMap.set(m.id, {
            id: m.id,
            sinHorarioAsignado: false,
            fechaHora: new Date(sWin.startMs),
            canchaNumero: canchaLibre,
          });
          asignado = true;
          break;
        }
      }

      // 2. Probar ventanas continuas si no se asignó en slot común exacto
      if (!asignado) {
        for (const window of shared4) {
          const isFri = window.dia === 'Viernes';
          const dayStartMs = isFri ? friDayStartMs : satDayStartMs;
          const dayEndMs = isFri ? friDayEndMs : satDayEndMs;

          const wStart = Math.max(window.startMs, dayStartMs, minStartMs);
          const wEnd = Math.min(window.endMs, dayEndMs);

          let bestCandidate = null;
          for (let c = 1; c <= cantidadCanchas; c++) {
            let T = wStart;
            while (T + DURACION_MS <= wEnd) {
              const tEnd = T + DURACION_MS;
              if (isCourtFree(c, T, tEnd)) {
                if (bestCandidate === null || T < bestCandidate.T) {
                  bestCandidate = { T, cancha: c };
                }
                break;
              }
              T += 15 * 60 * 1000;
            }
          }

          if (bestCandidate !== null) {
            courtTimelines.get(bestCandidate.cancha).push({
              startMs: bestCandidate.T,
              endMs: bestCandidate.T + DURACION_MS,
            });
            updatesMap.set(m.id, {
              id: m.id,
              sinHorarioAsignado: false,
              fechaHora: new Date(bestCandidate.T),
              canchaNumero: bestCandidate.cancha,
            });
            asignado = true;
            break;
          }
        }
      }

      // 3. Fallback: Si no hay coincidencia cuádruple de disponibilidad, auto-asignar en la siguiente cancha libre del club posterior a minStartMs
      if (!asignado && !options.isPreCheck) {
        const clubWindows = [];
        if (hasFriday && friDayEndMs > minStartMs) {
          clubWindows.push({ dia: 'Viernes', startMs: Math.max(friDayStartMs, minStartMs), endMs: friDayEndMs });
        }
        if (hasSaturday && satDayEndMs > minStartMs) {
          clubWindows.push({ dia: 'Sabado', startMs: Math.max(satDayStartMs, minStartMs), endMs: satDayEndMs });
        }

        for (const cWin of clubWindows) {
          let bestFallback = null;
          for (let c = 1; c <= cantidadCanchas; c++) {
            let T = cWin.startMs;
            while (T + DURACION_MS <= cWin.endMs) {
              const tEnd = T + DURACION_MS;
              if (isCourtFree(c, T, tEnd)) {
                if (bestFallback === null || T < bestFallback.T) {
                  bestFallback = { T, cancha: c };
                }
                break;
              }
              T += 15 * 60 * 1000;
            }
          }

          if (bestFallback !== null) {
            courtTimelines.get(bestFallback.cancha).push({
              startMs: bestFallback.T,
              endMs: bestFallback.T + DURACION_MS,
            });
            updatesMap.set(m.id, {
              id: m.id,
              sinHorarioAsignado: false,
              fechaHora: new Date(bestFallback.T),
              canchaNumero: bestFallback.cancha,
            });
            asignado = true;
            break;
          }
        }
      }

      if (!asignado) {
        updatesMap.set(m.id, { id: m.id, sinHorarioAsignado: true, fechaHora: null, canchaNumero: null });
      }
    }
  }

  const updates = Array.from(updatesMap.values());

  // 6. Persistir en base de datos
  if (updates.length > 0) {
    if (externalTx) {
      for (const u of updates) {
        await externalTx.partido.update({
          where: { id: u.id },
          data: {
            fechaHora: u.fechaHora,
            canchaNumero: u.canchaNumero,
            sinHorarioAsignado: u.sinHorarioAsignado,
          },
        });
      }
    } else {
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
    }
  }

  const asignados = updates.filter((u) => !u.sinHorarioAsignado).length;
  const sinHorario = updates.filter((u) => u.sinHorarioAsignado).length;

  return {
    message: 'Asignación de horarios completada.',
    asignados,
    sinHorario,
    total: updates.length,
  };
}

/**
 * Reubica los partidos PENDIENTE de un torneo durante Modo Lluvia (reducción o restauración de canchas)
 * aplicando Compactación Continua Earliest-Fit ordenada cronológicamente por horario original.
 * Garantiza que los partidos FINALIZADO y EN_CURSO queden 100% fijos como ocupación inmutable en sus canchas y horarios originales.
 * En situación de emergencia (lluvia) se apila sin mirar la disponibilidad de las parejas, con estas reglas:
 * - Viernes: los partidos sin horario previo respetan el inicio de la disponibilidad de sus dos parejas
 *   (una pareja sin horarios ese día no pone piso); todos terminan antes del cierre del club del viernes.
 *   Lo que no entra pasa al sábado desde la apertura o, si empezó, max(apertura, próximo pendiente),
 *   sin mover los partidos del sábado. Si tampoco entra, queda sin horario.
 * - Viernes y sábado: al reducir canchas, el horario previo a esta corrida también es un piso.
 * - Sábado: desde el piso de cada partido hasta el límite de trasnoche (dayLimitMs).
 * - Si la jornada empezó (FINALIZADO o EN_CURSO), su próximo pendiente con horario es el piso;
 *   si no empezó, se llena desde la apertura. Se toma el estado antes de mover nada.
 */
async function asignarHorariosModoLluviaMCF(organizadorId, torneoId, overrideCanchas, externalTx = null, overrideTimestamp = null) {
  const db = externalTx || prisma;

  const torneo = await db.torneo.findUnique({
    where: { id: torneoId },
    include: {
      organizador: true,
      categorias: true,
    },
  });

  if (!torneo || torneo.organizadorId !== organizadorId) {
    const error = new Error('Torneo no encontrado o no autorizado.');
    error.statusCode = 404;
    throw error;
  }

  const organizador = torneo.organizador;
  const canchasClub = organizador.cantidadCanchas || 1;
  const cantidadCanchas = Math.max(1, overrideCanchas || canchasClub);
  const DURACION_MS = DURACION_PARTIDO_MIN * 60 * 1000;
  // Corrida con todas las canchas del club (restauración de la jornada)
  const esRestauracionTotal = cantidadCanchas >= canchasClub;

  const refFecha = requireTorneoFecha(torneo);
  const baseFriday = proximaFechaPorDia('Viernes', refFecha);
  const baseSaturday = proximaFechaPorDia('Sabado', refFecha);

  const friInicioMin = horaAMinutos(organizador.viernesInicio);
  const friDayStartMs = baseFriday.getTime() + friInicioMin * 60 * 1000;

  const satInicioMin = horaAMinutos(organizador.sabadoInicio);
  const satDayStartMs = baseSaturday.getTime() + satInicioMin * 60 * 1000;

  // Inicio de la ventana nocturna de R32 (misma fuente que programarHorariosEliminatorias)
  const { sabNightStartMs } = calcularVentanaSabadoNoche(organizador, baseSaturday.getTime());

  // Viernes con lluvia: el límite es el cierre del club del viernes (no la trasnoche).
  const medianocheViernes = new Date(baseFriday);
  medianocheViernes.setHours(0, 0, 0, 0);
  const cierreViernesMs = calcularFinJornadaMs(medianocheViernes.getTime(), organizador.viernesInicio, organizador.viernesFin);
  // Lo que no entra el viernes pasa al sábado, hasta el fin de la jornada del sábado.
  const sabadoInfo = getDiaCalendarioConTrasnoche(new Date(satDayStartMs), organizador);

  // 1. Cargar todos los partidos del torneo
  const todosLosPartidos = await db.partido.findMany({
    where: {
      categoria: { torneoId },
    },
    include: {
      categoria: { select: { id: true, nombre: true } },
      zona: { select: { id: true, formato: true, nombre: true } },
      faseEliminatoria: { select: { ronda: true } },
      pareja1: { select: { id: true, jugador1: true, jugador2: true, resolucionManual: true, slotsSeleccionados: { select: { slotId: true } } } },
      pareja2: { select: { id: true, jugador1: true, jugador2: true, resolucionManual: true, slotsSeleccionados: { select: { slotId: true } } } },
    },
  });

  // Foto previa a la reprogramación: también fija el piso del sábado que recibe partidos del viernes.
  const jornadasEmpezadas = new Set(todosLosPartidos
    .filter((p) => !p.esBye && p.fechaHora && (p.estado === 'FINALIZADO' || p.estado === 'EN_CURSO'))
    .map((p) => getDiaCalendarioConTrasnoche(p.fechaHora, organizador)?.key));
  const proximoPorJornada = new Map();
  for (const p of todosLosPartidos) {
    if (p.estado !== 'PENDIENTE' || p.esBye || !p.fechaHora || p.sinHorarioAsignado) continue;
    const key = getDiaCalendarioConTrasnoche(p.fechaHora, organizador)?.key;
    if (!jornadasEmpezadas.has(key)) continue;
    const inicio = new Date(p.fechaHora).getTime();
    proximoPorJornada.set(key, Math.min(proximoPorJornada.get(key) ?? Infinity, inicio));
  }

  function isMiniBracketRonda2(p) {
    return Boolean(
      p.zonaId &&
      p.zona?.formato === 'MINI_BRACKET' &&
      (p.posicionEnRonda === 3 || p.posicionEnRonda === 4)
    );
  }

  // Dieciseisavos (R32) jugables: se juegan el sábado a la noche
  function esR32(p) {
    return Boolean(p.faseEliminatoriaId && !p.esBye && (p.faseEliminatoria?.ronda || 0) >= 32);
  }

  function esR32Automatico(p) {
    return esR32(p) && !p.horarioManual;
  }

  // 2. Inicializar timelines de todas las canchas del club y asignaciones de parejas. La jornada afectada
  //    solo busca en las habilitadas (1..cantidadCanchas); el sábado, si recibe partidos del viernes, en las suyas.
  const courtTimelines = new Map();
  for (let c = 1; c <= Math.max(cantidadCanchas, canchasClub); c++) {
    courtTimelines.set(c, []);
  }

  const parejaAssignments = new Map();

  function addInterval(cancha, pareja1Id, pareja2Id, startMs, endMs) {
    if (cancha && courtTimelines.has(cancha)) {
      courtTimelines.get(cancha).push({ startMs, endMs });
    }
    if (pareja1Id) {
      if (!parejaAssignments.has(pareja1Id)) parejaAssignments.set(pareja1Id, []);
      parejaAssignments.get(pareja1Id).push({ startMs, endMs });
    }
    if (pareja2Id) {
      if (!parejaAssignments.has(pareja2Id)) parejaAssignments.set(pareja2Id, []);
      parejaAssignments.get(pareja2Id).push({ startMs, endMs });
    }
  }

  // Pre-sembrar partidos inmutables: FINALIZADO y EN_CURSO
  const partidosAAsignar = [];

  // Calcular día lógico afectado por el override (si se proporciona)
  let overrideDiaKey = null;
  if (overrideTimestamp) {
    const overrideDiaInfo = getDiaCalendarioConTrasnoche(overrideTimestamp, organizador);
    overrideDiaKey = overrideDiaInfo?.key || null;
  }

  // Leer el mapa previo de partidosSinSlot para overrideDiaKey antes de que la tx lo modifique o borre:
  // Usar la caché si expone partidosSinSlot; si no, consultar la tabla OverrideCanchasDia con el mismo db (tx).
  let prevPartidosSinSlot = {};
  if (overrideDiaKey) {
    let loadedFromCache = false;
    try {
      const cachedDia = canchasOverridesService.getCanchasDia(torneoId, overrideDiaKey, canchasClub);
      if (cachedDia && cachedDia.partidosSinSlot && typeof cachedDia.partidosSinSlot === 'object') {
        prevPartidosSinSlot = { ...cachedDia.partidosSinSlot };
        loadedFromCache = true;
      }
    } catch (_) {
      loadedFromCache = false;
    }

    if (!loadedFromCache) {
      const ovRecord = await db.overrideCanchasDia.findUnique({
        where: {
          torneoId_diaKey: {
            torneoId,
            diaKey: overrideDiaKey,
          },
        },
      });
      if (ovRecord && ovRecord.partidosSinSlot) {
        if (typeof ovRecord.partidosSinSlot === 'string') {
          try {
            prevPartidosSinSlot = JSON.parse(ovRecord.partidosSinSlot);
          } catch (_) {
            prevPartidosSinSlot = {};
          }
        } else if (typeof ovRecord.partidosSinSlot === 'object') {
          prevPartidosSinSlot = { ...ovRecord.partidosSinSlot };
        }
      }
    }
  }

  // Mapear fechaHora previa de todos los partidos para el guard en escritura
  const fechaHoraPreviaPorPartido = new Map();
  for (const p of todosLosPartidos) {
    if (p.fechaHora) {
      fechaHoraPreviaPorPartido.set(p.id, p.fechaHora);
    }
  }

  // Inicializar con entradas previas: en cada corrida queda = (previas que siguen sin horario) + (nuevos desplazados) - (los que volvieron a tener horario)
  // Guard de saneamiento: omitir cualquier ID previo cuya jornada original no coincida con overrideDiaKey
  const partidosSinSlotMotivos = new Map();
  for (const [pId, motivo] of Object.entries(prevPartidosSinSlot)) {
    const fechaPrevia = fechaHoraPreviaPorPartido.get(pId);
    if (fechaPrevia) {
      const dKey = getDiaCalendarioConTrasnoche(fechaPrevia, organizador)?.key;
      if (overrideDiaKey && dKey && dKey !== overrideDiaKey) {
        console.warn(
          `[Modo Lluvia Guard] Bug interno detectado / saneamiento: ID ${pId} pertenece a la jornada '${dKey}', pero estaba en el mapa previo de '${overrideDiaKey}'. Se omite del mapa.`
        );
        continue;
      }
    }
    partidosSinSlotMotivos.set(pId, motivo);
  }

  // Partidos que una lluvia anterior del mismo día dejó sin horario (mapa del día ya saneado)
  const enMapaDiaAlInicio = new Set(partidosSinSlotMotivos.keys());

  // Guard en escritura: solo registrar en partidosSinSlotMotivos partidos cuya jornada original (por fechaHora previa) coincide con overrideDiaKey
  function registrarPartidoSinSlot(partidoId, motivo) {
    const fechaPrevia = fechaHoraPreviaPorPartido.get(partidoId);
    if (fechaPrevia) {
      const diaPrevioInfo = getDiaCalendarioConTrasnoche(fechaPrevia, organizador);
      const diaPrevioKey = diaPrevioInfo?.key;
      if (overrideDiaKey && diaPrevioKey && diaPrevioKey !== overrideDiaKey) {
        console.warn(
          `[Modo Lluvia Guard] Bug interno detectado: intento de registrar en partidosSinSlot de '${overrideDiaKey}' el partido ${partidoId} cuya jornada original era '${diaPrevioKey}'. Se omite el registro.`
        );
        return;
      }
    } else {
      // Si el partido no tenía fechaHora al ingresar a la corrida, solo puede pertenecer al mapa si ya venía en prevPartidosSinSlot de este mismo overrideDiaKey
      if (overrideDiaKey && !Object.prototype.hasOwnProperty.call(prevPartidosSinSlot, partidoId)) {
        console.warn(
          `[Modo Lluvia Guard] Bug interno detectado: intento de registrar en partidosSinSlot de '${overrideDiaKey}' el partido ${partidoId} sin fechaHora previa y no presente en prevPartidosSinSlot. Se omite el registro.`
        );
        return;
      }
    }
    partidosSinSlotMotivos.set(partidoId, motivo);
  }

  // Registrar el horario de fin más tardío de partidos de zona por categoría
  const maxEndPorCategoriaZona = new Map();

  // Calcular el último fin de partidos FINALIZADO o EN_CURSO en la jornada lógica bajo override
  let latestFinishedOrEnCursoMs = 0;

  for (const p of todosLosPartidos) {
    if (p.fechaHora && p.zonaId && (p.estado === 'FINALIZADO' || p.estado === 'EN_CURSO')) {
      const pStart = new Date(p.fechaHora).getTime();
      const pEnd = pStart + DURACION_MS;
      const currentMax = maxEndPorCategoriaZona.get(p.categoriaId) || 0;
      if (pEnd > currentMax) {
        maxEndPorCategoriaZona.set(p.categoriaId, pEnd);
      }
    }

    if (p.estado === 'FINALIZADO' || p.estado === 'EN_CURSO') {
      partidosSinSlotMotivos.delete(p.id);
      if (p.fechaHora) {
        const startMs = new Date(p.fechaHora).getTime();
        const endMs = startMs + DURACION_MS;
        addInterval(p.canchaNumero, p.pareja1Id, p.pareja2Id, startMs, endMs);

        const pDiaInfo = getDiaCalendarioConTrasnoche(p.fechaHora, organizador);
        if (!overrideDiaKey || pDiaInfo?.key === overrideDiaKey) {
          if (endMs > latestFinishedOrEnCursoMs) {
            latestFinishedOrEnCursoMs = endMs;
          }
        }
      }
    } else if (p.estado === 'PENDIENTE') {
      const tieneHorario = Boolean(p.fechaHora && !p.sinHorarioAsignado);
      const enMapaSinSlotDia = Boolean(
        overrideDiaKey && Object.prototype.hasOwnProperty.call(prevPartidosSinSlot, p.id)
      );

      // Si el partido no tiene horario asignado, solo se reprograma si está en el mapa partidosSinSlot de ese día.
      // Si no está en el mapa (ej. pendiente de inicio de emergencia o cruce manual), no se toca.
      // Los R32 automáticos que una lluvia previa del día dejó sin horario se admiten aunque no tengan parejas.
      if (!tieneHorario) {
        if (enMapaSinSlotDia && ((p.pareja1Id && p.pareja2Id) || p.zonaId || esR32Automatico(p))) {
          partidosAAsignar.push(p);
        }
        continue;
      }

      const pDiaInfo = getDiaCalendarioConTrasnoche(p.fechaHora, organizador);
      const esMismaJornada = !overrideDiaKey || (pDiaInfo && pDiaInfo.key === overrideDiaKey);

      if (esR32(p) && esMismaJornada) {
        // R32 de la jornada afectada (con o sin parejas definidas):
        // - Manual en cancha activa: ocupación fija e intacta.
        // - Automático (cancha activa o inactiva) o manual en cancha inactiva: sale de la ocupación
        //   ANTES de compactar zonas y se reubica en tier 2 (después del fin de zonas de su categoría).
        const manualEnCanchaActiva =
          Boolean(p.horarioManual) && Boolean(p.canchaNumero) && p.canchaNumero <= cantidadCanchas;
        if (manualEnCanchaActiva) {
          partidosSinSlotMotivos.delete(p.id);
          const startMs = new Date(p.fechaHora).getTime();
          const endMs = startMs + DURACION_MS;
          addInterval(p.canchaNumero, p.pareja1Id, p.pareja2Id, startMs, endMs);
        } else {
          partidosAAsignar.push(p);
        }
        continue;
      }

      if (isMiniBracketRonda2(p)) {
        // P3/P4 de MINI_BRACKET (con o sin parejas definidas)
        if (!esMismaJornada) {
          if (p.fechaHora && !p.sinHorarioAsignado && p.canchaNumero) {
            const startMs = new Date(p.fechaHora).getTime();
            const endMs = startMs + DURACION_MS;
            addInterval(p.canchaNumero, p.pareja1Id, p.pareja2Id, startMs, endMs);
            const currentMax = maxEndPorCategoriaZona.get(p.categoriaId) || 0;
            if (endMs > currentMax) maxEndPorCategoriaZona.set(p.categoriaId, endMs);
          }
          continue;
        }

        partidosAAsignar.push(p);
      } else if (p.pareja1Id && p.pareja2Id) {
        if (!esMismaJornada) {
          // Partido de otro día lógico → tratar como ocupación fija si tiene horario
          if (p.fechaHora && p.canchaNumero) {
            const startMs = new Date(p.fechaHora).getTime();
            const endMs = startMs + DURACION_MS;
            addInterval(p.canchaNumero, p.pareja1Id, p.pareja2Id, startMs, endMs);
            if (p.zonaId) {
              const currentMax = maxEndPorCategoriaZona.get(p.categoriaId) || 0;
              if (endMs > currentMax) maxEndPorCategoriaZona.set(p.categoriaId, endMs);
            }
          }
          continue;
        }

        // Partido del día afectado → candidato a reprogramar
        partidosAAsignar.push(p);
      } else {
        // Cruces sin parejas definidas (ej. dieciseisavos con placeholders origenPareja1 / origenPareja2)
        if (p.faseEliminatoriaId && p.fechaHora && !p.sinHorarioAsignado && p.canchaNumero) {
          if (!esMismaJornada) {
            // Otra jornada: pre-sembrar si su cancha está habilitada
            const startMs = new Date(p.fechaHora).getTime();
            const endMs = startMs + DURACION_MS;
            addInterval(p.canchaNumero, null, null, startMs, endMs);
            continue;
          }

          if (p.canchaNumero > cantidadCanchas) {
            // Su cancha quedó inhabilitada en la jornada afectada → admitir para buscar cancha activa 1..cantidadCanchas
            partidosAAsignar.push(p);
          } else {
            // Su cancha ya está en cancha activa (1..cantidadCanchas) → NO alterar, pre-sembrar slot como ocupado
            partidosSinSlotMotivos.delete(p.id);
            const startMs = new Date(p.fechaHora).getTime();
            const endMs = startMs + DURACION_MS;
            addInterval(p.canchaNumero, null, null, startMs, endMs);
          }
        }
      }
    }
  }

  // 3. Ordenar partidos pendientes:
  //    Tier 0 (zonas base: Round Robin y P1-P2 de MINI_BRACKET) -> Tier 1 (P3-P4 de MINI_BRACKET) -> Tier 2 (eliminatorias),
  //    y dentro de cada tier cronológicamente por horario original (preservando antigüedad de turno).
  function getSchedulingTier(p) {
    if (isMiniBracketRonda2(p)) return 1;
    if (p.zonaId) return 0;
    return 2;
  }

  partidosAAsignar.sort((a, b) => {
    const tierA = getSchedulingTier(a);
    const tierB = getSchedulingTier(b);
    if (tierA !== tierB) return tierA - tierB;
    const tA = a.fechaHora ? new Date(a.fechaHora).getTime() : Infinity;
    const tB = b.fechaHora ? new Date(b.fechaHora).getTime() : Infinity;
    if (tA !== tB) return tA - tB;
    if ((a.canchaNumero || 0) !== (b.canchaNumero || 0)) {
      return (a.canchaNumero || 0) - (b.canchaNumero || 0);
    }
    if ((a.posicionEnRonda || 0) !== (b.posicionEnRonda || 0)) {
      return (a.posicionEnRonda || 0) - (b.posicionEnRonda || 0);
    }
    // Desempate natural (sesión 81): el id es un UUID v4 distinto en cada corrida, así que no sirve como
    // criterio. Categoría, después zona (por nombre) o ronda de eliminatoria; el id queda como último recurso.
    const catComp = (a.categoria?.nombre || '').localeCompare(b.categoria?.nombre || '');
    if (catComp !== 0) return catComp;
    const zonaComp = (a.zona?.nombre || '').localeCompare(b.zona?.nombre || '');
    if (zonaComp !== 0) return zonaComp;
    if ((a.faseEliminatoria?.ronda || 0) !== (b.faseEliminatoria?.ronda || 0)) {
      return (b.faseEliminatoria?.ronda || 0) - (a.faseEliminatoria?.ronda || 0);
    }
    return a.id.localeCompare(b.id);
  });

  const updatesMap = new Map();

  function isCourtFree(cancha, startMs, endMs) {
    const timeline = courtTimelines.get(cancha) || [];
    for (const interval of timeline) {
      if (startMs < interval.endMs && endMs > interval.startMs) {
        return false;
      }
    }
    return true;
  }

  function isPairFree(parejaId, startMs, endMs) {
    if (!parejaId) return true;
    const intervals = parejaAssignments.get(parejaId) || [];
    for (const interval of intervals) {
      if (startMs < interval.endMs && endMs > interval.startMs) {
        return false;
      }
    }
    return true;
  }

  function getRonda1InfoZona(zonaId, excludeId) {
    const r1Partidos = todosLosPartidos.filter(
      (m) =>
        m.zonaId === zonaId &&
        m.id !== excludeId &&
        m.posicionEnRonda != null &&
        m.posicionEnRonda <= 2
    );
    let maxEndMs = 0;
    let r1SinHorario = r1Partidos.length < 2;
    for (const r1 of r1Partidos) {
      const uR1 = updatesMap.get(r1.id);
      const effFechaHora = uR1 !== undefined ? uR1.fechaHora : r1.fechaHora;
      const effSinHorario = uR1 !== undefined ? uR1.sinHorarioAsignado : r1.sinHorarioAsignado;
      if (!effFechaHora || effSinHorario) {
        r1SinHorario = true;
      } else {
        const endMs = new Date(effFechaHora).getTime() + DURACION_MS;
        if (endMs > maxEndMs) maxEndMs = endMs;
      }
    }
    return { maxEndMs, r1SinHorario };
  }

  // Regla B en lluvia: el fin de zonas de la categoría es indeterminado si algún partido de zona
  // PENDIENTE quedó sin horario por lluvia, es decir (estado efectivo tras compactar):
  //   (a) tenía horario al empezar esta corrida y la compactación se lo sacó, o
  //   (b) está en el mapa partidosSinSlot del día (lo desplazó una lluvia anterior del mismo día).
  // Los que ya estaban sin horario fuera del mapa (ej. pendientes del inicio de emergencia) no cuentan:
  // en ese caso el R32 se reubica con piso = max(ventana nocturna, fin de zonas conocido, horario original).
  // Se evalúa al llegar a los R32 (tier 2), cuando las zonas (tiers 0 y 1) ya se procesaron.
  function categoriaTieneZonaSinHorarioPorLluvia(categoriaId) {
    return todosLosPartidos.some((m) => {
      if (!m.zonaId || m.categoriaId !== categoriaId || m.estado !== 'PENDIENTE') return false;
      const u = updatesMap.get(m.id);
      const effFechaHora = u !== undefined ? u.fechaHora : m.fechaHora;
      const effSinHorario = u !== undefined ? u.sinHorarioAsignado : m.sinHorarioAsignado;
      if (effFechaHora && !effSinHorario) return false;
      const teniaHorarioAlInicio = Boolean(m.fechaHora && !m.sinHorarioAsignado);
      return teniaHorarioAlInicio || enMapaDiaAlInicio.has(m.id);
    });
  }

  function desasignarR32Automatico(partido, motivo) {
    updatesMap.set(partido.id, {
      id: partido.id,
      sinHorarioAsignado: true,
      fechaHora: null,
      canchaNumero: null,
    });
    registrarPartidoSinSlot(partido.id, motivo);
  }

  // Inicio de la disponibilidad del viernes de una pareja (null si no cargó horarios ese día)
  function inicioViernesPareja(pareja) {
    let inicio = null;
    for (const s of pareja?.slotsSeleccionados || []) {
      if (!s.slotId || !s.slotId.startsWith('Viernes-')) continue;
      const d = parseSlotToDate(s.slotId, refFecha);
      if (d && (inicio === null || d.getTime() < inicio)) inicio = d.getTime();
    }
    return inicio;
  }

  // Un partido de zona que pasa al sábado termina antes de lo que depende de él y no se reprograma en esta
  // corrida: el primer dieciseisavos de su categoría y, en MINI_BRACKET, los P3/P4 de su zona.
  const idsAAsignar = new Set(partidosAAsignar.map((p) => p.id));
  const primerR32PorCategoria = new Map();
  const primerRonda2PorZona = new Map();
  const guardarMinimo = (mapa, clave, t) => {
    const actual = mapa.get(clave);
    if (actual === undefined || t < actual) mapa.set(clave, t);
  };
  for (const p of todosLosPartidos) {
    if (idsAAsignar.has(p.id) || !p.fechaHora || p.sinHorarioAsignado) continue;
    const t = new Date(p.fechaHora).getTime();
    if (esR32(p)) guardarMinimo(primerR32PorCategoria, p.categoriaId, t);
    if (isMiniBracketRonda2(p)) guardarMinimo(primerRonda2PorZona, p.zonaId, t);
  }

  const TICK_MS = 15 * 60 * 1000;
  const redondearArriba = (ms) => (ms % TICK_MS === 0 ? ms : ms + TICK_MS - (ms % TICK_MS));

  // 4. Asignación Global Earliest-Fit para cada partido
  for (const partido of partidosAAsignar) {
    if (esR32Automatico(partido) && categoriaTieneZonaSinHorarioPorLluvia(partido.categoriaId)) {
      desasignarR32Automatico(partido, 'Sin horario porque la lluvia dejó partidos de zona de la categoría sin horario');
      continue;
    }

    const origStartMs = partido.fechaHora ? new Date(partido.fechaHora).getTime() : null;
    // Usar overrideTimestamp solo para calcular el día cuando el partido viene sin horario (recuperado de partidosSinSlot)
    const origDate = origStartMs
      ? new Date(origStartMs)
      : (overrideTimestamp ? new Date(overrideTimestamp) : parseFechaLocal(refFecha));
    const origDiaInfo = getDiaCalendarioConTrasnoche(origDate, organizador);
    const dayLimitMs = origDiaInfo.dayLimitMs;
    const isFriday = origDiaInfo.logicalDate.getDay() === 5;
    const sessionDayStartMs = isFriday ? friDayStartMs : satDayStartMs;

    const isMiniBracketR2 = isMiniBracketRonda2(partido);
    let ronda1SinHorario = false;

    // Para partidos de eliminatoria (dieciseisavos, etc.):
    // - No pueden arrancar antes de que finalicen las zonas de su categoría (catZoneFloorMs).
    // - Si ya tenían horario asignado por el organizador (origStartMs), respetarlo como piso mínimo para no adelantarse hacia el pasado.
    let minSearchMs = sessionDayStartMs;
    if (isMiniBracketR2) {
      const r1Info = getRonda1InfoZona(partido.zonaId, partido.id);
      ronda1SinHorario = r1Info.r1SinHorario;
      if (!ronda1SinHorario) {
        minSearchMs = Math.max(minSearchMs, r1Info.maxEndMs);
      }
    } else if (partido.faseEliminatoriaId) {
      const catZoneFloorMs = maxEndPorCategoriaZona.get(partido.categoriaId) || 0;
      minSearchMs = Math.max(minSearchMs, catZoneFloorMs);
      // Restauración (todas las canchas): un R32 automático que la lluvia dejó después del cierre del club
      // no usa su horario actual como piso, para poder volver dentro del horario. Si ya está dentro del
      // horario, conserva su horario actual como piso (no se adelantan horarios anunciados).
      const vuelveDentroDelHorario =
        esRestauracionTotal &&
        esR32Automatico(partido) &&
        origStartMs !== null &&
        minutosDespuesDelCierre(partido.fechaHora, organizador) > 0;
      if (origStartMs && !vuelveDentroDelHorario) {
        minSearchMs = Math.max(minSearchMs, origStartMs);
      }
      // R32: piso = max(ventana nocturna, fin de zonas de la categoría, horario original si lo tenía)
      if (esR32(partido)) {
        minSearchMs = Math.max(minSearchMs, sabNightStartMs);
      }
    }

    // Al reducir canchas se conservan los horarios ya avisados como piso. Se usa el horario de esta
    // corrida (también en una segunda reducción), no el registro original reservado para restaurar.
    if (!esRestauracionTotal && origStartMs !== null) {
      minSearchMs = Math.max(minSearchMs, origStartMs);
    }

    // Viernes con lluvia: el inicio de las parejas solo pone piso a los partidos sin horario previo.
    // Los que ya tienen horario conservan ese acuerdo como piso. Todos terminan antes del cierre del club.
    // En la restauración sin registro previo se conserva el comportamiento anterior.
    const lluviaViernes = isFriday && !esRestauracionTotal && !esR32(partido);
    if (lluviaViernes && origStartMs === null) {
      const pisosParejas = [inicioViernesPareja(partido.pareja1), inicioViernesPareja(partido.pareja2)]
        .filter((v) => v !== null);
      if (pisosParejas.length > 0) minSearchMs = Math.max(minSearchMs, ...pisosParejas);
    }
    const limiteBusquedaMs = lluviaViernes && cierreViernesMs ? Math.min(dayLimitMs, cierreViernesMs) : dayLimitMs;

    if (!esRestauracionTotal) {
      minSearchMs = Math.max(minSearchMs, proximoPorJornada.get(origDiaInfo.key) ?? sessionDayStartMs);
    }

    // Ajustar minSearchMs al tick de 15 minutos más cercano hacia arriba
    minSearchMs = redondearArriba(minSearchMs);

    let bestCandidate = null;
    let T = minSearchMs;

    // R32 reubicado: si su cancha original sigue activa, se prueba primero (evita cambios de cancha silenciosos).
    const canchaPreferida =
      esR32(partido) && partido.canchaNumero && partido.canchaNumero <= cantidadCanchas ? partido.canchaNumero : null;

    if (!ronda1SinHorario) {
      while (T + DURACION_MS <= limiteBusquedaMs) {
        const tEnd = T + DURACION_MS;
        if (
          canchaPreferida &&
          isCourtFree(canchaPreferida, T, tEnd) &&
          isPairFree(partido.pareja1Id, T, tEnd) &&
          isPairFree(partido.pareja2Id, T, tEnd)
        ) {
          bestCandidate = { T, cancha: canchaPreferida };
          break;
        }
        for (let c = 1; c <= cantidadCanchas; c++) {
          if (
            isCourtFree(c, T, tEnd) &&
            isPairFree(partido.pareja1Id, T, tEnd) &&
            isPairFree(partido.pareja2Id, T, tEnd)
          ) {
            bestCandidate = { T, cancha: c };
            break;
          }
        }
        if (bestCandidate !== null) break;
        T += 15 * 60 * 1000;
      }
    }

    // Lo que no entra el viernes pasa al sábado desde la apertura o, si empezó, su próximo pendiente; en las canchas
    // libres del sábado y sin que una pareja juegue dos a la vez. Un partido de zona termina antes del primer
    // dieciseisavos de su categoría.
    if (bestCandidate === null && lluviaViernes && !ronda1SinHorario) {
      const canchasSabado = Math.min(
        canchasOverridesService.getCanchasDia(torneoId, sabadoInfo.key, canchasClub).canchas,
        canchasClub
      );
      let pisoSabado = Math.max(satDayStartMs, proximoPorJornada.get(sabadoInfo.key) ?? satDayStartMs);
      if (isMiniBracketR2) pisoSabado = Math.max(pisoSabado, getRonda1InfoZona(partido.zonaId, partido.id).maxEndMs);
      let limiteSabado = sabadoInfo.dayLimitMs;
      const primerR32 = partido.zonaId ? primerR32PorCategoria.get(partido.categoriaId) : undefined;
      if (primerR32 !== undefined) limiteSabado = Math.min(limiteSabado, primerR32);
      const primerRonda2 = partido.zonaId && !isMiniBracketR2 ? primerRonda2PorZona.get(partido.zonaId) : undefined;
      if (primerRonda2 !== undefined) limiteSabado = Math.min(limiteSabado, primerRonda2);
      for (let T2 = redondearArriba(pisoSabado); bestCandidate === null && T2 + DURACION_MS <= limiteSabado; T2 += TICK_MS) {
        for (let c = 1; c <= canchasSabado; c++) {
          if (
            isCourtFree(c, T2, T2 + DURACION_MS) &&
            isPairFree(partido.pareja1Id, T2, T2 + DURACION_MS) &&
            isPairFree(partido.pareja2Id, T2, T2 + DURACION_MS)
          ) {
            bestCandidate = { T: T2, cancha: c };
            break;
          }
        }
      }
    }

    if (bestCandidate !== null) {
      addInterval(bestCandidate.cancha, partido.pareja1Id, partido.pareja2Id, bestCandidate.T, bestCandidate.T + DURACION_MS);
      if (partido.zonaId) {
        const newEnd = bestCandidate.T + DURACION_MS;
        const currentMax = maxEndPorCategoriaZona.get(partido.categoriaId) || 0;
        if (newEnd > currentMax) {
          maxEndPorCategoriaZona.set(partido.categoriaId, newEnd);
        }
      }
      partidosSinSlotMotivos.delete(partido.id);
      updatesMap.set(partido.id, {
        id: partido.id,
        sinHorarioAsignado: false,
        fechaHora: new Date(bestCandidate.T),
        canchaNumero: bestCandidate.cancha,
      });
    } else {
      // Si no hay slot libre antes de dayLimitMs:
      // Si es un cruce de eliminatoria sin parejas definidas, NO borrar horario ni cancha: queda como está
      // y se reporta en el aviso naranja con motivo "Sin cancha activa libre disponible en ese horario".
      // Si es un partido de zona (con parejas o P3/P4 de MINI_BRACKET), se limpia su horario y se registra en partidosSinSlot.
      // Un R32 automático nunca conserva su horario viejo: queda sin horario y en partidosSinSlot.
      if (esR32Automatico(partido)) {
        desasignarR32Automatico(partido, 'Sin cancha activa libre disponible en ese horario');
      } else if (partido.faseEliminatoriaId && (!partido.pareja1Id || !partido.pareja2Id)) {
        registrarPartidoSinSlot(partido.id, 'Sin cancha activa libre disponible en ese horario');
      } else {
        const fechaPrevia = fechaHoraPreviaPorPartido.get(partido.id);
        const diaPrevioKey = fechaPrevia ? getDiaCalendarioConTrasnoche(fechaPrevia, organizador)?.key : null;
        if (overrideDiaKey && diaPrevioKey && diaPrevioKey !== overrideDiaKey) {
          console.warn(
            `[Modo Lluvia Guard] Bug interno detectado: intento de desasignar partido ${partido.id} de '${diaPrevioKey}' durante override de '${overrideDiaKey}'. Se omite la desasignación.`
          );
        } else {
          updatesMap.set(partido.id, {
            id: partido.id,
            sinHorarioAsignado: true,
            fechaHora: null,
            canchaNumero: null,
          });
          registrarPartidoSinSlot(
            partido.id,
            ronda1SinHorario
              ? 'Sin horario disponible porque Ronda 1 (P1/P2) quedó sin horario asignado'
              : 'Sin cancha activa libre disponible en ese horario'
          );
        }
      }
    }
  }

  // 5. Calcular diffs y métricas de cambio
  const updates = Array.from(updatesMap.values());
  const cambios = [];
  let partidosReprogramados = 0;
  let partidosSinCambio = 0;
  let partidosSinHorarioNuevo = 0;

  function formatParejaNombre(p, origen) {
    if (p) return `${p.jugador1} / ${p.jugador2}`;
    if (origen) return origen;
    return 'Por definirse';
  }

  for (const u of updates) {
    const original = todosLosPartidos.find((p) => p.id === u.id);
    const origStartMs = original?.fechaHora ? new Date(original.fechaHora).getTime() : null;
    const origCancha = original?.canchaNumero;

    if (u.sinHorarioAsignado || !u.fechaHora) {
      partidosSinHorarioNuevo++;
      partidosReprogramados++;
      cambios.push({
        partidoId: u.id,
        pareja1: formatParejaNombre(original?.pareja1, original?.origenPareja1),
        pareja2: formatParejaNombre(original?.pareja2, original?.origenPareja2),
        categoria: original?.categoria?.nombre || '',
        antes: { fechaHora: original?.fechaHora ? new Date(original.fechaHora).toISOString() : null, canchaNumero: origCancha },
        despues: { fechaHora: null, canchaNumero: null, sinHorarioAsignado: true },
      });
    } else {
      const newStartMs = u.fechaHora.getTime();
      const cambioHorario = !origStartMs || newStartMs !== origStartMs;
      if (cambioHorario) {
        partidosReprogramados++;
        cambios.push({
          partidoId: u.id,
          pareja1: formatParejaNombre(original?.pareja1, original?.origenPareja1),
          pareja2: formatParejaNombre(original?.pareja2, original?.origenPareja2),
          categoria: original?.categoria?.nombre || '',
          antes: { fechaHora: original?.fechaHora ? new Date(original.fechaHora).toISOString() : null, canchaNumero: origCancha },
          despues: { fechaHora: u.fechaHora.toISOString(), canchaNumero: u.canchaNumero },
        });
      } else {
        partidosSinCambio++;
      }
    }
  }

  // 6. Persistir en base de datos
  if (updates.length > 0) {
    for (const u of updates) {
      await db.partido.update({
        where: { id: u.id },
        data: {
          fechaHora: u.fechaHora,
          canchaNumero: u.canchaNumero,
          sinHorarioAsignado: u.sinHorarioAsignado,
        },
      });
    }
  }

  return {
    partidosReprogramados,
    partidosSinCambio,
    partidosSinHorarioNuevo,
    partidosSinSlot: Object.fromEntries(partidosSinSlotMotivos),
    cambios,
    total: updates.length,
  };
}

/**
 * Restaura una jornada (viernes o sábado) después de la lluvia. Cada partido PENDIENTE del registro
 * horariosAntesLluvia vuelve a su horario de antes de la lluvia si no es anterior al próximo pendiente de
 * su jornada original (excluyendo el registro) y la cancha y las dos parejas están libres.
 * Si la jornada no empezó (sin FINALIZADO ni EN_CURSO), se toma su apertura como piso.
 * Si no se puede, earliest-fit desde max(ese horario, próximo pendiente)
 * en su jornada original (el viernes hasta el cierre del club; el sábado hasta el límite de trasnoche).
 * Solo se toma una alternativa que adelante el horario actual; si no hay lugar, se conserva.
 * FINALIZADO, EN_CURSO y los partidos fuera del registro no se tocan.
 * Los P3/P4 de MINI_BRACKET quedan después de la ronda 1 de su zona y los dieciseisavos después de las zonas.
 */
async function restaurarHorariosAntesLluvia(organizadorId, torneoId, diaKey, registro, externalTx = null) {
  const db = externalTx || prisma;

  const torneo = await db.torneo.findUnique({ where: { id: torneoId }, include: { organizador: true } });
  if (!torneo || torneo.organizadorId !== organizadorId) {
    const error = new Error('Torneo no encontrado o no autorizado.');
    error.statusCode = 404;
    throw error;
  }

  const organizador = torneo.organizador;
  const canchasClub = organizador.cantidadCanchas || 1;
  const DURACION_MS = DURACION_PARTIDO_MIN * 60 * 1000;
  const TICK_MS = 15 * 60 * 1000;
  const redondearArriba = (ms) => (ms % TICK_MS === 0 ? ms : ms + TICK_MS - (ms % TICK_MS));

  const diaInfo = getDiaCalendarioConTrasnoche(parseFechaLocal(diaKey), organizador);
  const esViernes = diaInfo.logicalDate.getDay() === 5;
  const medianoche = new Date(diaInfo.logicalDate);
  medianoche.setHours(0, 0, 0, 0);
  const inicioJornadaMs = medianoche.getTime()
    + horaAMinutos(esViernes ? organizador.viernesInicio : organizador.sabadoInicio) * 60 * 1000;
  const cierreViernesMs = esViernes
    ? calcularFinJornadaMs(medianoche.getTime(), organizador.viernesInicio, organizador.viernesFin)
    : null;
  const limiteMs = cierreViernesMs ? Math.min(diaInfo.dayLimitMs, cierreViernesMs) : diaInfo.dayLimitMs;

  const partidos = await db.partido.findMany({
    where: { categoria: { torneoId } },
    include: {
      categoria: { select: { nombre: true } },
      zona: { select: { formato: true } },
      faseEliminatoria: { select: { ronda: true } },
      pareja1: { select: { jugador1: true, jugador2: true } },
      pareja2: { select: { jugador1: true, jugador2: true } },
    },
  });

  const aRestaurar = partidos.filter((p) => p.estado === 'PENDIENTE' && registro[p.id]);
  const idsRestaurar = new Set(aRestaurar.map((p) => p.id));
  const jornadaEmpezada = partidos.some((p) => !p.esBye && p.fechaHora
    && (p.estado === 'FINALIZADO' || p.estado === 'EN_CURSO')
    && getDiaCalendarioConTrasnoche(p.fechaHora, organizador)?.key === diaKey);
  // Se toma antes de mover nada y sin contar los pendientes que vuelven desde el registro.
  const proximoJornadaMs = partidos.reduce((minimo, p) => {
    if (p.estado !== 'PENDIENTE' || idsRestaurar.has(p.id) || p.esBye || !p.fechaHora || p.sinHorarioAsignado) return minimo;
    if (getDiaCalendarioConTrasnoche(p.fechaHora, organizador)?.key !== diaKey) return minimo;
    return Math.min(minimo, new Date(p.fechaHora).getTime());
  }, Infinity);
  // Sin empezar o sin otro pendiente en la jornada original, se puede volver desde su apertura.
  const pisoJornadaMs = jornadaEmpezada && proximoJornadaMs !== Infinity ? proximoJornadaMs : inicioJornadaMs;

  // Ocupación: todo lo que tiene horario y no se restaura (finalizados, en juego y los demás pendientes)
  const canchas = new Map();
  for (let c = 1; c <= canchasClub; c++) canchas.set(c, []);
  const parejas = new Map();
  function ocupar(p, startMs, cancha) {
    if (cancha && canchas.has(cancha)) canchas.get(cancha).push([startMs, startMs + DURACION_MS, p.id]);
    for (const pid of [p.pareja1Id, p.pareja2Id]) {
      if (!pid) continue;
      if (!parejas.has(pid)) parejas.set(pid, []);
      parejas.get(pid).push([startMs, startMs + DURACION_MS, p.id]);
    }
  }
  for (const p of partidos) {
    if (idsRestaurar.has(p.id) || p.esBye || !p.fechaHora || p.sinHorarioAsignado) continue;
    ocupar(p, new Date(p.fechaHora).getTime(), p.canchaNumero);
  }
  function liberar(p) {
    for (const [c, lista] of canchas) canchas.set(c, lista.filter(([, , id]) => id !== p.id));
    for (const pid of [p.pareja1Id, p.pareja2Id]) {
      if (parejas.has(pid)) parejas.set(pid, parejas.get(pid).filter(([, , id]) => id !== p.id));
    }
  }
  const libre = (lista, s, excluirId = null) => !(lista || []).some(([a, b, id]) => id !== excluirId && s < b && s + DURACION_MS > a);
  const parejasLibres = (p, s) => [p.pareja1Id, p.pareja2Id].every((pid) => !pid || libre(parejas.get(pid), s, p.id));

  // Inicio efectivo de un partido: el nuevo si ya se restauró, undefined si todavía falta ubicarlo
  const ubicados = new Map();
  function inicioEfectivo(m) {
    if (idsRestaurar.has(m.id)) return ubicados.has(m.id) ? ubicados.get(m.id) : undefined;
    return m.fechaHora && !m.sinHorarioAsignado ? new Date(m.fechaHora).getTime() : null;
  }
  // Piso por dependencias (undefined si alguna todavía no se ubicó)
  function pisoDependencias(p) {
    let deps = [];
    if (p.zonaId && p.zona?.formato === 'MINI_BRACKET' && (p.posicionEnRonda === 3 || p.posicionEnRonda === 4)) {
      deps = partidos.filter((m) => m.zonaId === p.zonaId && m.posicionEnRonda != null && m.posicionEnRonda <= 2);
    } else if (p.faseEliminatoriaId && !p.esBye && (p.faseEliminatoria?.ronda || 0) >= 32) {
      deps = partidos.filter((m) => m.zonaId && m.categoriaId === p.categoriaId && !m.esBye);
    }
    let piso = 0;
    for (const m of deps) {
      const s = inicioEfectivo(m);
      if (s === undefined) return undefined;
      if (s !== null) piso = Math.max(piso, s + DURACION_MS);
    }
    return piso;
  }

  const inicioOriginal = (p) => {
    const o = registro[p.id];
    return o.fechaHora && !o.sinHorarioAsignado ? new Date(o.fechaHora).getTime() : null;
  };
  const orden = [...aRestaurar].sort((a, b) => {
    const ta = inicioOriginal(a) ?? Infinity;
    const tb = inicioOriginal(b) ?? Infinity;
    if (ta !== tb) return ta - tb;
    const ca = registro[a.id].canchaNumero || 0;
    const cb = registro[b.id].canchaNumero || 0;
    if (ca !== cb) return ca - cb;
    return a.id.localeCompare(b.id);
  });

  const nuevos = new Map();
  function fijar(p, startMs, cancha) {
    ocupar(p, startMs, cancha);
    ubicados.set(p.id, startMs);
    nuevos.set(p.id, { fechaHora: new Date(startMs), canchaNumero: cancha, sinHorarioAsignado: false });
  }
  const inicioActual = (p) => p.fechaHora && !p.sinHorarioAsignado ? new Date(p.fechaHora).getTime() : null;
  function conservar(p) {
    const actual = inicioActual(p);
    if (actual !== null) ocupar(p, actual, p.canchaNumero);
    ubicados.set(p.id, actual);
    nuevos.set(p.id, { fechaHora: p.fechaHora, canchaNumero: p.canchaNumero, sinHorarioAsignado: p.sinHorarioAsignado });
  }

  // 1. Vuelven a su horario original los que pueden
  const sinLugar = new Set();
  for (const p of orden) {
    const original = registro[p.id];
    const s = inicioOriginal(p);
    if (s === null) {
      conservar(p);
      continue;
    }
    const piso = pisoDependencias(p);
    const cancha = original.canchaNumero;
    if (
      piso !== undefined && s >= piso &&
      s >= pisoJornadaMs && (inicioActual(p) === null || s <= inicioActual(p)) &&
      cancha && canchas.has(cancha) &&
      libre(canchas.get(cancha), s) && parejasLibres(p, s)
    ) {
      fijar(p, s, cancha);
    } else {
      sinLugar.add(p.id);
    }
  }

  // Reservar los turnos actuales de quienes no pudieron volver. Si bloquean una vuelta propuesta,
  // se descarta esa propuesta y se reserva también su turno actual, hasta estabilizar la ocupación.
  // Esto permite volver en bloque a los originales sin perder la posibilidad de quedarse donde estaban.
  for (const p of orden) {
    if (sinLugar.has(p.id)) conservar(p);
  }
  let revisar = true;
  while (revisar) {
    revisar = false;
    for (const p of orden) {
      if (sinLugar.has(p.id) || inicioOriginal(p) === null) continue;
      const n = nuevos.get(p.id);
      const s = n.fechaHora.getTime();
      const piso = pisoDependencias(p);
      if (piso === undefined || s < piso || !libre(canchas.get(n.canchaNumero), s, p.id) || !parejasLibres(p, s)) {
        liberar(p);
        conservar(p);
        sinLugar.add(p.id);
        revisar = true;
      }
    }
  }

  // 2. El resto: earliest-fit en su jornada, solo si adelanta el turno actual.
  for (const p of orden) {
    if (!sinLugar.has(p.id)) continue;
    liberar(p);
    const preferida = registro[p.id].canchaNumero;
    const ordenCanchas = [...canchas.keys()].sort((a, b) => (a === preferida ? -1 : b === preferida ? 1 : a - b));
    const piso = pisoDependencias(p);
    let T = redondearArriba(Math.max(inicioOriginal(p), pisoJornadaMs, piso || 0, inicioJornadaMs));
    let elegido = null;
    for (; piso !== undefined && elegido === null && T + DURACION_MS <= limiteMs
      && (inicioActual(p) === null || T < inicioActual(p)); T += TICK_MS) {
      if (!parejasLibres(p, T)) continue;
      const c = ordenCanchas.find((n) => libre(canchas.get(n), T));
      if (c) elegido = { T, cancha: c };
    }
    if (elegido) {
      fijar(p, elegido.T, elegido.cancha);
    } else {
      conservar(p);
    }
  }

  // 3. Cambios respecto del horario actual y escritura
  const nombre = (pareja, origen) => (pareja ? `${pareja.jugador1} / ${pareja.jugador2}` : origen || 'Por definirse');
  const cambios = [];
  let partidosReprogramados = 0;
  let partidosSinCambio = 0;
  let partidosSinHorarioNuevo = 0;
  for (const p of orden) {
    const n = nuevos.get(p.id);
    const antesMs = p.fechaHora ? new Date(p.fechaHora).getTime() : null;
    const despuesMs = n.fechaHora ? n.fechaHora.getTime() : null;
    if (n.sinHorarioAsignado || !n.fechaHora) partidosSinHorarioNuevo++;
    const igual = antesMs === despuesMs && (p.canchaNumero ?? null) === (n.canchaNumero ?? null)
      && Boolean(p.sinHorarioAsignado) === Boolean(n.sinHorarioAsignado);
    if (igual) {
      partidosSinCambio++;
      continue;
    }
    partidosReprogramados++;
    cambios.push({
      partidoId: p.id,
      pareja1: nombre(p.pareja1, p.origenPareja1),
      pareja2: nombre(p.pareja2, p.origenPareja2),
      categoria: p.categoria?.nombre || '',
      antes: { fechaHora: p.fechaHora ? new Date(p.fechaHora).toISOString() : null, canchaNumero: p.canchaNumero },
      despues: n.fechaHora && !n.sinHorarioAsignado
        ? { fechaHora: n.fechaHora.toISOString(), canchaNumero: n.canchaNumero }
        : { fechaHora: null, canchaNumero: null, sinHorarioAsignado: true },
    });
    await db.partido.update({ where: { id: p.id }, data: n });
  }

  return {
    partidosReprogramados,
    partidosSinCambio,
    partidosSinHorarioNuevo,
    partidosSinSlot: {},
    cambios,
    total: orden.length,
  };
}

/**
 * Obtiene las zonas de una categoría con sus posiciones y partidos
 */
async function getZonasByCategoria(organizadorId, categoriaId) {
  await getCategoriaById(organizadorId, categoriaId);

  const zonas = await prisma.zona.findMany({
    where: { categoriaId },
    include: {
      zonaParejas: {
        include: {
          pareja: true,
        },
        orderBy: [
          { posicion: 'asc' },
          { puntos: 'desc' },
          { pg: 'desc' },
        ],
      },
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
    orderBy: { nombre: 'asc' },
  });
  const { resolverPosicionesZona } = require('./faseEliminatoria.service');
  return zonas.map(zona => {
    const { ordenadas, empatePendiente } = resolverPosicionesZona(zona.zonaParejas, zona.formato, zona.partidos);
    return { ...zona, zonaParejas: ordenadas, empatePendiente };
  });
}

async function resolverDesempateZona(organizadorId, categoriaId, zonaId, orden) {
  return prisma.$transaction(async (tx) => {
    const categoria = await getCategoriaById(organizadorId, categoriaId, tx);
    const { exigirTorneoNoFinalizado } = require('./torneo.service');
    exigirTorneoNoFinalizado(categoria.torneo);
    const rechazar = mensaje => {
      const error = new Error(mensaje);
      error.statusCode = 400;
      throw error;
    };
    const zona = await tx.zona.findUnique({ where: { id: zonaId }, include: { zonaParejas: true, partidos: true } });
    if (!zona || zona.categoriaId !== categoriaId) rechazar('La zona no pertenece a esta categoría.');
    if (zona.formato !== 'ROUND_ROBIN') rechazar('El desempate manual solo corresponde a zonas de todos contra todos.');
    if (!zona.partidos.length || zona.partidos.some(p => p.estado !== 'FINALIZADO')) {
      rechazar('Terminá todos los partidos de la zona antes de resolver el desempate.');
    }
    const { resolverPosicionesZona } = require('./faseEliminatoria.service');
    const { empatePendiente } = resolverPosicionesZona(zona.zonaParejas, zona.formato, zona.partidos);
    if (!empatePendiente.length) rechazar('La zona no tiene un empate pendiente de resolver.');
    if (!Array.isArray(orden) || orden.length !== empatePendiente.length
      || new Set(orden).size !== orden.length || orden.some(id => typeof id !== 'string' || !empatePendiente.includes(id))) {
      rechazar('Elegí exactamente las parejas empatadas, sin repetir, en el orden que definiste.');
    }
    await tx.zonaPareja.updateMany({ where: { zonaId }, data: { posicion: 0 } });
    for (let i = 0; i < orden.length; i++) {
      await tx.zonaPareja.update({ where: { zonaId_parejaId: { zonaId, parejaId: orden[i] } }, data: { posicion: i + 1 } });
    }
    const { verificarYAutoAsignarEliminatoria } = require('./partido.service');
    await verificarYAutoAsignarEliminatoria(organizadorId, categoriaId, tx, true);
    await recalcularEstadosPorPartido(tx, categoriaId);
    return { message: 'Desempate guardado.', zonaId, orden, empatePendiente: [] };
  }, { maxWait: 10000, timeout: 30000 });
}

/**
 * Limpia todos los resultados de las zonas de una categoría
 */
async function limpiarResultadosZonas(organizadorId, categoriaId) {
  await getCategoriaById(organizadorId, categoriaId);

  await prisma.$transaction(async (tx) => {
    const partidosZonas = await tx.partido.findMany({
      where: { categoriaId, zonaId: { not: null } },
    });
    const partidoIds = partidosZonas.map((p) => p.id);

    if (partidoIds.length > 0) {
      await tx.setPartido.deleteMany({
        where: { partidoId: { in: partidoIds } },
      });

      await tx.partido.updateMany({
        where: { id: { in: partidoIds } },
        data: { estado: 'PENDIENTE', ganadorId: null, enJuegoDesde: null },
      });

      const zonasMiniBracket = await tx.zona.findMany({
        where: { categoriaId, formato: 'MINI_BRACKET' },
      });
      if (zonasMiniBracket.length > 0) {
        await tx.partido.updateMany({
          where: {
            id: { in: partidoIds },
            zonaId: { in: zonasMiniBracket.map((z) => z.id) },
            posicionEnRonda: { in: [3, 4] },
          },
          data: { pareja1Id: null, pareja2Id: null, origenPareja1: null, origenPareja2: null },
        });
      }
    }

    const zonas = await tx.zona.findMany({ where: { categoriaId } });
    if (zonas.length > 0) {
      await tx.zonaPareja.updateMany({
        where: { zonaId: { in: zonas.map((z) => z.id) } },
        data: {
          pj: 0,
          pg: 0,
          pp: 0,
          sf: 0,
          sc: 0,
          gf: 0,
          gc: 0,
          puntos: 0,
          posicion: 0,
        },
      });
    }

    const faseViejas = await tx.faseEliminatoria.findMany({ where: { categoriaId } });
    if (faseViejas.length > 0) {
      await tx.partido.deleteMany({
        where: { faseEliminatoriaId: { in: faseViejas.map((f) => f.id) } },
      });
      await tx.faseEliminatoria.deleteMany({ where: { categoriaId } });
    }
    await recalcularEstadosPorPartido(tx, categoriaId);
  });

  return { message: 'Resultados de zonas reseteados.' };
}

/**
 * Evalúa compatibilidad pairwise entre parejas de una zona en función de sus slots.
 * Retorna true si hay al menos un par con slots incompatibles (requiereArmadoManual = true).
 * Si alguna pareja no tiene slots seleccionados (disponibilidad libre), no genera conflicto.
 */
function evaluarCompatibilidadZona(parejasConSlots) {
  for (let i = 0; i < parejasConSlots.length; i++) {
    for (let j = i + 1; j < parejasConSlots.length; j++) {
      const s1 = parejasConSlots[i].slots;
      const s2 = parejasConSlots[j].slots;
      if (s1 && s2 && s1.length > 0 && s2.length > 0) {
        const shared = s1.filter((slot) => s2.includes(slot));
        if (shared.length === 0) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Regenera de forma segura los partidos de una zona afectada.
 * - Recalcula formato y clasifican según la cantidad actual de parejas (4: MINI_BRACKET, 2 o 3: ROUND_ROBIN).
 * - Reevalúa y persiste requiereArmadoManual según compatibilidad horaria real.
 * - Elimina los partidos PENDIENTE anteriores de la zona (y sus SetPartido asociados).
 * - Crea los nuevos partidos mediante generarPartidosZonaHelper.
 */
async function regenerarPartidosZona(tx, categoriaId, zonaId) {
  // Orden explícito (sesión 81): define los cruces (P1 = [0] vs [1], P2 = [2] vs [3] en mini-bracket).
  // Sin orderBy SQLite las devolvía por el índice (zonaId, parejaId), en orden de UUID.
  const zonaParejas = await tx.zonaPareja.findMany({
    where: { zonaId },
    orderBy: [{ pareja: { orden: 'asc' } }, { parejaId: 'asc' }],
    include: {
      pareja: {
        include: { slotsSeleccionados: true },
      },
    },
  });

  const size = zonaParejas.length;
  if (size < 2 || size > 4) {
    const error = new Error(`La zona tiene ${size} parejas. Solo se permiten zonas de 2, 3 o 4 parejas.`);
    error.statusCode = 400;
    throw error;
  }

  const formato = size === 4 ? 'MINI_BRACKET' : 'ROUND_ROBIN';
  const clasifican = size === 4 ? 3 : 2;

  const parejasParaCompat = zonaParejas.map((zp) => ({
    id: zp.pareja.id,
    slots: (zp.pareja.slotsSeleccionados || []).map((s) => s.slotId),
  }));
  const requiereArmadoManual = evaluarCompatibilidadZona(parejasParaCompat);

  await tx.zona.update({
    where: { id: zonaId },
    data: {
      formato,
      clasifican,
      requiereArmadoManual,
    },
  });

  const existingPartidos = await tx.partido.findMany({
    where: { zonaId },
    select: { id: true },
  });
  const ids = existingPartidos.map((p) => p.id);
  if (ids.length > 0) {
    await tx.setPartido.deleteMany({
      where: { partidoId: { in: ids } },
    });
    await tx.partido.deleteMany({
      where: { id: { in: ids } },
    });
  }

  const parejasEnEstaZona = zonaParejas.map((zp) => zp.pareja);
  await generarPartidosZonaHelper(tx, categoriaId, zonaId, formato, size, parejasEnEstaZona, {
    sinHorarioAsignado: Boolean(requiereArmadoManual),
  });
  await recalcularEstadosPorPartido(tx, categoriaId);
}

/**
 * Mueve una pareja de una zona de origen a una zona de destino post-inicio de torneo.
 * Operación transaccional con guards estrictos de estado (solo si todos los partidos están PENDIENTE).
 */
async function moverParejaDeZona(organizadorId, categoriaId, { parejaId, zonaOrigenId, zonaDestinoId }) {
  if (!categoriaId || !parejaId || !zonaOrigenId || !zonaDestinoId) {
    const error = new Error('Faltan parámetros requeridos: parejaId, zonaOrigenId y zonaDestinoId son obligatorios.');
    error.statusCode = 400;
    throw error;
  }

  if (zonaOrigenId === zonaDestinoId) {
    const error = new Error('La zona de origen y la de destino deben ser diferentes.');
    error.statusCode = 400;
    throw error;
  }

  // 1. Validaciones previas
  const categoria = await getCategoriaById(organizadorId, categoriaId);
  if (categoria.estado !== 'EN_CURSO') {
    const error = new Error('La categoría debe estar en estado EN_CURSO para mover parejas.');
    error.statusCode = 400;
    throw error;
  }
  if (categoria.torneo?.estado !== 'EN_CURSO') {
    const error = new Error('El torneo debe estar en estado EN_CURSO para mover parejas.');
    error.statusCode = 400;
    throw error;
  }

  const zonaOrigen = await prisma.zona.findUnique({
    where: { id: zonaOrigenId },
    include: {
      zonaParejas: true,
      partidos: true,
    },
  });
  if (!zonaOrigen || zonaOrigen.categoriaId !== categoriaId) {
    const error = new Error('La zona de origen no pertenece a esta categoría.');
    error.statusCode = 404;
    throw error;
  }

  const zonaDestino = await prisma.zona.findUnique({
    where: { id: zonaDestinoId },
    include: {
      zonaParejas: true,
      partidos: true,
    },
  });
  if (!zonaDestino || zonaDestino.categoriaId !== categoriaId) {
    const error = new Error('La zona de destino no pertenece a esta categoría.');
    error.statusCode = 404;
    throw error;
  }

  const perteneceOrigen = zonaOrigen.zonaParejas.some((zp) => zp.parejaId === parejaId);
  if (!perteneceOrigen) {
    const error = new Error('La pareja no pertenece a la zona de origen especificada.');
    error.statusCode = 400;
    throw error;
  }

  if (zonaOrigen.zonaParejas.length <= 2) {
    const error = new Error(`No se puede mover la pareja: la ${zonaOrigen.nombre} quedaría con menos de 2 parejas.`);
    error.statusCode = 400;
    throw error;
  }

  if (zonaDestino.zonaParejas.length >= 4) {
    const error = new Error(`No se puede mover la pareja: la ${zonaDestino.nombre} ya tiene el máximo permitido de 4 parejas.`);
    error.statusCode = 400;
    throw error;
  }

  const partidoNoPendienteOrigen = zonaOrigen.partidos.find((p) => p.estado !== 'PENDIENTE');
  if (partidoNoPendienteOrigen) {
    const error = new Error(`No se puede modificar la ${zonaOrigen.nombre} porque tiene partidos en curso o finalizados.`);
    error.statusCode = 400;
    throw error;
  }

  const partidoNoPendienteDestino = zonaDestino.partidos.find((p) => p.estado !== 'PENDIENTE');
  if (partidoNoPendienteDestino) {
    const error = new Error(`No se puede modificar la ${zonaDestino.nombre} porque tiene partidos en curso o finalizados.`);
    error.statusCode = 400;
    throw error;
  }

  const countOrigenActual = zonaOrigen.zonaParejas.length;
  const countDestinoActual = zonaDestino.zonaParejas.length;
  const clasificanOrigenNuevo = (countOrigenActual - 1) === 4 ? 3 : 2;
  const clasificanDestinoNuevo = (countDestinoActual + 1) === 4 ? 3 : 2;
  const cambiaClasifican =
    clasificanOrigenNuevo !== zonaOrigen.clasifican ||
    clasificanDestinoNuevo !== zonaDestino.clasifican;

  if (cambiaClasifican) {
    const partidosEliminatoriaJugados = await prisma.partido.count({
      where: {
        categoriaId,
        faseEliminatoriaId: { not: null },
        estado: { not: 'PENDIENTE' },
      },
    });
    if (partidosEliminatoriaJugados > 0) {
      const error = new Error('No se puede modificar la zona porque cambiaría los clasificados y el cuadro eliminatorio ya está en juego.');
      error.statusCode = 400;
      throw error;
    }
  }

  // 2. Transacción atómica
  return await prisma.$transaction(async (tx) => {
    // RE-CHEQUEO ATÓMICO DE GUARDS DENTRO DE LA TRANSACCIÓN
    const catCheck = await tx.categoria.findUnique({
      where: { id: categoriaId },
      include: { torneo: true },
    });
    if (!catCheck || catCheck.estado !== 'EN_CURSO' || catCheck.torneo?.estado !== 'EN_CURSO') {
      const error = new Error('La categoría o el torneo ya no se encuentran en estado EN_CURSO.');
      error.statusCode = 400;
      throw error;
    }

    if (cambiaClasifican) {
      const partidosEliminatoriaJugadosTx = await tx.partido.count({
        where: {
          categoriaId,
          faseEliminatoriaId: { not: null },
          estado: { not: 'PENDIENTE' },
        },
      });
      if (partidosEliminatoriaJugadosTx > 0) {
        const error = new Error('No se puede modificar la zona porque cambiaría los clasificados y el cuadro eliminatorio ya está en juego.');
        error.statusCode = 400;
        throw error;
      }
    }

    const partidosNoPendientes = await tx.partido.findMany({
      where: {
        zonaId: { in: [zonaOrigenId, zonaDestinoId] },
        estado: { not: 'PENDIENTE' },
      },
    });
    if (partidosNoPendientes.length > 0) {
      const error = new Error('Operación cancelada: una o más zonas involucradas tienen partidos en curso o finalizados.');
      error.statusCode = 400;
      throw error;
    }

    const zpOrigen = await tx.zonaPareja.findUnique({
      where: { zonaId_parejaId: { zonaId: zonaOrigenId, parejaId } },
    });
    if (!zpOrigen) {
      const error = new Error('La pareja ya no se encuentra en la zona de origen.');
      error.statusCode = 400;
      throw error;
    }

    const countOrigen = await tx.zonaPareja.count({ where: { zonaId: zonaOrigenId } });
    if (countOrigen <= 2) {
      const error = new Error('La zona de origen quedaría con menos de 2 parejas.');
      error.statusCode = 400;
      throw error;
    }

    const countDestino = await tx.zonaPareja.count({ where: { zonaId: zonaDestinoId } });
    if (countDestino >= 4) {
      const error = new Error('La zona de destino ya tiene 4 parejas.');
      error.statusCode = 400;
      throw error;
    }

    // Ejecutar reubicación
    await tx.zonaPareja.delete({
      where: { zonaId_parejaId: { zonaId: zonaOrigenId, parejaId } },
    });

    await tx.zonaPareja.create({
      data: {
        zonaId: zonaDestinoId,
        parejaId,
        pg: 0,
        pp: 0,
        sf: 0,
        sc: 0,
        gf: 0,
        gc: 0,
        puntos: 0,
        posicion: 0,
      },
    });

    // Regenerar partidos de ambas zonas
    await regenerarPartidosZona(tx, categoriaId, zonaOrigenId);
    await regenerarPartidosZona(tx, categoriaId, zonaDestinoId);

    // Asignar horarios a los partidos nuevos dentro de la transacción externa
    await asignarHorariosAutomatico(organizadorId, [categoriaId], tx);

    let cuadroDesactualizado = false;
    try {
      const { estadoCuadro } = require('./faseEliminatoria.service');
      const est = await estadoCuadro(categoriaId, tx);
      cuadroDesactualizado = est.desactualizado;
    } catch (_) {
      cuadroDesactualizado = cambiaClasifican;
    }

    return {
      message: 'Pareja movida de zona correctamente.',
      categoriaId,
      zonaOrigenId,
      zonaDestinoId,
      parejaId,
      cuadroDesactualizado,
    };
  });
}

/**
 * Agrega una nueva pareja a una zona existente post-inicio de torneo (alta tardía).
 * Crea la pareja y su asignación en la zona, regenera partidos y reasigna horarios atómicamente.
 */
async function agregarParejaAZona(organizadorId, categoriaId, { zonaDestinoId, jugador1, jugador2, slotIds = [] }) {
  if (!categoriaId || !zonaDestinoId || !jugador1 || !jugador2) {
    const error = new Error('Faltan parámetros requeridos: zonaDestinoId, jugador1 y jugador2 son obligatorios.');
    error.statusCode = 400;
    throw error;
  }

  const j1 = String(jugador1).trim();
  const j2 = String(jugador2).trim();
  if (!j1 || !j2) {
    const error = new Error('Los nombres de los jugadores no pueden estar vacíos.');
    error.statusCode = 400;
    throw error;
  }

  if (!slotIds || !Array.isArray(slotIds) || slotIds.length === 0) {
    const error = new Error('La disponibilidad horaria de la pareja es obligatoria.');
    error.statusCode = 400;
    throw error;
  }

  let cleanSlotIds = [...new Set(slotIds)];

  // 1. Validaciones previas
  const categoria = await getCategoriaById(organizadorId, categoriaId);
  if (categoria.estado !== 'EN_CURSO') {
    const error = new Error('La categoría debe estar en estado EN_CURSO para agregar parejas.');
    error.statusCode = 400;
    throw error;
  }
  if (categoria.torneo?.estado !== 'EN_CURSO') {
    const error = new Error('El torneo debe estar en estado EN_CURSO para agregar parejas.');
    error.statusCode = 400;
    throw error;
  }

  const organizador = categoria.torneo?.organizador;
  if (!organizador) {
    const error = new Error('Organizador no encontrado.');
    error.statusCode = 404;
    throw error;
  }

  // Validación de slotIds contra formato "Dia-HH:mm" y contra los días/horarios del club
  if (cleanSlotIds.length > 0) {
    const SLOT_FORMAT_REGEX = /^(Viernes|Sabado)-\d{2}:\d{2}$/;
    const validSlotsSet = getSlotsValidosSet(organizador);

    for (const s of cleanSlotIds) {
      if (typeof s !== 'string' || !SLOT_FORMAT_REGEX.test(s)) {
        const error = new Error(`Formato de slot inválido o día no permitido: '${s}'. Solo se pueden seleccionar horarios de Viernes o Sábado para zonas ('Dia-HH:mm').`);
        error.statusCode = 400;
        throw error;
      }
      if (!validSlotsSet.has(s)) {
        const error = new Error(`El slot '${s}' no corresponde a los días y horarios configurados del club.`);
        error.statusCode = 400;
        throw error;
      }
    }
    cleanSlotIds = ordenarSlotsCronologicamente(cleanSlotIds);
  }

  const zonaDestino = await prisma.zona.findUnique({
    where: { id: zonaDestinoId },
    include: {
      zonaParejas: true,
      partidos: true,
    },
  });
  if (!zonaDestino || zonaDestino.categoriaId !== categoriaId) {
    const error = new Error('La zona de destino no pertenece a esta categoría.');
    error.statusCode = 404;
    throw error;
  }

  if (zonaDestino.zonaParejas.length >= 4) {
    const error = new Error(`No se puede agregar la pareja: la ${zonaDestino.nombre} ya tiene el máximo permitido de 4 parejas.`);
    error.statusCode = 400;
    throw error;
  }

  const partidoNoPendienteDestino = zonaDestino.partidos.find((p) => p.estado !== 'PENDIENTE');
  if (partidoNoPendienteDestino) {
    const error = new Error(`No se puede modificar la ${zonaDestino.nombre} porque tiene partidos en curso o finalizados.`);
    error.statusCode = 400;
    throw error;
  }

  const countDestinoActual = zonaDestino.zonaParejas.length;
  const countDestinoNuevo = countDestinoActual + 1;
  const clasificanDestinoNuevo = countDestinoNuevo === 4 ? 3 : 2;
  const cambiaClasifican = clasificanDestinoNuevo !== zonaDestino.clasifican;

  if (cambiaClasifican) {
    const partidosEliminatoriaJugados = await prisma.partido.count({
      where: {
        categoriaId,
        faseEliminatoriaId: { not: null },
        estado: { not: 'PENDIENTE' },
      },
    });
    if (partidosEliminatoriaJugados > 0) {
      const error = new Error('No se puede modificar la zona porque cambiaría los clasificados y el cuadro eliminatorio ya está en juego.');
      error.statusCode = 400;
      throw error;
    }
  }

  // 2. Transacción atómica. Va entera dentro del reintento: un choque de orden (P2002) aborta la
  // transacción y el intento siguiente vuelve a leer max(orden) desde cero.
  return await conReintentoOrden(() => prisma.$transaction(async (tx) => {
    // RE-CHEQUEO ATÓMICO DE GUARDS DENTRO DE LA TRANSACCIÓN
    const catCheck = await tx.categoria.findUnique({
      where: { id: categoriaId },
      include: { torneo: true },
    });
    if (!catCheck || catCheck.estado !== 'EN_CURSO' || catCheck.torneo?.estado !== 'EN_CURSO') {
      const error = new Error('La categoría o el torneo ya no se encuentran en estado EN_CURSO.');
      error.statusCode = 400;
      throw error;
    }

    if (cambiaClasifican) {
      const partidosEliminatoriaJugadosTx = await tx.partido.count({
        where: {
          categoriaId,
          faseEliminatoriaId: { not: null },
          estado: { not: 'PENDIENTE' },
        },
      });
      if (partidosEliminatoriaJugadosTx > 0) {
        const error = new Error('No se puede modificar la zona porque cambiaría los clasificados y el cuadro eliminatorio ya está en juego.');
        error.statusCode = 400;
        throw error;
      }
    }

    const partidosNoPendientes = await tx.partido.findMany({
      where: {
        zonaId: zonaDestinoId,
        estado: { not: 'PENDIENTE' },
      },
    });
    if (partidosNoPendientes.length > 0) {
      const error = new Error('Operación cancelada: la zona de destino tiene partidos en curso o finalizados.');
      error.statusCode = 400;
      throw error;
    }

    const countDestino = await tx.zonaPareja.count({ where: { zonaId: zonaDestinoId } });
    if (countDestino >= 4) {
      const error = new Error('La zona de destino ya tiene 4 parejas.');
      error.statusCode = 400;
      throw error;
    }

    // Crear la nueva Pareja en la categoría con orden max(orden) + 1 (count + 1 repetía un orden si había huecos)
    const { _max: maxOrdenCat } = await tx.pareja.aggregate({ where: { categoriaId }, _max: { orden: true } });
    const nuevaPareja = await tx.pareja.create({
      data: {
        categoriaId,
        jugador1: j1,
        jugador2: j2,
        orden: (maxOrdenCat.orden ?? 0) + 1,
      },
    });

    // Crear los SlotPareja dentro de la misma transacción de la pareja, ANTES de llamar a asignarHorariosAutomatico
    if (cleanSlotIds.length > 0) {
      await tx.slotPareja.createMany({
        data: cleanSlotIds.map((slotId) => ({
          parejaId: nuevaPareja.id,
          slotId,
        })),
      });
    }

    // Asociar pareja a la zona destino
    await tx.zonaPareja.create({
      data: {
        zonaId: zonaDestinoId,
        parejaId: nuevaPareja.id,
        pg: 0,
        pp: 0,
        sf: 0,
        sc: 0,
        gf: 0,
        gc: 0,
        puntos: 0,
        posicion: 0,
      },
    });

    // Regenerar partidos de la zona destino
    await regenerarPartidosZona(tx, categoriaId, zonaDestinoId);

    // Asignar horarios únicamente a los partidos de la zona destino dentro de la transacción externa
    await asignarHorariosAutomatico(organizadorId, [categoriaId], tx, { zonaId: zonaDestinoId });

    const parejaConSlots = await tx.pareja.findUnique({
      where: { id: nuevaPareja.id },
      include: { slotsSeleccionados: true },
    });

    let cuadroDesactualizado = false;
    try {
      const { estadoCuadro } = require('./faseEliminatoria.service');
      const est = await estadoCuadro(categoriaId, tx);
      cuadroDesactualizado = est.desactualizado;
    } catch (_) {
      cuadroDesactualizado = cambiaClasifican;
    }

    return {
      message: 'Pareja agregada a la zona correctamente.',
      categoriaId,
      zonaDestinoId,
      pareja: parejaConSlots || nuevaPareja,
      cuadroDesactualizado,
    };
  }));
}

module.exports = {
  iniciarCategoria,
  iniciarCategoriaConDisponibilidad,
  iniciarTorneo: iniciarCategoria,
  asignarHorariosAutomatico,
  getZonasByCategoria,
  resolverDesempateZona,
  limpiarResultadosZonas,
  fusionarSlotsEnVentanas,
  interseccionVentanas,
  parseSlotToDate,
  proximaFechaPorDia,
  slotIdToMsWindow,
  asignarHorariosModoLluviaMCF,
  restaurarHorariosAntesLluvia,
  evaluarCompatibilidadZona,
  construirMatrizCompatibilidad,
  calcularConfigZonas,
  armarGruposPorCompatibilidad,
  MAX_ITER_REPARACION,
  regenerarPartidosZona,
  generarPartidosZonaHelper,
  moverParejaDeZona,
  agregarParejaAZona,
  minutosCronologicosJornada,
  compararSlotsCronologicamente,
  ordenarSlotsCronologicamente,
};

