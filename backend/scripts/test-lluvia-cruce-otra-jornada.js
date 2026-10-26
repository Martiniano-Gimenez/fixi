'use strict';

const { ensureTestDb } = require('./utils/testEnvGuard');
const { resetTestDb } = require('./reset-test-db');
const prisma = require('../src/lib/prisma');
const organizadorService = require('../src/services/organizador.service');
const canchasOverridesService = require('../src/services/canchasOverrides.service');
const { parseFechaLocal } = require('../src/utils/dateUtils');
const assert = require('assert');

async function setupEscenario() {
  await ensureTestDb();
  await prisma.$disconnect();
  resetTestDb();
  await canchasOverridesService.loadFromDb();

  const org = await prisma.organizador.create({
    data: {
      nombre: 'Club Px4 Lluvia Test',
      email: 'club-lluvia-cruce@padel.test',
      passwordHash: 'hash',
      cantidadCanchas: 6,
      viernesInicio: '12:00',
      viernesFin: '02:00',
      sabadoInicio: '08:00',
      sabadoFin: '02:00',
      domingoInicio: '08:00',
      domingoFin: '23:00',
    },
  });

  const torneo = await prisma.torneo.create({
    data: {
      nombre: 'Torneo Cruce Test',
      slug: 'torneo-cruce-test',
      fecha: parseFechaLocal('2026-09-04'), // Viernes 4 de Septiembre 2026
      estado: 'EN_CURSO',
      organizadorId: org.id,
    },
  });

  const cat5ta = await prisma.categoria.create({
    data: { torneoId: torneo.id, nombre: '5ta', estado: 'EN_CURSO' },
  });

  // --- ZONA B (MINI_BRACKET) en Sábado ---
  const zonaB = await prisma.zona.create({
    data: { categoriaId: cat5ta.id, nombre: 'Zona B', clasifican: 3, formato: 'MINI_BRACKET' },
  });
  const parejasB = [];
  for (let i = 1; i <= 4; i++) {
    const p = await prisma.pareja.create({
      data: { categoriaId: cat5ta.id, jugador1: `B_J1_${i}`, jugador2: `B_J2_${i}`, orden: i },
    });
    parejasB.push(p);
    await prisma.zonaPareja.create({ data: { zonaId: zonaB.id, parejaId: p.id } });
  }

  // P1 Zona B: Sábado 08:30 hs ART (11:30 UTC), Cancha 5, FINALIZADO (fin 09:45 hs ART / 12:45 UTC)
  const p1B = await prisma.partido.create({
    data: {
      categoriaId: cat5ta.id,
      zonaId: zonaB.id,
      posicionEnRonda: 1,
      pareja1Id: parejasB[0].id,
      pareja2Id: parejasB[1].id,
      ganadorId: parejasB[0].id,
      estado: 'FINALIZADO',
      fechaHora: new Date('2026-09-05T11:30:00.000Z'),
      canchaNumero: 5,
      sinHorarioAsignado: false,
    },
  });

  // P2 Zona B: Sábado 14:30 hs ART (17:30 UTC), Cancha 1, FINALIZADO (fin 15:45 hs ART / 18:45 UTC)
  const p2B = await prisma.partido.create({
    data: {
      categoriaId: cat5ta.id,
      zonaId: zonaB.id,
      posicionEnRonda: 2,
      pareja1Id: parejasB[2].id,
      pareja2Id: parejasB[3].id,
      ganadorId: parejasB[2].id,
      estado: 'FINALIZADO',
      fechaHora: new Date('2026-09-05T17:30:00.000Z'),
      canchaNumero: 1,
      sinHorarioAsignado: false,
    },
  });

  // P3 Zona B: Sábado 15:45 hs ART (18:45 UTC), Cancha 1, PENDIENTE
  const p3B = await prisma.partido.create({
    data: {
      categoriaId: cat5ta.id,
      zonaId: zonaB.id,
      posicionEnRonda: 3,
      pareja1Id: parejasB[0].id,
      pareja2Id: parejasB[2].id,
      origenPareja1: 'Ganador Partido 1',
      origenPareja2: 'Ganador Partido 2',
      estado: 'PENDIENTE',
      fechaHora: new Date('2026-09-05T18:45:00.000Z'),
      canchaNumero: 1,
      sinHorarioAsignado: false,
    },
  });

  // P4 Zona B: Sábado 09:45 hs ART (12:45 UTC), Cancha 5, PENDIENTE (Figueroa/Esquivel vs Zelaya/Frías)
  const p4B = await prisma.partido.create({
    data: {
      categoriaId: cat5ta.id,
      zonaId: zonaB.id,
      posicionEnRonda: 4,
      pareja1Id: parejasB[1].id,
      pareja2Id: parejasB[3].id,
      origenPareja1: 'Perdedor Partido 1',
      origenPareja2: 'Perdedor Partido 2',
      estado: 'PENDIENTE',
      fechaHora: new Date('2026-09-05T12:45:00.000Z'),
      canchaNumero: 5,
      sinHorarioAsignado: false,
    },
  });

  // --- ZONA H (MINI_BRACKET) en Sábado ---
  const zonaH = await prisma.zona.create({
    data: { categoriaId: cat5ta.id, nombre: 'Zona H', clasifican: 3, formato: 'MINI_BRACKET' },
  });
  const parejasH = [];
  for (let i = 1; i <= 4; i++) {
    const p = await prisma.pareja.create({
      data: { categoriaId: cat5ta.id, jugador1: `H_J1_${i}`, jugador2: `H_J2_${i}`, orden: i + 4 },
    });
    parejasH.push(p);
    await prisma.zonaPareja.create({ data: { zonaId: zonaH.id, parejaId: p.id } });
  }

  // P1 Zona H: Sábado 17:30 hs ART (20:30 UTC), Cancha 1, PENDIENTE (fin 18:45 hs ART / 21:45 UTC)
  const p1H = await prisma.partido.create({
    data: {
      categoriaId: cat5ta.id,
      zonaId: zonaH.id,
      posicionEnRonda: 1,
      pareja1Id: parejasH[0].id,
      pareja2Id: parejasH[1].id,
      estado: 'PENDIENTE',
      fechaHora: new Date('2026-09-05T20:30:00.000Z'),
      canchaNumero: 1,
      sinHorarioAsignado: false,
    },
  });

  // P2 Zona H: Sábado 14:30 hs ART (17:30 UTC), Cancha 6, PENDIENTE (fin 15:45 hs ART / 18:45 UTC)
  const p2H = await prisma.partido.create({
    data: {
      categoriaId: cat5ta.id,
      zonaId: zonaH.id,
      posicionEnRonda: 2,
      pareja1Id: parejasH[2].id,
      pareja2Id: parejasH[3].id,
      estado: 'PENDIENTE',
      fechaHora: new Date('2026-09-05T17:30:00.000Z'),
      canchaNumero: 6,
      sinHorarioAsignado: false,
    },
  });

  // P3 Zona H: Sábado 18:30 hs ART (21:30 UTC), Cancha 2, PENDIENTE (Ganador P1 vs Ganador P2)
  const p3H = await prisma.partido.create({
    data: {
      categoriaId: cat5ta.id,
      zonaId: zonaH.id,
      posicionEnRonda: 3,
      origenPareja1: 'Ganador Partido 1',
      origenPareja2: 'Ganador Partido 2',
      estado: 'PENDIENTE',
      fechaHora: new Date('2026-09-05T21:30:00.000Z'),
      canchaNumero: 2,
      sinHorarioAsignado: false,
    },
  });

  // P4 Zona H: Sábado 18:30 hs ART (21:30 UTC), Cancha 3, PENDIENTE (Perdedor P1 vs Perdedor P2)
  const p4H = await prisma.partido.create({
    data: {
      categoriaId: cat5ta.id,
      zonaId: zonaH.id,
      posicionEnRonda: 4,
      origenPareja1: 'Perdedor Partido 1',
      origenPareja2: 'Perdedor Partido 2',
      estado: 'PENDIENTE',
      fechaHora: new Date('2026-09-05T21:30:00.000Z'),
      canchaNumero: 3,
      sinHorarioAsignado: false,
    },
  });

  // --- Partidos del VIERNES (2026-09-04) en otra categoría para ocupar canchas en Viernes ---
  const cat6ta = await prisma.categoria.create({
    data: { torneoId: torneo.id, nombre: '6ta', estado: 'EN_CURSO' },
  });
  const zonaVie = await prisma.zona.create({
    data: { categoriaId: cat6ta.id, nombre: 'Zona Viernes', clasifican: 2, formato: 'ROUND_ROBIN' },
  });
  const parejasVie = [];
  for (let i = 1; i <= 6; i++) {
    const p = await prisma.pareja.create({
      data: { categoriaId: cat6ta.id, jugador1: `V_J1_${i}`, jugador2: `V_J2_${i}`, orden: i },
    });
    parejasVie.push(p);
  }
  // 3 partidos en viernes en canchas 1, 2, 5
  await prisma.partido.create({
    data: {
      categoriaId: cat6ta.id,
      zonaId: zonaVie.id,
      posicionEnRonda: 1,
      pareja1Id: parejasVie[0].id,
      pareja2Id: parejasVie[1].id,
      estado: 'PENDIENTE',
      fechaHora: new Date('2026-09-04T18:00:00.000Z'),
      canchaNumero: 1,
      sinHorarioAsignado: false,
    },
  });
  await prisma.partido.create({
    data: {
      categoriaId: cat6ta.id,
      zonaId: zonaVie.id,
      posicionEnRonda: 2,
      pareja1Id: parejasVie[2].id,
      pareja2Id: parejasVie[3].id,
      estado: 'PENDIENTE',
      fechaHora: new Date('2026-09-04T18:00:00.000Z'),
      canchaNumero: 2,
      sinHorarioAsignado: false,
    },
  });
  await prisma.partido.create({
    data: {
      categoriaId: cat6ta.id,
      zonaId: zonaVie.id,
      posicionEnRonda: 3,
      pareja1Id: parejasVie[4].id,
      pareja2Id: parejasVie[5].id,
      estado: 'PENDIENTE',
      fechaHora: new Date('2026-09-04T18:00:00.000Z'),
      canchaNumero: 5, // Cancha 5 se inhabilita al reducir a 4 canchas
      sinHorarioAsignado: false,
    },
  });

  const sabadoPartidos = [p1B, p2B, p3B, p4B, p1H, p2H, p3H, p4H];
  const idsSabado = new Set(sabadoPartidos.map((p) => p.id));

  return { org, torneo, sabadoPartidos, idsSabado };
}

