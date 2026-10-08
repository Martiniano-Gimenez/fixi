const prisma = require('../src/lib/prisma');
const canchasOverridesService = require('../src/services/canchasOverrides.service');
const { asignarHorariosRondaUno } = require('../src/services/eliminatoriaScheduler.service');
const { esRondaDieciseisavos } = require('../src/services/faseEliminatoria.service');
const crypto = require('crypto');

async function runTest() {
  console.log('🧪 Iniciando prueba automatizada de Scheduling de Domingo...');
  await canchasOverridesService.loadFromDb();

  const orgEmail = `test-org-${Date.now()}@domingo.com`;
  const organizador = await prisma.organizador.create({
    data: {
      nombre: 'Club Test Domingo',
      email: orgEmail,
      passwordHash: 'dummy',
      cantidadCanchas: 3,
      domingoInicio: null, // Testeamos primero validación de error si es null
      domingoFin: null,
    },
  });

  const torneo = await prisma.torneo.create({
    data: {
      organizadorId: organizador.id,
      nombre: 'Torneo Test Domingo',
      slug: 'torneo-test-domingo-' + crypto.randomBytes(3).toString('hex'),
      fecha: new Date('2026-09-11T10:00:00.000Z'), // Viernes 11 Septiembre 2026 -> Domingo es 13 Septiembre 2026
      estado: 'EN_CURSO',
    },
  });

  // 1. Validar que arroja error si domingoInicio / domingoFin son null
  console.log('\n1. Verificando validación de horarios del domingo obligatorios...');
  let errorHorariosCapturado = false;
  try {
    await asignarHorariosRondaUno(organizador.id, torneo.id);
  } catch (err) {
    if (err.message.includes('El club no tiene configurado el horario de inicio y fin para el domingo')) {
      errorHorariosCapturado = true;
      console.log('  ✅ Error descriptivo capturado correctamente:', err.message);
    } else {
      console.error('  ❌ Error inesperado:', err);
    }
  }

  if (!errorHorariosCapturado) {
    throw new Error('FALLO: Se esperaba error por falta de horarios de domingo pero no se lanzó.');
  }

  // Ahora configuramos los horarios del domingo en el organizador
  await prisma.organizador.update({
    where: { id: organizador.id },
    data: {
      domingoInicio: '08:00',
      domingoFin: '21:00',
    },
  });
  console.log('  ✅ Horarios configurados: 08:00 a 21:00');

  // 2. Crear Categoría 1 (4 clasificados) con 2 parejas / 2 partidos (Semis)
  const cat1 = await prisma.categoria.create({
    data: {
      torneoId: torneo.id,
      nombre: '8va Varones',
      estado: 'EN_CURSO',
    },
  });

  await prisma.zona.create({
    data: {
      categoriaId: cat1.id,
      nombre: 'Zona 1',
      formato: 'ROUND_ROBIN',
      clasifican: 4,
    },
  });

  // Parejas Cat 1
  const p1_cat1 = await prisma.pareja.create({ data: { categoriaId: cat1.id, jugador1: 'J1', jugador2: 'J2' } });
  const p2_cat1 = await prisma.pareja.create({ data: { categoriaId: cat1.id, jugador1: 'J3', jugador2: 'J4' } });
  const p3_cat1 = await prisma.pareja.create({ data: { categoriaId: cat1.id, jugador1: 'J5', jugador2: 'J6' } });
  const p4_cat1 = await prisma.pareja.create({ data: { categoriaId: cat1.id, jugador1: 'J7', jugador2: 'J8' } });

  const faseCat1 = await prisma.faseEliminatoria.create({
    data: {
      categoriaId: cat1.id,
      nombre: 'Octavos de Final',
      ronda: 16,
    },
  });

  const partido1_cat1 = await prisma.partido.create({
    data: {
      categoriaId: cat1.id,
      faseEliminatoriaId: faseCat1.id,
      posicionEnRonda: 1,
      pareja1Id: p1_cat1.id,
      pareja2Id: p2_cat1.id,
      estado: 'PENDIENTE',
    },
  });

  const partido2_cat1 = await prisma.partido.create({
    data: {
      categoriaId: cat1.id,
      faseEliminatoriaId: faseCat1.id,
      posicionEnRonda: 2,
      pareja1Id: p3_cat1.id,
      pareja2Id: p4_cat1.id,
      estado: 'PENDIENTE',
    },
  });

  // 3. Crear Categoría 2 (2 clasificados) con 2 partidos (Semis)
  const cat2 = await prisma.categoria.create({
    data: {
      torneoId: torneo.id,
      nombre: '7ma Varones',
      estado: 'EN_CURSO',
    },
  });

  await prisma.zona.create({
    data: {
      categoriaId: cat2.id,
      nombre: 'Zona 1',
      formato: 'ROUND_ROBIN',
      clasifican: 2,
    },
  });

  const p1_cat2 = await prisma.pareja.create({ data: { categoriaId: cat2.id, jugador1: 'A1', jugador2: 'A2' } });
  const p2_cat2 = await prisma.pareja.create({ data: { categoriaId: cat2.id, jugador1: 'A3', jugador2: 'A4' } });
  const p3_cat2 = await prisma.pareja.create({ data: { categoriaId: cat2.id, jugador1: 'A5', jugador2: 'A6' } });
  const p4_cat2 = await prisma.pareja.create({ data: { categoriaId: cat2.id, jugador1: 'A7', jugador2: 'A8' } });

  const faseCat2 = await prisma.faseEliminatoria.create({
    data: {
      categoriaId: cat2.id,
      nombre: 'Octavos de Final',
      ronda: 16,
    },
  });

  const partido1_cat2 = await prisma.partido.create({
    data: {
      categoriaId: cat2.id,
      faseEliminatoriaId: faseCat2.id,
      posicionEnRonda: 1,
      pareja1Id: p1_cat2.id,
      pareja2Id: p2_cat2.id,
      estado: 'PENDIENTE',
    },
  });

  const partido2_cat2 = await prisma.partido.create({
    data: {
      categoriaId: cat2.id,
      faseEliminatoriaId: faseCat2.id,
      posicionEnRonda: 2,
      pareja1Id: p3_cat2.id,
      pareja2Id: p4_cat2.id,
      estado: 'PENDIENTE',
    },
  });

  // 4. Ejecutar el auto-scheduler de domingo
  console.log('\n2. Ejecutando auto-scheduler earliest-fit puro con 3 canchas...');
  const resSched = await asignarHorariosRondaUno(organizador.id, torneo.id);
  console.log('  Resultado scheduling:', resSched);

  // 5. Cargar partidos actualizados y verificar asignación exacta
  const p1_c1_up = await prisma.partido.findUnique({ where: { id: partido1_cat1.id } });
  const p2_c1_up = await prisma.partido.findUnique({ where: { id: partido2_cat1.id } });
  const p1_c2_up = await prisma.partido.findUnique({ where: { id: partido1_cat2.id } });
  const p2_c2_up = await prisma.partido.findUnique({ where: { id: partido2_cat2.id } });

  function getHoraLocal(date) {
    const d = new Date(date);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  console.log('\n3. Verificando resultados de asignación de cancha y turno:');
  console.log(`  Cat 1 (4 clasificados) - Partido 1: Cancha ${p1_c1_up.canchaNumero} @ ${getHoraLocal(p1_c1_up.fechaHora)}`);
  console.log(`  Cat 1 (4 clasificados) - Partido 2: Cancha ${p2_c1_up.canchaNumero} @ ${getHoraLocal(p2_c1_up.fechaHora)}`);
  console.log(`  Cat 2 (2 clasificados) - Partido 1: Cancha ${p1_c2_up.canchaNumero} @ ${getHoraLocal(p1_c2_up.fechaHora)}`);
  console.log(`  Cat 2 (2 clasificados) - Partido 2: Cancha ${p2_c2_up.canchaNumero} @ ${getHoraLocal(p2_c2_up.fechaHora)}`);

  // Aserciones exactas:
  // Cancha 1 a las 08:00 para Cat 1 P1
  // Cancha 2 a las 08:00 para Cat 1 P2
  // Cancha 3 a las 08:00 para Cat 2 P1 (ocupa la cancha restante a las 08:00)
  // Cancha 1 a las 09:15 para Cat 2 P2 (siguiente turno disponible)
  if (p1_c1_up.canchaNumero !== 1 || getHoraLocal(p1_c1_up.fechaHora) !== '08:00') {
    throw new Error(`Cat 1 P1 incorrecto: esperaba Cancha 1 @ 08:00 pero obtuvo Cancha ${p1_c1_up.canchaNumero} @ ${getHoraLocal(p1_c1_up.fechaHora)}`);
  }
  if (p2_c1_up.canchaNumero !== 2 || getHoraLocal(p2_c1_up.fechaHora) !== '08:00') {
    throw new Error(`Cat 1 P2 incorrecto: esperaba Cancha 2 @ 08:00 pero obtuvo Cancha ${p2_c1_up.canchaNumero} @ ${getHoraLocal(p2_c1_up.fechaHora)}`);
  }
  if (p1_c2_up.canchaNumero !== 3 || getHoraLocal(p1_c2_up.fechaHora) !== '08:00') {
    throw new Error(`Cat 2 P1 incorrecto: esperaba Cancha 3 @ 08:00 pero obtuvo Cancha ${p1_c2_up.canchaNumero} @ ${getHoraLocal(p1_c2_up.fechaHora)}`);
  }
  if (![1, 2].includes(p2_c2_up.canchaNumero) || getHoraLocal(p2_c2_up.fechaHora) !== '09:15') {
    throw new Error(`Cat 2 P2 incorrecto: esperaba Cancha 1 o 2 @ 09:15 pero obtuvo Cancha ${p2_c2_up.canchaNumero} @ ${getHoraLocal(p2_c2_up.fechaHora)}`);
  }

  console.log('  ✅ Aserciones de earliest-fit puro pasaron exitosamente!');

  // 6. Verificar clasificación de dieciseisavos
  console.log('\n4. Verificando esRondaDieciseisavos...');
  if (!esRondaDieciseisavos(32) || !esRondaDieciseisavos(64)) {
    throw new Error('Fallo: 32 o 64 deberían ser dieciseisavos o más.');
  }
  if (esRondaDieciseisavos(16) || esRondaDieciseisavos(8) || esRondaDieciseisavos(4) || esRondaDieciseisavos(2)) {
    throw new Error('Fallo: rondas < 32 no deben ser dieciseisavos.');
  }
  console.log('  ✅ Helper esRondaDieciseisavos funciona perfectamente.');

  // Limpieza de datos de prueba
  await prisma.partido.deleteMany({ where: { categoria: { torneoId: torneo.id } } });
  await prisma.faseEliminatoria.deleteMany({ where: { categoria: { torneoId: torneo.id } } });
  await prisma.pareja.deleteMany({ where: { categoria: { torneoId: torneo.id } } });
  await prisma.zona.deleteMany({ where: { categoria: { torneoId: torneo.id } } });
  await prisma.categoria.deleteMany({ where: { torneoId: torneo.id } });
  await prisma.torneo.delete({ where: { id: torneo.id } });
  await prisma.organizador.delete({ where: { id: organizador.id } });

  console.log('\n🎉 ¡TODOS LOS TESTS DE DOMINGO PASARON CON ÉXITO!');
}

runTest()
  .catch((e) => {
    console.error('❌ Error en test:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
