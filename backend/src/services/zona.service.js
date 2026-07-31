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
      if (formato === 'ROUND_ROBIN') {
        if (size === 2) {
          // 1 partido: P1 vs P2
          await tx.partido.create({
            data: {
              torneoId,
              zonaId: zona.id,
              pareja1Id: parejasEnEstaZona[0].id,
              pareja2Id: parejasEnEstaZona[1].id,
              posicionEnRonda: 1,
            },
          });
        } else if (size === 3) {
          // 3 partidos: P1vsP2, P1vsP3, P2vsP3
          const enfrentamientos = [
            [0, 1],
            [0, 2],
            [1, 2],
          ];
          for (let k = 0; k < enfrentamientos.length; k++) {
            const [p1Idx, p2Idx] = enfrentamientos[k];
            await tx.partido.create({
              data: {
                torneoId,
                zonaId: zona.id,
                pareja1Id: parejasEnEstaZona[p1Idx].id,
                pareja2Id: parejasEnEstaZona[p2Idx].id,
                posicionEnRonda: k + 1,
              },
            });
          }
        }
      } else if (formato === 'MINI_BRACKET') {
        // Zonas de 4: 
        // Partido 1 (pos 1): P1 vs P2
        // Partido 2 (pos 2): P3 vs P4
        // Partido 3 (pos 3): Ganador P1 vs Ganador P2 (1ro y 2do)
        // Partido 4 (pos 4): Perdedor P1 vs Perdedor P2 (3ro y 4to)
        
        await tx.partido.create({
          data: {
            torneoId,
            zonaId: zona.id,
            pareja1Id: parejasEnEstaZona[0].id,
            pareja2Id: parejasEnEstaZona[1].id,
            posicionEnRonda: 1,
          },
        });
        await tx.partido.create({
          data: {
            torneoId,
            zonaId: zona.id,
            pareja1Id: parejasEnEstaZona[2].id,
            pareja2Id: parejasEnEstaZona[3].id,
            posicionEnRonda: 2,
          },
        });
        
        // P3 y P4 se crean sin parejas, se llenan cuando terminen P1 y P2
        await tx.partido.create({
          data: {
            torneoId,
            zonaId: zona.id,
            posicionEnRonda: 3,
          },
        });
        await tx.partido.create({
          data: {
            torneoId,
            zonaId: zona.id,
            posicionEnRonda: 4,
          },
        });
      }
    }

    // Actualizar estado del torneo
    await tx.torneo.update({
      where: { id: torneoId },
      data: { estado: 'EN_CURSO' },
    });
  });

  return { message: 'Torneo iniciado y zonas generadas.' };
}

module.exports = {
  iniciarTorneo,
};