async function testA_reproZonaBYZonaH_reducirViernes() {
  console.log('\n======================================================================');
  console.log('TEST (a): Reducir VIERNES no debe alterar partidos de SÁBADO (Zona B y Zona H)');
  console.log('======================================================================');

  const { org, torneo, sabadoPartidos, idsSabado } = await setupEscenario();

  // Snapshot inicial de partidos del sábado
  const snapshotAntes = {};
  for (const p of sabadoPartidos) {
    snapshotAntes[p.id] = {
      fechaHora: p.fechaHora.toISOString(),
      canchaNumero: p.canchaNumero,
      estado: p.estado,
      sinHorarioAsignado: p.sinHorarioAsignado,
    };
  }

  // Reducción del VIERNES a 4 canchas
  console.log('Ejecutando reducción de VIERNES (2026-09-04) a 4 canchas...');
  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 4, null, '2026-09-04');

  // 1. Verificar que NINGÚN partido del sábado cambió su estado, horario o cancha
  const partidosSabadoPost = await prisma.partido.findMany({
    where: { id: { in: Array.from(idsSabado) } },
  });

  const violaciones = [];
  for (const p of partidosSabadoPost) {
    const antes = snapshotAntes[p.id];
    const fechaPost = p.fechaHora ? p.fechaHora.toISOString() : null;

    if (fechaPost !== antes.fechaHora) {
      violaciones.push(`Partido ${p.id} cambió fechaHora: era ${antes.fechaHora}, ahora es ${fechaPost}`);
    }
    if (p.canchaNumero !== antes.canchaNumero) {
      violaciones.push(`Partido ${p.id} cambió cancha: era ${antes.canchaNumero}, ahora es ${p.canchaNumero}`);
    }
    if (p.estado !== antes.estado) {
      violaciones.push(`Partido ${p.id} cambió estado: era ${antes.estado}, ahora es ${p.estado}`);
    }
    if (p.sinHorarioAsignado !== false) {
      violaciones.push(`Partido ${p.id} quedó con sinHorarioAsignado=true`);
    }
  }

  // 2. Verificar que partidosSinSlot del viernes no contiene ningún ID de sábado
  const ovViernes = canchasOverridesService.getCanchasDia(torneo.id, '2026-09-04', 6);
  const sinSlotIds = Object.keys(ovViernes.partidosSinSlot || {});
  const idsSabadoEnSinSlot = sinSlotIds.filter((id) => idsSabado.has(id));

  if (idsSabadoEnSinSlot.length > 0) {
    violaciones.push(`partidosSinSlot del viernes contiene IDs de sábado: ${JSON.stringify(idsSabadoEnSinSlot)}`);
  }

  if (violaciones.length > 0) {
    console.error('❌ FALLÓ TEST (a):');
    for (const v of violaciones) console.error('  - ' + v);
    assert.fail(`Test (a) falló con ${violaciones.length} violaciones:\n${violaciones.join('\n')}`);
  }

  console.log('✅ TEST (a) PASÓ: Todos los partidos del sábado se mantuvieron idénticos y partidosSinSlot no contiene IDs de sábado.');
}

