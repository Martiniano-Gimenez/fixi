const { ensureTestDb } = require('./utils/testEnvGuard');
const { PrismaClient } = require('@prisma/client');
const assert = require('assert');
const prisma = new PrismaClient();

const organizadorService = require('../src/services/organizador.service');
const faseEliminatoriaService = require('../src/services/faseEliminatoria.service');
const canchasOverridesService = require('../src/services/canchasOverrides.service');
const { parseFechaLocal } = require('../src/utils/dateUtils');

async function runTest() {
  await ensureTestDb();
  console.log('🧪 Iniciando test: Protección de Eliminatorias y Horarios Pasados en Modo Lluvia...');
  await canchasOverridesService.loadFromDb();

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
  // 9. TEST CASO REAL: Dieciseisavos a las 20:45 en Canchas 5 y 6 sin parejas al reducir a 4 canchas
  console.log('\n🌧️ Test Caso Real: Dieciseisavos a las 20:45 en Canchas 5 y 6 sin parejas al reducir a 4 canchas...');
  const hora20_45 = new Date(baseSaturday);
  hora20_45.setHours(20, 45, 0, 0);

  const pDieciseisavosCancha5 = await prisma.partido.create({
    data: {
      categoriaId: categoria.id,
      faseEliminatoriaId: faseDieciseisavos.id,
      posicionEnRonda: 3,
      pareja1Id: null,
      pareja2Id: null,
      origenPareja1: '2° Zona F',
      origenPareja2: '2° Zona G',
      estado: 'PENDIENTE',
      fechaHora: hora20_45,
      canchaNumero: 5,
      sinHorarioAsignado: false,
    },
  });

  const pDieciseisavosCancha6 = await prisma.partido.create({
    data: {
      categoriaId: categoria.id,
      faseEliminatoriaId: faseDieciseisavos.id,
      posicionEnRonda: 4,
      pareja1Id: null,
      pareja2Id: null,
      origenPareja1: '2° Zona D',
      origenPareja2: '2° Zona E',
      estado: 'PENDIENTE',
      fechaHora: hora20_45,
      canchaNumero: 6,
      sinHorarioAsignado: false,
    },
  });

  // Reducir canchas a 4 para Sábado
  const resReducir = await organizadorService.reprogramarPorReduccionCanchas(
    organizador.id,
    torneo.id,
    4,
    null,
    fechaSabadoStr
  );
  console.log(`✅ Reducción a 4 canchas ejecutada: ${resReducir.message}`);

  const p5Post = await prisma.partido.findUnique({ where: { id: pDieciseisavosCancha5.id } });
  const p6Post = await prisma.partido.findUnique({ where: { id: pDieciseisavosCancha6.id } });

  console.log(`   - Dieciseisavos F/G: Cancha ${p5Post.canchaNumero}, Fecha/Hora: ${p5Post.fechaHora?.toISOString()}`);
  console.log(`   - Dieciseisavos D/E: Cancha ${p6Post.canchaNumero}, Fecha/Hora: ${p6Post.fechaHora?.toISOString()}`);

  assert.ok(p5Post.canchaNumero >= 1 && p5Post.canchaNumero <= 4, `FALLÓ: Dieciseisavos F/G quedó en cancha ${p5Post.canchaNumero} (> 4)`);
  assert.ok(p6Post.canchaNumero >= 1 && p6Post.canchaNumero <= 4, `FALLÓ: Dieciseisavos D/E quedó en cancha ${p6Post.canchaNumero} (> 4)`);
  assert.notStrictEqual(p5Post.canchaNumero, p6Post.canchaNumero, 'FALLÓ: Ambos partidos recibieron la misma cancha');
  assert.strictEqual(p5Post.fechaHora.getTime(), hora20_45.getTime(), 'FALLÓ: Partido F/G debió mantenerse a las 20:45');
  assert.strictEqual(p6Post.fechaHora.getTime(), hora20_45.getTime(), 'FALLÓ: Partido D/E debió mantenerse a las 20:45');
  console.log('✅ Verificado: Ambos dieciseisavos sin parejas fueron reubicados a canchas 1..4 a las 20:45 en canchas distintas!');

  // Restaurar a 6: vuelven a su horario y cancha de antes de la lluvia
  await organizadorService.reprogramarPorReduccionCanchas(
    organizador.id,
    torneo.id,
    null,
    null,
    fechaSabadoStr
  );
  const p5Rest = await prisma.partido.findUnique({ where: { id: pDieciseisavosCancha5.id } });
  const p6Rest = await prisma.partido.findUnique({ where: { id: pDieciseisavosCancha6.id } });
  assert.strictEqual(p5Rest.canchaNumero, 5, 'Al restaurar, cruce F/G vuelve a su cancha de antes de la lluvia');
  assert.strictEqual(p5Rest.fechaHora.getTime(), hora20_45.getTime(), 'Al restaurar, cruce F/G vuelve a su hora de antes de la lluvia');
  assert.strictEqual(p6Rest.canchaNumero, 6, 'Al restaurar, cruce D/E vuelve a su cancha de antes de la lluvia');
  assert.strictEqual(p6Rest.fechaHora.getTime(), hora20_45.getTime(), 'Al restaurar, cruce D/E vuelve a su hora de antes de la lluvia');
  console.log('✅ Verificado: Al restaurar, los cruces sin parejas volvieron a su horario de antes de la lluvia!');

  // =========================================================================
  // TEST PUNTO 1: Manejo de partidosSinSlot en removeOverrideDia y reemplazo total
  // =========================================================================
  console.log('\n--- Test Punto 1: removeOverrideDia y reemplazo completo de partidosSinSlot ---');
  // 1.1 Simular reprogramación con partido A sin slot
  await canchasOverridesService.setOverrideDia(
    torneo.id,
    fechaSabadoStr,
    4,
    hora20_45,
    { [pDieciseisavosCancha5.id]: 'Sin cancha activa libre disponible en ese horario' }
  );
  let overridesDia = canchasOverridesService.getCanchasDia(torneo.id, fechaSabadoStr, 6);
  assert.strictEqual(
    overridesDia.partidosSinSlot[pDieciseisavosCancha5.id],
    'Sin cancha activa libre disponible en ese horario',
    'FALLÓ: Partido 5 debe tener motivo en partidosSinSlot tras primera asignación'
  );

  // 1.2 Nueva reprogramación con partido B sin slot: debe REEMPLAZAR el mapa completo, no acumular
  await canchasOverridesService.setOverrideDia(
    torneo.id,
    fechaSabadoStr,
    4,
    hora20_45,
    { [pDieciseisavosCancha6.id]: 'Sin cancha activa libre disponible en ese horario' }
  );
  overridesDia = canchasOverridesService.getCanchasDia(torneo.id, fechaSabadoStr, 6);
  assert.strictEqual(
    overridesDia.partidosSinSlot[pDieciseisavosCancha5.id],
    undefined,
    'FALLÓ: Partido 5 no debe estar en partidosSinSlot tras nueva reprogramación (debe reemplazar, no acumular)'
  );
  assert.strictEqual(
    overridesDia.partidosSinSlot[pDieciseisavosCancha6.id],
    'Sin cancha activa libre disponible en ese horario',
    'FALLÓ: Partido 6 debe estar en partidosSinSlot en el mapa reemplazado'
  );

  // 1.3 removeOverrideDia debe eliminar también partidosSinSlot de esa jornada
  await canchasOverridesService.removeOverrideDia(torneo.id, fechaSabadoStr);
  overridesDia = canchasOverridesService.getCanchasDia(torneo.id, fechaSabadoStr, 6);
  assert.deepStrictEqual(
    overridesDia.partidosSinSlot,
    {},
    'FALLÓ: removeOverrideDia debe dejar partidosSinSlot vacío para esa jornada'
  );
  console.log('✅ Verificado Punto 1: partidosSinSlot se reemplaza completamente y se elimina al restaurar con removeOverrideDia!');

  // =========================================================================
  // TEST PUNTO 2: getEstadoEnVivo solo muestra el motivo si PENDIENTE y canchaNumero > canchasActivas
  // =========================================================================
  console.log('\n--- Test Punto 2: getEstadoEnVivo y visualización de motivo en partidos ---');
  // 2.1 Configurar modo lluvia a 4 canchas con motivo para pDieciseisavosCancha5 (en cancha 5, PENDIENTE)
  await prisma.partido.update({
    where: { id: pDieciseisavosCancha5.id },
    data: {
      canchaNumero: 5,
      estado: 'PENDIENTE',
      fechaHora: hora20_45,
    },
  });
  canchasOverridesService.setOverrideDia(
    torneo.id,
    fechaSabadoStr,
    4,
    hora20_45,
    { [pDieciseisavosCancha5.id]: 'Sin cancha activa libre disponible en ese horario' }
  );

  let estadoVivo = await organizadorService.getEstadoEnVivo(organizador.id, torneo.id);
  let pFantasma = estadoVivo.partidosEnCanchaFantasma.find((p) => p.id === pDieciseisavosCancha5.id);
  assert.ok(pFantasma, 'FALLÓ: Partido en cancha 5 > 4 debe estar en partidosEnCanchaFantasma');
  assert.strictEqual(
    pFantasma.motivo,
    'Sin cancha activa libre disponible en ese horario',
    'FALLÓ: Motivo debe coincidir cuando está PENDIENTE y en cancha > canchas activas'
  );

  // 2.2 Partido se reasigna a cancha activa (cancha 2 <= 4): no debe mostrarse el motivo
  await prisma.partido.update({
    where: { id: pDieciseisavosCancha5.id },
    data: { canchaNumero: 2 },
  });
  estadoVivo = await organizadorService.getEstadoEnVivo(organizador.id, torneo.id);
  pFantasma = estadoVivo.partidosEnCanchaFantasma.find((p) => p.id === pDieciseisavosCancha5.id);
  assert.strictEqual(pFantasma, undefined, 'FALLÓ: Partido reasignado a cancha 2 no debe estar en partidosEnCanchaFantasma');
  let pProximo = estadoVivo.proximosPartidos.find((p) => p.id === pDieciseisavosCancha5.id);
  assert.ok(pProximo, 'FALLÓ: Partido reasignado a cancha 2 debe estar en proximosPartidos');
  assert.strictEqual(pProximo.motivo, undefined, 'FALLÓ: Partido reasignado no debe tener motivo');

  // 2.3 Partido se juega (EN_CURSO o FINALIZADO en cancha 5): no debe mostrarse el motivo
  await prisma.partido.update({
    where: { id: pDieciseisavosCancha5.id },
    data: { canchaNumero: 5, estado: 'EN_CURSO' },
  });
  estadoVivo = await organizadorService.getEstadoEnVivo(organizador.id, torneo.id);
  pFantasma = estadoVivo.partidosEnCanchaFantasma.find((p) => p.id === pDieciseisavosCancha5.id);
  assert.strictEqual(pFantasma, undefined, 'FALLÓ: Partido EN_CURSO no debe estar en partidosEnCanchaFantasma');
  let pEnCurso = estadoVivo.partidosEnCurso.find((p) => p.id === pDieciseisavosCancha5.id);
  assert.ok(pEnCurso, 'FALLÓ: Partido debe estar en partidosEnCurso');
  assert.strictEqual(pEnCurso.motivo, undefined, 'FALLÓ: Partido EN_CURSO no debe tener motivo');

  await prisma.partido.update({
    where: { id: pDieciseisavosCancha5.id },
    data: { estado: 'FINALIZADO', ganadorId: parejas[0].id },
  });
  estadoVivo = await organizadorService.getEstadoEnVivo(organizador.id, torneo.id);
  pFantasma = estadoVivo.partidosEnCanchaFantasma.find((p) => p.id === pDieciseisavosCancha5.id);
  assert.strictEqual(pFantasma, undefined, 'FALLÓ: Partido FINALIZADO no debe estar en partidosEnCanchaFantasma');
  let pFin = estadoVivo.partidosFinalizados.find((p) => p.id === pDieciseisavosCancha5.id);
  assert.ok(pFin, 'FALLÓ: Partido debe estar en partidosFinalizados');
  assert.strictEqual(pFin.motivo, undefined, 'FALLÓ: Partido FINALIZADO no debe tener motivo');

  // 2.4 Se restauran las canchas: el partido vuelve a PENDIENTE en cancha 5, pero con canchas restauradas
  await prisma.partido.update({
    where: { id: pDieciseisavosCancha5.id },
    data: { estado: 'PENDIENTE', canchaNumero: 5, ganadorId: null },
  });
  await organizadorService.reprogramarPorReduccionCanchas(
    organizador.id,
    torneo.id,
    null,
    null,
    fechaSabadoStr
  );
  estadoVivo = await organizadorService.getEstadoEnVivo(organizador.id, torneo.id);
  pFantasma = estadoVivo.partidosEnCanchaFantasma.find((p) => p.id === pDieciseisavosCancha5.id);
  assert.strictEqual(pFantasma, undefined, 'FALLÓ: Con canchas restauradas (6), no debe haber partidos en cancha fantasma');
  pProximo = estadoVivo.proximosPartidos.find((p) => p.id === pDieciseisavosCancha5.id);
  assert.ok(pProximo, 'FALLÓ: Partido restaurado debe estar en proximosPartidos');
  assert.strictEqual(pProximo.motivo, undefined, 'FALLÓ: Partido restaurado no debe tener motivo viejo');
  console.log('✅ Verificado Punto 2: getEstadoEnVivo nunca muestra motivo viejo si el partido fue reasignado, jugado o si se restauraron las canchas!');

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
  process.exit(0);
}

runTest().catch(async (err) => {
  console.error('\n❌ ERROR EN EL TEST:', err);
  await prisma.$disconnect();
  process.exit(1);
});
