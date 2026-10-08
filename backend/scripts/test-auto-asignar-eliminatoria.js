const { ensureTestDb } = require('./utils/testEnvGuard');
const prisma = require('../src/lib/prisma');
const partidoService = require('../src/services/partido.service');
const faseEliminatoriaService = require('../src/services/faseEliminatoria.service');
const organizadorService = require('../src/services/organizador.service');
const canchasOverridesService = require('../src/services/canchasOverrides.service');
const crypto = require('crypto');

async function testAutoAsignacionEliminatoria() {
  await ensureTestDb();
  console.log('🧪 Iniciando prueba automatizada de Auto-Asignación de Eliminatoria...');
  await canchasOverridesService.loadFromDb();

  let organizador = null;
  let categoria = null;
  let torneo = null;

  try {
    const orgEmail = `test-auto-${Date.now()}@test.com`;
    organizador = await prisma.organizador.create({
    data: {
      nombre: 'Club Test Auto Asignacion',
      email: orgEmail,
      passwordHash: 'dummy',
      cantidadCanchas: 2,
      domingoInicio: '08:00',
      domingoFin: '21:00',
    },
  });

  torneo = await prisma.torneo.create({
    data: {
      organizadorId: organizador.id,
      nombre: 'Torneo Test Auto-Asignar',
      slug: 'torneo-auto-' + crypto.randomBytes(3).toString('hex'),
      fecha: new Date('2026-09-11T10:00:00.000Z'), // Viernes 11/09/2026 -> Domingo 13/09/2026
      estado: 'EN_CURSO',
    },
  });

  categoria = await prisma.categoria.create({
    data: {
      torneoId: torneo.id,
      nombre: '6ta Varones',
      estado: 'EN_CURSO',
    },
  });

  // 1. Crear 2 zonas de 2 parejas cada una (para test rápido de 1 partido por zona)
  const zonaA = await prisma.zona.create({
    data: {
      categoriaId: categoria.id,
      nombre: 'Zona A',
      formato: 'ROUND_ROBIN',
      clasifican: 1,
    },
  });

  const zonaB = await prisma.zona.create({
    data: {
      categoriaId: categoria.id,
      nombre: 'Zona B',
      formato: 'ROUND_ROBIN',
      clasifican: 1,
    },
  });

  const pA1 = await prisma.pareja.create({ data: { categoriaId: categoria.id, jugador1: 'A1_1', jugador2: 'A1_2' } });
  const pA2 = await prisma.pareja.create({ data: { categoriaId: categoria.id, jugador1: 'A2_1', jugador2: 'A2_2' } });
  const pB1 = await prisma.pareja.create({ data: { categoriaId: categoria.id, jugador1: 'B1_1', jugador2: 'B1_2' } });
  const pB2 = await prisma.pareja.create({ data: { categoriaId: categoria.id, jugador1: 'B2_1', jugador2: 'B2_2' } });

  await prisma.zonaPareja.createMany({
    data: [
      { zonaId: zonaA.id, parejaId: pA1.id },
      { zonaId: zonaA.id, parejaId: pA2.id },
      { zonaId: zonaB.id, parejaId: pB1.id },
      { zonaId: zonaB.id, parejaId: pB2.id },
    ],
  });

  // Partidos de zona
  const partidoZonaA = await prisma.partido.create({
    data: {
      categoriaId: categoria.id,
      zonaId: zonaA.id,
      pareja1Id: pA1.id,
      pareja2Id: pA2.id,
      estado: 'PENDIENTE',
      fechaHora: new Date('2026-09-11T14:00:00.000Z'),
      canchaNumero: 1,
    },
  });

  const partidoZonaB = await prisma.partido.create({
    data: {
      categoriaId: categoria.id,
      zonaId: zonaB.id,
      pareja1Id: pB1.id,
      pareja2Id: pB2.id,
      estado: 'PENDIENTE',
      fechaHora: new Date('2026-09-11T15:30:00.000Z'),
      canchaNumero: 1,
    },
  });

  console.log('  ✅ Zonas y parejas inicializadas.');

  // 2. Generar bracket vacío al inicio del torneo (como hace la app)
  await faseEliminatoriaService.generarEliminatoria(organizador.id, categoria.id);
  console.log('  ✅ Bracket vacío generado exitosamente.');

  // Validar que el partido de eliminatoria (Final: 1° Zona A vs 1° Zona B) está PENDIENTE y con parejas NULL
  let partidoFinal = await prisma.partido.findFirst({
    where: { categoriaId: categoria.id, faseEliminatoriaId: { not: null } },
  });

  if (!partidoFinal) throw new Error('FALLO: No se encontró el partido de eliminatoria.');
  if (partidoFinal.pareja1Id !== null || partidoFinal.pareja2Id !== null) {
    throw new Error('FALLO: El partido de eliminatoria no debería tener parejas asignadas aún.');
  }
  console.log('  ✅ Partido de eliminatoria verificado en estado inicial vacío.');

  // 3. Finalizar partido de Zona A (gana pA1: 6-2, 6-3)
  console.log('\n3. Finalizando primer partido (Zona A)...');
  await partidoService.cargarResultado(organizador.id, partidoZonaA.id, {
    sets: [
      { gamesPareja1: 6, gamesPareja2: 2 },
      { gamesPareja1: 6, gamesPareja2: 3 },
    ],
  });

  // Validar que como Zona B aún no finalizó, el bracket sigue sin asignar
  partidoFinal = await prisma.partido.findFirst({
    where: { categoriaId: categoria.id, faseEliminatoriaId: { not: null } },
  });
  if (partidoFinal.pareja1Id !== null || partidoFinal.pareja2Id !== null) {
    throw new Error('FALLO: El bracket se asignó prematuramente antes de que terminen todas las zonas.');
  }
  console.log('  ✅ Correcto: Bracket sigue esperando definición de Zona B.');

  // 4. Finalizar el ÚLTIMO partido de zona (Zona B: gana pB1: 6-4, 6-4)
  console.log('\n4. Finalizando el último partido de zona (Zona B) -> Dispara auto-asignación...');
  await partidoService.cargarResultado(organizador.id, partidoZonaB.id, {
    sets: [
      { gamesPareja1: 6, gamesPareja2: 4 },
      { gamesPareja1: 6, gamesPareja2: 4 },
    ],
  });

  // 5. Validar que el bracket eliminatorio AHORA SÍ TIENE LAS PAREJAS ASIGNADAS AUTOMÁTICAMENTE
  partidoFinal = await prisma.partido.findFirst({
    where: { categoriaId: categoria.id, faseEliminatoriaId: { not: null } },
  });

  console.log('\n5. Verificando estado post-finalización:');
  console.log('  Pareja 1 asignada:', partidoFinal.pareja1Id, '-> Esperado (pA1):', pA1.id);
  console.log('  Pareja 2 asignada:', partidoFinal.pareja2Id, '-> Esperado (pB1):', pB1.id);
  console.log('  Horario asignado domingo:', partidoFinal.fechaHora);
  console.log('  Cancha asignada:', partidoFinal.canchaNumero);

  if (partidoFinal.pareja1Id !== pA1.id) {
    throw new Error(`FALLO: pareja1Id esperada ${pA1.id}, obtenida: ${partidoFinal.pareja1Id}`);
  }
  if (partidoFinal.pareja2Id !== pB1.id) {
    throw new Error(`FALLO: pareja2Id esperada ${pB1.id}, obtenida: ${partidoFinal.pareja2Id}`);
  }
  if (!partidoFinal.fechaHora) {
    throw new Error('FALLO: fechaHora de domingo no fue asignada automáticamente.');
  }
  if (!partidoFinal.canchaNumero) {
    throw new Error('FALLO: canchaNumero de domingo no fue asignada automáticamente.');
  }

  // 6. Verificar que getEstadoEnVivo refleja clasificados listos
  const estadoEnVivo = await organizadorService.getEstadoEnVivo(organizador.id, torneo.id);
  const catEnVivo = estadoEnVivo.categorias.find((c) => c.id === categoria.id);

  console.log('\n6. Verificando getEstadoEnVivo:');
  console.log('  clasificadosAsignados:', catEnVivo.clasificadosAsignados);
  console.log('  estadoEliminatoria:', catEnVivo.estadoEliminatoria);
  console.log('  zonasFinalizadas:', catEnVivo.zonasFinalizadas);

  if (!catEnVivo.clasificadosAsignados) {
    throw new Error('FALLO: getEstadoEnVivo debería reportar clasificadosAsignados: true.');
  }
  if (catEnVivo.estadoEliminatoria !== 'EN_CURSO') {
    throw new Error(`FALLO: estadoEliminatoria debería ser EN_CURSO, obtenido: ${catEnVivo.estadoEliminatoria}`);
  }

  console.log('\n🎉 ¡TODAS LAS PRUEBAS DE AUTO-ASIGNACIÓN Y AUTO-SCHEDULING PASARON EXITOSAMENTE!');

  } finally {
    if (categoria && torneo && organizador) {
      await prisma.setPartido.deleteMany({ where: { partido: { categoriaId: categoria.id } } });
      await prisma.partido.deleteMany({ where: { categoriaId: categoria.id } });
      await prisma.faseEliminatoria.deleteMany({ where: { categoriaId: categoria.id } });
      await prisma.zonaPareja.deleteMany({ where: { zona: { categoriaId: categoria.id } } });
      await prisma.zona.deleteMany({ where: { categoriaId: categoria.id } });
      await prisma.pareja.deleteMany({ where: { categoriaId: categoria.id } });
      await prisma.categoria.deleteMany({ where: { torneoId: torneo.id } });
      await prisma.torneo.deleteMany({ where: { id: torneo.id } });
      await prisma.organizador.deleteMany({ where: { id: organizador.id } });
      console.log('✓ Limpieza de test-auto-asignar-eliminatoria completada en finally.');
    }
  }
}

testAutoAsignacionEliminatoria()
  .catch((err) => {
    console.error('❌ Error en la prueba:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
