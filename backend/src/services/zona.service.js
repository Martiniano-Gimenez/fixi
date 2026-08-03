const prisma = require('../lib/prisma');
const { getTorneoById } = require('./torneo.service');

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

module.exports = {
  iniciarTorneo,
  limpiarResultadosZonas,
  reestructurarZonas,
};