async function testB_reducirYRestaurarMantieneSabadoIdentico() {
  console.log('\n======================================================================');
  console.log('TEST (b): Reducir VIERNES y luego Restaurar VIERNES deja SÁBADO idéntico');
  console.log('======================================================================');

  const { org, torneo, sabadoPartidos, idsSabado } = await setupEscenario();

  const snapshotOriginal = {};
  for (const p of sabadoPartidos) {
    snapshotOriginal[p.id] = {
      fechaHora: p.fechaHora.toISOString(),
      canchaNumero: p.canchaNumero,
      estado: p.estado,
      sinHorarioAsignado: p.sinHorarioAsignado,
    };
  }

  // 1. Reducir viernes a 4 canchas
  console.log('Paso 1: Reduciendo viernes a 4 canchas...');
  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 4, null, '2026-09-04');

  // 2. Restaurar viernes a 6 canchas
  console.log('Paso 2: Restaurando viernes a 6 canchas...');
  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 6, null, '2026-09-04');

  // 3. Verificar que sábado quedó exactamente idéntico al original
  const partidosSabadoPost = await prisma.partido.findMany({
    where: { id: { in: Array.from(idsSabado) } },
  });

  const violaciones = [];
  for (const p of partidosSabadoPost) {
    const orig = snapshotOriginal[p.id];
    const fechaPost = p.fechaHora ? p.fechaHora.toISOString() : null;

    if (fechaPost !== orig.fechaHora) {
      violaciones.push(`Partido ${p.id} cambió fechaHora tras restaurar: orig=${orig.fechaHora}, post=${fechaPost}`);
    }
    if (p.canchaNumero !== orig.canchaNumero) {
      violaciones.push(`Partido ${p.id} cambió cancha tras restaurar: orig=${orig.canchaNumero}, post=${p.canchaNumero}`);
    }
    if (p.sinHorarioAsignado !== false) {
      violaciones.push(`Partido ${p.id} quedó sinHorarioAsignado=true tras restaurar`);
    }
  }

  // Overrides restantes
  const ovViernesPost = canchasOverridesService.getCanchasDia(torneo.id, '2026-09-04', 6);
  const sinSlotPost = Object.keys(ovViernesPost.partidosSinSlot || {});
  const idsSabadoEnSinSlot = sinSlotPost.filter((id) => idsSabado.has(id));
  if (idsSabadoEnSinSlot.length > 0) {
    violaciones.push(`partidosSinSlot contiene IDs de sábado tras restaurar: ${JSON.stringify(idsSabadoEnSinSlot)}`);
  }

  if (violaciones.length > 0) {
    console.error('❌ FALLÓ TEST (b):');
    for (const v of violaciones) console.error('  - ' + v);
    assert.fail(`Test (b) falló con ${violaciones.length} violaciones:\n${violaciones.join('\n')}`);
  }

  console.log('✅ TEST (b) PASÓ: El sábado quedó exactamente idéntico tras reducir y restaurar el viernes.');
}

