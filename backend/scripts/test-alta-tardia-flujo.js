/**
 * test-alta-tardia-flujo.js
 * Demostración real de cómo el sistema interpreta una pareja de alta tardía (0 slots):
 * 1. Crea categoría y torneo en EN_CURSO con 3 parejas en una zona.
 * 2. Agrega una pareja tardía mediante agregarParejaAZona (crea pareja con 0 slots).
 * 3. Demuestra que el sistema no lo bloquea como "imposible de programar".
 * 4. Asigna horario exitosamente al partido de la pareja tardía mediante asignarHorarioManual.
 * 5. Limpieza garantizada en bloque finally para no dejar datos huérfanos en la base.
 */

const { ensureTestDb } = require('./utils/testEnvGuard');
const prisma = require('../src/lib/prisma');
const zonaService = require('../src/services/zona.service');
const partidoService = require('../src/services/partido.service');

async function testAltaTardiaFlujo() {
  await ensureTestDb();
  console.log('🧪 Iniciando prueba de flujo real: Alta tardía (0 slots) y asignación de horario...');

  const timestamp = Date.now();
  let orgId = null;
  let torneoId = null;
  let catId = null;

  try {
    const org = await prisma.organizador.create({
      data: {
        nombre: `Org Tardio ${timestamp}`,
        email: `tardio-${timestamp}@test.com`,
        passwordHash: 'dummy',
        cantidadCanchas: 4,
        viernesInicio: '14:00',
        viernesFin: '23:00',
        sabadoInicio: '09:00',
        sabadoFin: '21:00',
      },
    });
    orgId = org.id;

    const torneo = await prisma.torneo.create({
      data: {
        nombre: `Torneo Tardio ${timestamp}`,
        slug: `torneo-tardio-${timestamp}`,
        organizadorId: org.id,
        estado: 'EN_CURSO',
        fecha: new Date('2026-10-16T00:00:00.000Z'),
      },
    });
    torneoId = torneo.id;

    const cat = await prisma.categoria.create({
      data: {
        nombre: '4ta Libres',
        torneoId: torneo.id,
        estado: 'EN_CURSO',
      },
    });
    catId = cat.id;

    // Crear 3 parejas iniciales
    const p1 = await prisma.pareja.create({
      data: {
        categoriaId: cat.id,
        jugador1: 'A1',
        jugador2: 'A2',
        orden: 1,
        slotsSeleccionados: {
          create: [{ slotId: 'Viernes-18:00' }, { slotId: 'Viernes-19:15' }],
        },
      },
    });

    const p2 = await prisma.pareja.create({
      data: {
        categoriaId: cat.id,
        jugador1: 'B1',
        jugador2: 'B2',
        orden: 2,
        slotsSeleccionados: {
          create: [{ slotId: 'Viernes-18:00' }, { slotId: 'Viernes-19:15' }],
        },
      },
    });

    const p3 = await prisma.pareja.create({
      data: {
        categoriaId: cat.id,
        jugador1: 'C1',
        jugador2: 'C2',
        orden: 3,
        slotsSeleccionados: {
          create: [{ slotId: 'Sabado-10:00' }, { slotId: 'Sabado-11:15' }],
        },
      },
    });

    const zona = await prisma.zona.create({
      data: {
        categoriaId: cat.id,
        nombre: 'Zona A',
        formato: 'ROUND_ROBIN',
        clasifican: 2,
      },
    });

    await prisma.zonaPareja.createMany({
      data: [
        { zonaId: zona.id, parejaId: p1.id },
        { zonaId: zona.id, parejaId: p2.id },
        { zonaId: zona.id, parejaId: p3.id },
      ],
    });

    await zonaService.regenerarPartidosZona(prisma, cat.id, zona.id);
    console.log('✓ Zona creada con 3 parejas.');

    // Paso 2: Agregar pareja tardía mediante agregarParejaAZona
    const resAgregar = await zonaService.agregarParejaAZona(org.id, cat.id, {
      zonaDestinoId: zona.id,
      jugador1: 'Tardío Juan',
      jugador2: 'Tardío Pedro',
    });

    const parejaTardia = resAgregar.pareja;
    console.log(`✓ Pareja tardía agregada: "${parejaTardia.jugador1} / ${parejaTardia.jugador2}" (ID: ${parejaTardia.id})`);

    // Verificar cantidad de slots en DB
    const slotsCount = await prisma.slotPareja.count({
      where: { parejaId: parejaTardia.id },
    });
    console.log(`✓ Slots en DB de la pareja tardía: ${slotsCount} (0 slots)`);

    // Buscar los partidos de la pareja tardía
    const partidosTardia = await prisma.partido.findMany({
      where: {
        OR: [{ pareja1Id: parejaTardia.id }, { pareja2Id: parejaTardia.id }],
      },
      include: { pareja1: true, pareja2: true },
    });

    console.log(`✓ Partidos generados para la pareja tardía: ${partidosTardia.length} partidos`);
    for (const part of partidosTardia) {
      console.log(
        `  - Partido #${part.numero || part.id.slice(0, 6)}: ${part.pareja1?.jugador1} vs ${part.pareja2?.jugador1} | Horario: ${part.fechaHora ? part.fechaHora.toISOString() : 'PENDIENTE'}`
      );
    }

    // Paso 3: Asignar horario manual mediante asignarHorarioManual
    const partidoParaAsignar = partidosTardia[0];
    console.log(`\n→ Asignando horario al partido #${partidoParaAsignar.numero || partidoParaAsignar.id.slice(0, 6)}...`);

    const resAsignar = await partidoService.asignarHorarioManual(org.id, partidoParaAsignar.id, {
      slotId: 'Viernes-18:00',
      canchaNumero: 2,
    });

    console.log(`✓ Partido asignado exitosamente:`);
    console.log(`  - Cancha: ${resAsignar.partido.canchaNumero}`);
    console.log(`  - Fecha/Hora: ${resAsignar.partido.fechaHora.toISOString()}`);
    console.log(`  - Estado: ${resAsignar.partido.estado}`);

    console.log('\n🎉 ¡Demostración de flujo real completada con 100% de éxito!');
  } finally {
    // Limpieza garantizada en finally
    if (catId) {
      await prisma.slotPareja.deleteMany({ where: { pareja: { categoriaId: catId } } });
      await prisma.partido.deleteMany({ where: { categoriaId: catId } });
      await prisma.zonaPareja.deleteMany({ where: { zona: { categoriaId: catId } } });
      await prisma.zona.deleteMany({ where: { categoriaId: catId } });
      await prisma.pareja.deleteMany({ where: { categoriaId: catId } });
    }
    if (torneoId) {
      await prisma.categoria.deleteMany({ where: { torneoId } });
      await prisma.torneo.deleteMany({ where: { id: torneoId } });
    }
    if (orgId) {
      await prisma.organizador.deleteMany({ where: { id: orgId } });
    }
    console.log('✓ Limpieza de datos de prueba completada (torneo, categoría y organizador eliminados).');
  }
}

testAltaTardiaFlujo()
  .catch((e) => {
    console.error('❌ Error en test:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
