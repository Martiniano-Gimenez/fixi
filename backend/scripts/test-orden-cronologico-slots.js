'use strict';

const { ensureTestDb } = require('./utils/testEnvGuard');
const prisma = require('../src/lib/prisma');
const zonaService = require('../src/services/zona.service');
const slotsService = require('../src/services/slots.service');
const { parseFechaLocal } = require('../src/utils/dateUtils');

async function testOrdenCronologicoSlots() {
  await ensureTestDb();
  console.log('🧪 Iniciando prueba: Orden cronológico de slots y prioridad diurna vs trasnoche...');

  // --- Parte 1: Unit tests de ordenarSlotsCronologicamente y compararSlotsCronologicamente ---
  console.log('  1. Verificando funciones de comparación y ordenamiento unitario...');
  const inputSlots = [
    'Sabado-00:15',
    'Sabado-00:00',
    'Sabado-15:00',
    'Sabado-13:30',
    'Viernes-23:45',
    'Viernes-01:30',
    'Viernes-18:00',
    'Domingo-10:00',
    'Domingo-00:30',
  ];

  const sortedSlots = slotsService.ordenarSlotsCronologicamente(inputSlots);
  const expectedSorted = [
    'Viernes-18:00',
    'Viernes-23:45',
    'Viernes-01:30', // Viernes trasnoche al final de la jornada de viernes
    'Sabado-13:30',
    'Sabado-15:00',
    'Sabado-00:00', // Sábado trasnoche
    'Sabado-00:15', // Sábado trasnoche
    'Domingo-10:00',
    'Domingo-00:30', // Domingo trasnoche
  ];

  for (let i = 0; i < expectedSorted.length; i++) {
    if (sortedSlots[i] !== expectedSorted[i]) {
      throw new Error(
        `[FALLO UNITARIO] Posición ${i}: esperado ${expectedSorted[i]}, recibido ${sortedSlots[i]}. Resultado completo: ${JSON.stringify(
          sortedSlots
        )}`
      );
    }
  }
  console.log('  ✅ Unit tests de orden cronológico pasaron exitosamente.');

  // --- Parte 2: Integración con asignarHorariosAutomatico ---
  const timestamp = Date.now();
  let orgId = null;
  let torneoId = null;
  let catId = null;

  try {
    // Club con sábado 08:00 a 02:00 (trasnoche de 00:00 a 02:00)
    const org = await prisma.organizador.create({
      data: {
        nombre: `Org Chrono Test ${timestamp}`,
        email: `chrono-${timestamp}@test.com`,
        passwordHash: 'dummy',
        cantidadCanchas: 2,
        viernesInicio: '14:00',
        viernesFin: '23:00',
        sabadoInicio: '08:00',
        sabadoFin: '02:00',
        domingoInicio: '09:00',
        domingoFin: '22:00',
      },
    });
    orgId = org.id;

    // Torneo viernes 16 de octubre de 2026
    const torneo = await prisma.torneo.create({
      data: {
        nombre: `Torneo Chrono ${timestamp}`,
        slug: `torneo-chrono-${timestamp}`,
        organizadorId: org.id,
        estado: 'EN_CURSO',
        fecha: new Date('2026-10-16T00:00:00.000Z'),
      },
    });
    torneoId = torneo.id;

    const cat = await prisma.categoria.create({
      data: {
        nombre: '5ta Caballeros',
        torneoId: torneo.id,
        estado: 'EN_CURSO',
      },
    });
    catId = cat.id;

    // Zona 1: Pareja A (sin slots) vs Pareja B (con slots ['Sabado-00:00','Sabado-00:15','Sabado-13:30','Sabado-15:00'])
    const zona1 = await prisma.zona.create({
      data: {
        categoriaId: cat.id,
        nombre: 'Zona A',
        clasifican: 2,
        formato: 'ROUND_ROBIN',
      },
    });

    const parejaA = await prisma.pareja.create({
      data: {
        categoriaId: cat.id,
        jugador1: 'A1',
        jugador2: 'A2',
        orden: 1,
        // 0 slots (alta tardía o sin preferencia)
      },
    });

    const parejaB = await prisma.pareja.create({
      data: {
        categoriaId: cat.id,
        jugador1: 'B1',
        jugador2: 'B2',
        orden: 2,
        slotsSeleccionados: {
          create: [
            // Insertados deliberadamente con los de trasnoche primero para probar el orden
            { slotId: 'Sabado-00:00' },
            { slotId: 'Sabado-00:15' },
            { slotId: 'Sabado-13:30' },
            { slotId: 'Sabado-15:00' },
          ],
        },
      },
    });

    await prisma.zonaPareja.createMany({
      data: [
        { zonaId: zona1.id, parejaId: parejaA.id },
        { zonaId: zona1.id, parejaId: parejaB.id },
      ],
    });

    const partido1 = await prisma.partido.create({
      data: {
        categoriaId: cat.id,
        zonaId: zona1.id,
        pareja1Id: parejaA.id,
        pareja2Id: parejaB.id,
        posicionEnRonda: 1,
      },
    });

    // Zona 2: Caso donde el ÚNICO slot común es 'Sabado-00:30'
    const zona2 = await prisma.zona.create({
      data: {
        categoriaId: cat.id,
        nombre: 'Zona B',
        clasifican: 2,
        formato: 'ROUND_ROBIN',
      },
    });

    const parejaC = await prisma.pareja.create({
      data: {
        categoriaId: cat.id,
        jugador1: 'C1',
        jugador2: 'C2',
        orden: 1,
        slotsSeleccionados: {
          create: [{ slotId: 'Sabado-00:30' }],
        },
      },
    });

    const parejaD = await prisma.pareja.create({
      data: {
        categoriaId: cat.id,
        jugador1: 'D1',
        jugador2: 'D2',
        orden: 2,
        slotsSeleccionados: {
          create: [{ slotId: 'Sabado-00:30' }, { slotId: 'Viernes-18:00' }],
        },
      },
    });

    await prisma.zonaPareja.createMany({
      data: [
        { zonaId: zona2.id, parejaId: parejaC.id },
        { zonaId: zona2.id, parejaId: parejaD.id },
      ],
    });

    const partido2 = await prisma.partido.create({
      data: {
        categoriaId: cat.id,
        zonaId: zona2.id,
        pareja1Id: parejaC.id,
        pareja2Id: parejaD.id,
        posicionEnRonda: 1,
      },
    });

    console.log('  2. Ejecutando asignarHorariosAutomatico...');
    await zonaService.asignarHorariosAutomatico(org.id, [cat.id]);

    // Verificar Partido 1: Pareja A vs Pareja B
    const partido1Actualizado = await prisma.partido.findUnique({
      where: { id: partido1.id },
    });

    if (!partido1Actualizado.fechaHora) {
      throw new Error('[FALLO] El partido 1 no fue programado.');
    }

    const fechaP1 = new Date(partido1Actualizado.fechaHora);
    // 13:30 ART corresponde a 16:30 UTC
    // 00:00 ART (trasnoche) correspondería a 03:00 UTC
    const horasUTC = fechaP1.getUTCHours();
    const minutosUTC = fechaP1.getUTCMinutes();
    console.log(`  Partido 1 asignado a: ${fechaP1.toISOString()} (UTC ${horasUTC}:${minutosUTC})`);

    if (horasUTC === 16 && minutosUTC === 30) {
      console.log('  ✅ Partido 1 asignado correctamente a 13:30 ART (y NO a 00:00 trasnoche).');
    } else {
      throw new Error(
        `[FALLO] Partido 1 asignado a horario incorrecto. Esperado 13:30 ART (16:30 UTC), recibido ${horasUTC}:${minutosUTC} UTC.`
      );
    }

    // Verificar Partido 2: Pareja C vs Pareja D (único común Sabado-00:30)
    const partido2Actualizado = await prisma.partido.findUnique({
      where: { id: partido2.id },
    });

    if (!partido2Actualizado.fechaHora) {
      throw new Error('[FALLO] El partido 2 no fue programado.');
    }

    const fechaP2 = new Date(partido2Actualizado.fechaHora);
    // 00:30 ART trasnoche corresponde a 03:30 UTC del día siguiente
    const horasUTC2 = fechaP2.getUTCHours();
    const minutosUTC2 = fechaP2.getUTCMinutes();
    console.log(`  Partido 2 asignado a: ${fechaP2.toISOString()} (UTC ${horasUTC2}:${minutosUTC2})`);

    if (horasUTC2 === 3 && minutosUTC2 === 30) {
      console.log('  ✅ Partido 2 asignado correctamente a su único slot común 00:30 ART trasnoche (03:30 UTC).');
    } else {
      throw new Error(
        `[FALLO] Partido 2 asignado a horario incorrecto. Esperado 00:30 ART trasnoche (03:30 UTC), recibido ${horasUTC2}:${minutosUTC2} UTC.`
      );
    }

    console.log('🎉 Todas las verificaciones de orden cronológico pasaron satisfactoriamente.');
  } finally {
    console.log('🧹 Limpiando datos de prueba...');
    if (catId) {
      await prisma.partido.deleteMany({ where: { categoriaId: catId } });
      await prisma.zonaPareja.deleteMany({ where: { zona: { categoriaId: catId } } });
      await prisma.zona.deleteMany({ where: { categoriaId: catId } });
      await prisma.slotPareja.deleteMany({ where: { pareja: { categoriaId: catId } } });
      await prisma.pareja.deleteMany({ where: { categoriaId: catId } });
      await prisma.categoria.deleteMany({ where: { id: catId } });
    }
    if (torneoId) {
      await prisma.torneo.deleteMany({ where: { id: torneoId } });
    }
    if (orgId) {
      await prisma.organizador.deleteMany({ where: { id: orgId } });
    }
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  testOrdenCronologicoSlots()
    .then(() => {
      console.log('✅ Suite test-orden-cronologico-slots completada con éxito.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Error en suite test-orden-cronologico-slots:', err);
      process.exit(1);
    });
}

module.exports = { testOrdenCronologicoSlots };