async function testC_guardEnEscritura_bloqueaIdsDeOtraJornada() {
  console.log('\n======================================================================');
  console.log('TEST (c): Guard en escritura impide que IDs de sábado se registren en viernes');
  console.log('======================================================================');

  const { org, torneo, idsSabado, sabadoPartidos } = await setupEscenario();

  // Escenario: El override de viernes ya viene con un mapa corrupto que contiene un ID de sábado
  const unPartidoSabado = sabadoPartidos[0];
  const mapaCorrupto = {
    [unPartidoSabado.id]: 'Desplazado erróneamente en corrida previa',
  };

  await canchasOverridesService.setOverrideDia(
    torneo.id,
    '2026-09-04',
    4,
    new Date('2026-09-04T12:00:00.000Z'),
    mapaCorrupto
  );

  // Ejecutar una reducción del viernes que de verdad reprograme (de 4 a 3 canchas)
  console.log('Ejecutando reducción de viernes con mapa previo corrupto...');
  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 3, null, '2026-09-04');

  // Verificar que el guard de saneamiento y el guard en escritura eliminaron el ID de sábado
  const ovViernes = canchasOverridesService.getCanchasDia(torneo.id, '2026-09-04', 6);
  const sinSlotViernes = ovViernes.partidosSinSlot || {};
  const idsSabadoEnMapa = Object.keys(sinSlotViernes).filter((id) => idsSabado.has(id));

  assert.strictEqual(
    idsSabadoEnMapa.length,
    0,
    `El mapa partidosSinSlot del viernes no debe contener IDs de sábado. Encontrados: ${JSON.stringify(idsSabadoEnMapa)}`
  );

  // Verificar que el partido de sábado no fue alterado en la base de datos
  const partidoDb = await prisma.partido.findUnique({
    where: { id: unPartidoSabado.id },
  });
  assert.strictEqual(
    partidoDb.sinHorarioAsignado,
    false,
    'El partido de sábado no debe quedar sinHorarioAsignado=true'
  );
  assert.notStrictEqual(
    partidoDb.fechaHora,
    null,
    'El partido de sábado no debe perder su fechaHora'
  );
  assert.strictEqual(
    partidoDb.canchaNumero,
    unPartidoSabado.canchaNumero,
    'El partido de sábado debe conservar su cancha'
  );

  console.log('✅ TEST (c) PASÓ: El guard en escritura y saneamiento bloqueó la persistencia de IDs de sábado en viernes.');
}

async function run() {
  let fallas = 0;
  try {
    await testA_reproZonaBYZonaH_reducirViernes();
  } catch (err) {
    console.error('Error en Test (a):', err);
    fallas++;
  }

  try {
    await testB_reducirYRestaurarMantieneSabadoIdentico();
  } catch (err) {
    console.error('Error en Test (b):', err);
    fallas++;
  }

  try {
    await testC_guardEnEscritura_bloqueaIdsDeOtraJornada();
  } catch (err) {
    console.error('Error en Test (c):', err);
    fallas++;
  }

  await prisma.$disconnect();

  if (fallas > 0) {
    console.error(`\n❌ ${fallas} test(s) fallaron.`);
    process.exit(1);
  }
  process.exit(0);
}

run().catch((err) => {
  console.error('\nError en ejecución de suite:', err.message);
  process.exit(1);
});
