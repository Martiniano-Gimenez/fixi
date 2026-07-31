const prisma = require('../lib/prisma');

function nombreRonda(ronda) {
  const nombres = {
    1: 'Final',
    2: 'Semifinal',
    4: 'Cuartos de Final',
    8: 'Octavos de Final',
    16: 'Dieciseisavos de Final',
    32: 'Treintaidosavos de Final',
  };
  return nombres[ronda] || `Ronda ${ronda}`;
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

  // 1. Obtener zonas del torneo
  const zonas = await prisma.zona.findMany({
    where: { torneoId },
    orderBy: { nombre: 'asc' },
    include: {
      zonaParejas: {
        orderBy: [{ posicion: 'asc' }],
        include: { pareja: true },
      },
    },
  });

  if (zonas.length === 0) {
    const error = new Error('El torneo no tiene zonas generadas.');
    error.statusCode = 400;
    throw error;
  }

  // 2. Recolectar parejas clasificadas (top N de cada zona según clasifican)
  const clasificadas = [];
  zonas.forEach((zona) => {
    // Tomar los top "clasifican" del ZonaPareja
    const topZona = zona.zonaParejas.slice(0, zona.clasifican);
    topZona.forEach((zp) => {
      clasificadas.push({
        parejaId: zp.parejaId,
        pareja: zp.pareja,
        zonaOrigen: zona.nombre,
      });
    });
  });

  if (clasificadas.length === 0) {
    const error = new Error('No hay parejas clasificadas en las zonas.');
    error.statusCode = 400;
    throw error;
  }

  // 2.5. Borrar fases eliminatorias viejas si existen
  const faseViejas = await prisma.faseEliminatoria.findMany({
    where: { torneoId },
  });
  
  if (faseViejas.length > 0) {
    // Borrar todos los partidos de esas fases
    await prisma.partido.deleteMany({
      where: {
        faseEliminatoriaId: {
          in: faseViejas.map(f => f.id)
        }
      }
    });
    
    // Borrar las fases
    await prisma.faseEliminatoria.deleteMany({
      where: { torneoId }
    });
  }

  // 3. Determinar estructura de rondas (2, 4, 8, 16, 32...)
  const totalParejas = clasificadas.length;
  const potencias = [2, 4, 8, 16, 32];
  let potencia = 1;

  // Encontrar la menor potencia de 2 >= totalParejas
  for (const p of potencias) {
    if (p >= totalParejas) {
      potencia = p;
      break;
    }
  }

  // Calcular rondas necesarias
  // Para 6 parejas → 8 slots → rondas: 8 (octavos), 4 (cuartos), 2 (semis), 1 (final - pero se llama ronda 1)
  // PERO: La ronda 1 es la final entre 2 parejas, y debe haber solo 1 partido, no múltiples
  const rondas = [];
  let ronda = potencia;
  while (ronda >= 1) {
    rondas.push(ronda);
    ronda = ronda / 2;
  }

  // 4. Crear FaseEliminatoria para cada ronda
  const fases = {};
  for (const ronda of rondas) {
    const nombreFase = nombreRonda(ronda);
    const fase = await prisma.faseEliminatoria.create({
      data: {
        torneoId,
        nombre: nombreFase,
        ronda,
      },
    });
    fases[ronda] = fase.id;
  }

  // 5. Generar Partidos para la primera ronda
  // Mezclar parejas clasificadas aleatoriamente y asignarlas
  const parejasMezcladas = clasificadas.sort(() => Math.random() - 0.5);

  // Primera ronda tiene "potencia" partidos
  const primeraRonda = rondas[0];
  const partidosPrimeraRonda = [];

  for (let i = 0; i < potencia / 2; i++) {
    const pareja1 = parejasMezcladas[i * 2];
    const pareja2 = parejasMezcladas[i * 2 + 1];

    const partido = await prisma.partido.create({
      data: {
        torneoId,
        faseEliminatoriaId: fases[primeraRonda],
        posicionEnRonda: i + 1,
        pareja1Id: pareja1?.parejaId || null,
        pareja2Id: pareja2?.parejaId || null,
        estado: 'PENDIENTE',
      },
    });

    partidosPrimeraRonda.push(partido);
  }

  // 6. Crear Partidos vacíos para rondas posteriores (con parejas null)
  let indicePartido = 1;
  for (let i = 1; i < rondas.length; i++) {
    const ronda = rondas[i];
    // Número de partidos en esta ronda = ronda / 2
    // Si ronda = 4 → 2 partidos, si ronda = 2 → 1 partido, si ronda = 1 → 1 partido
    const cantPartidosEnRonda = ronda === 1 ? 1 : Math.floor(ronda / 2);
    
    console.log(`[generarEliminatoria] Ronda ${i}: ronda=${ronda}, cantPartidosEnRonda=${cantPartidosEnRonda}, faseId=${fases[ronda]}`);

    for (let j = 0; j < cantPartidosEnRonda; j++) {
      await prisma.partido.create({
        data: {
          torneoId,
          faseEliminatoriaId: fases[ronda],
          posicionEnRonda: j + 1,
          pareja1Id: null,
          pareja2Id: null,
          estado: 'PENDIENTE',
        },
      });
    }
  }

  return {
    totalParejas,
    potencia,
    rondas,
    fases,
    clasificadas,
    partidosPrimeraRonda,
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
        },
      },
    },
  });

  return fases;
}

module.exports = {
  generarEliminatoria,
  getFasesEliminatorias,
};
