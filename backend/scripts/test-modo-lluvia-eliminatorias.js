const { PrismaClient } = require('@prisma/client');
const assert = require('assert');
const prisma = new PrismaClient();

const organizadorService = require('../src/services/organizador.service');
const faseEliminatoriaService = require('../src/services/faseEliminatoria.service');
const { parseFechaLocal } = require('../src/utils/dateUtils');

async function runTest() {
  console.log('🧪 Iniciando test: Protección de Eliminatorias y Horarios Pasados en Modo Lluvia...');

  const timestamp = Date.now();
  const email = `test_eliminatoria_${timestamp}@padel.com`;

  // 1. Crear Organizador con 6 canchas y horarios viernes/sábado/domingo
  const organizador = await prisma.organizador.create({
    data: {
      nombre: 'Club Test Eliminatoria',
      email,
      passwordHash: 'dummy_hash',
      cantidadCanchas: 6,
      viernesInicio: '14:00',
      viernesFin: '23:00',
      sabadoInicio: '08:00',
      sabadoFin: '23:00',
      domingoInicio: '08:00',
      domingoFin: '22:00',
    },
  });

  // 2. Crear Torneo con fecha de Sábado
  const fechaSabadoStr = '2026-08-29';
  const fechaSabadoDate = parseFechaLocal(fechaSabadoStr);
  const torneo = await prisma.torneo.create({
    data: {
      nombre: 'Torneo Test Sábado Eliminatoria',
      slug: `torneo-test-sabado-${timestamp}`,
      fecha: fechaSabadoDate,
      estado: 'EN_CURSO',
      canchasDisponiblesOverride: 4, // 4 canchas activas
      overrideActivoDesde: fechaSabadoDate,
      organizadorId: organizador.id,
    },
  });

  // 3. Crear Categoría
  const categoria = await prisma.categoria.create({
    data: {
      nombre: '4ta Caballeros',
      estado: 'EN_CURSO',
      torneoId: torneo.id,
    },
  });

  // 4. Crear 4 parejas
  const parejas = [];
  for (let i = 1; i <= 4; i++) {
    const p = await prisma.pareja.create({
      data: {
        jugador1: `Jugador ${i}A`,
        jugador2: `Jugador ${i}B`,
        orden: i,
        categoriaId: categoria.id,
      },
    });
    parejas.push(p);
  }

  // 5. Crear Zona A con partidos finalizados que terminan a las 17:30 del sábado
  const zonaA = await prisma.zona.create({
    data: {
      categoriaId: categoria.id,
      nombre: 'Zona A',
      clasifican: 2,
    },
  });

  const baseSaturday = parseFechaLocal(fechaSabadoStr);
  const hora16_15 = new Date(baseSaturday);
  hora16_15.setHours(16, 15, 0, 0); // 16:15 a 17:30

  // Partido de zona finalizado que terminó a las 17:30
  await prisma.partido.create({
    data: {
      categoriaId: categoria.id,
      zonaId: zonaA.id,
      posicionEnRonda: 1,
      pareja1Id: parejas[0].id,
      pareja2Id: parejas[1].id,
      estado: 'FINALIZADO',
      fechaHora: hora16_15,
      canchaNumero: 1,
      ganadorId: parejas[0].id,
    },
  });

  // 6. Crear Fase Eliminatoria (Dieciseisavos)
  const faseDieciseisavos = await prisma.faseEliminatoria.create({
    data: {
      categoriaId: categoria.id,
      nombre: 'Dieciseisavos de Final',
      ronda: 32,
    },
  });

  // Partido 1 de dieciseisavos: ASIGNADO MANUALMENTE para el sábado a las 18:00 en Cancha 1
  const hora18_00 = new Date(baseSaturday);
  hora18_00.setHours(18, 0, 0, 0);

  const partido18hs = await prisma.partido.create({
    data: {
      categoriaId: categoria.id,
      faseEliminatoriaId: faseDieciseisavos.id,
      posicionEnRonda: 1,
      pareja1Id: parejas[0].id,
      pareja2Id: parejas[2].id,
      estado: 'PENDIENTE',
      fechaHora: hora18_00,
      canchaNumero: 1,
      sinHorarioAsignado: false,
    },
  });

  // Partido 2 de dieciseisavos: SIN HORARIO ASIGNADO (para asignación manual)
  const partidoSinHorario = await prisma.partido.create({
    data: {
      categoriaId: categoria.id,
      faseEliminatoriaId: faseDieciseisavos.id,
      posicionEnRonda: 2,
      pareja1Id: parejas[1].id,
      pareja2Id: parejas[3].id,
      estado: 'PENDIENTE',
      fechaHora: null,
      canchaNumero: null,
      sinHorarioAsignado: true,
    },
  });

  console.log('✅ Estado inicial preparado:');
  console.log(`   - 4 canchas activas de 6 totales`);
  console.log(`   - Partido de zona finalizado a las 17:30`);
  console.log(`   - Partido dieciseisavos #1 asignado a las 18:00 en Cancha 1`);
  console.log(`   - Partido dieciseisavos #2 sin horario asignado (manual)`);

  // 7. Simular pasar de 4 canchas a 6 canchas (Restaurar todas)
  console.log('\n☀️ Pasando de 4 a 6 canchas activas (Restaurar)...');
  const res = await organizadorService.reprogramarPorReduccionCanchas(
    organizador.id,
    torneo.id,
    null, // null = restaurar a 6 canchas
    null,
    fechaSabadoStr // diaKey sábado
  );

  console.log(`✅ Resultado: ${res.message}`);
  console.log(`   - Partidos reprogramados: ${res.reprogramacion.partidosReprogramados}`);
  console.log(`   - Partidos sin cambio: ${res.reprogramacion.partidosSinCambio}`);

  // 8. Verificaciones críticas
  const p18Post = await prisma.partido.findUnique({ where: { id: partido18hs.id } });
  const pSinHorarioPost = await prisma.partido.findUnique({ where: { id: partidoSinHorario.id } });

  console.log('\n🔍 Verificando Partido #1 (que estaba a las 18:00):');
  console.log(`   - Fecha/Hora post: ${p18Post.fechaHora?.toISOString()}`);
  console.log(`   - Cancha post: ${p18Post.canchaNumero}`);

  const p18Hora = p18Post.fechaHora?.getHours();
  const p18Min = p18Post.fechaHora?.getMinutes();
  console.log(`   - Hora local obtenida: ${p18Hora}:${p18Min.toString().padStart(2, '0')}`);

  assert.ok(p18Post.fechaHora !== null, 'FALLÓ: El partido de las 18:00 no tiene fechaHora');
  assert.strictEqual(
    p18Post.fechaHora.getTime(),
    hora18_00.getTime(),
    `FALLÓ: El partido de las 18:00 fue modificado a ${p18Post.fechaHora.toISOString()}, NO debe ir a las 08:00 AM ni antes de las 18:00!`
  );
  console.log('✅ Verificado: El partido #1 SE MANTUVO a las 18:00 y NO retrocedió a las 08:00 AM!');

  console.log('\n🔍 Verificando Partido #2 (sin horario para asignación manual):');
  console.log(`   - Fecha/Hora: ${pSinHorarioPost.fechaHora}`);
  console.log(`   - Cancha: ${pSinHorarioPost.canchaNumero}`);
  console.log(`   - sinHorarioAsignado: ${pSinHorarioPost.sinHorarioAsignado}`);

  assert.strictEqual(pSinHorarioPost.fechaHora, null, 'FALLÓ: El partido sin horario fue auto-agendado indebidamente');
  assert.strictEqual(pSinHorarioPost.canchaNumero, null, 'FALLÓ: El partido sin horario recibió cancha');
  assert.strictEqual(pSinHorarioPost.sinHorarioAsignado, true, 'FALLÓ: sinHorarioAsignado cambió a false');
  console.log('✅ Verificado: El partido #2 permaneció intacto como sinHorarioAsignado para asignación manual!');

  // Limpieza de datos de prueba
  await prisma.partido.deleteMany({ where: { categoriaId: categoria.id } });
  await prisma.faseEliminatoria.deleteMany({ where: { categoriaId: categoria.id } });
  await prisma.zona.deleteMany({ where: { categoriaId: categoria.id } });
  await prisma.pareja.deleteMany({ where: { categoriaId: categoria.id } });
  await prisma.categoria.deleteMany({ where: { torneoId: torneo.id } });
  await prisma.torneo.deleteMany({ where: { id: torneo.id } });
  await prisma.organizador.deleteMany({ where: { id: organizador.id } });

  await prisma.$disconnect();
  console.log('\n🎉 TEST COMPLETADO CON ÉXITO: 100% de aserciones cumplidas!');
}

runTest().catch(async (err) => {
  console.error('\n❌ ERROR EN EL TEST:', err);
  await prisma.$disconnect();
  process.exit(1);
});
