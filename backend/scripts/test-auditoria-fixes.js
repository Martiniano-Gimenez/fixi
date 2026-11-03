const { ensureTestDb } = require('./utils/testEnvGuard');
const prisma = require('../src/lib/prisma');
const { generarEliminatoria, ordenarZonaParejas } = require('../src/services/faseEliminatoria.service');
const { propagarMiniBracket } = require('../src/services/partido.service');
const { reiniciarTorneo } = require('../src/services/torneo.service');
const { preCheckInicioTorneo, preCheckSessions } = require('../src/services/organizador.service');
const { asignarHorariosRondaUno } = require('../src/services/eliminatoriaScheduler.service');
const { asignarHorariosModoLluviaMCF } = require('../src/services/zona.service');
const canchasOverridesService = require('../src/services/canchasOverrides.service');
const crypto = require('crypto');

async function main() {
  await ensureTestDb();
  console.log('🧪 Iniciando test suite: test-auditoria-fixes.js...\n');
  await canchasOverridesService.loadFromDb();

  let organizador = null;
  try {
    const orgEmail = `test-audit-${Date.now()}@padel.com`;
    organizador = await prisma.organizador.create({
    data: {
      nombre: 'Club Auditoria',
      email: orgEmail,
      passwordHash: 'dummy',
      cantidadCanchas: 4,
      viernesInicio: '08:00',
      viernesFin: '22:00',
      sabadoInicio: '08:00',
      sabadoFin: '22:00',
      domingoInicio: '08:00',
      domingoFin: '22:00',
    },
  });

  // =========================================================================
  // TEST 1: Mini-Bracket y Round Robin en generarEliminatoria
  // =========================================================================
  console.log('🔹 Test 1: Clasificación de Mini-Bracket respetando posicion y Round Robin desempate...');
  const torneo1 = await prisma.torneo.create({
    data: {
      organizadorId: organizador.id,
      nombre: 'Torneo Test 1',
      slug: `t1-${crypto.randomBytes(3).toString('hex')}`,
      fecha: new Date('2026-09-11T12:00:00.000Z'),
      estado: 'EN_CURSO',
    },
  });

  const catMB = await prisma.categoria.create({
    data: {
      torneoId: torneo1.id,
      nombre: 'Cat MiniBracket',
      estado: 'EN_CURSO',
    },
  });

  const pA = await prisma.pareja.create({ data: { categoriaId: catMB.id, orden: 1, jugador1: 'A1', jugador2: 'A2' } });
  const pB = await prisma.pareja.create({ data: { categoriaId: catMB.id, orden: 2, jugador1: 'B1', jugador2: 'B2' } });
  const pC = await prisma.pareja.create({ data: { categoriaId: catMB.id, orden: 3, jugador1: 'C1', jugador2: 'C2' } });
  const pD = await prisma.pareja.create({ data: { categoriaId: catMB.id, orden: 4, jugador1: 'D1', jugador2: 'D2' } });

  const zonaMB = await prisma.zona.create({
    data: {
      categoriaId: catMB.id,
      nombre: 'Zona MB',
      clasifican: 2,
      formato: 'MINI_BRACKET',
    },
  });

  // ZonaParejas iniciales
  await prisma.zonaPareja.create({ data: { zonaId: zonaMB.id, parejaId: pA.id } });
  await prisma.zonaPareja.create({ data: { zonaId: zonaMB.id, parejaId: pB.id } });
  await prisma.zonaPareja.create({ data: { zonaId: zonaMB.id, parejaId: pC.id } });
  await prisma.zonaPareja.create({ data: { zonaId: zonaMB.id, parejaId: pD.id } });

  // Partidos Mini-Bracket:
  // P1: pA vs pB -> gana pA
  const m1 = await prisma.partido.create({
    data: {
      categoriaId: catMB.id,
      zonaId: zonaMB.id,
      posicionEnRonda: 1,
      pareja1Id: pA.id,
      pareja2Id: pB.id,
      ganadorId: pA.id,
      estado: 'FINALIZADO',
    },
  });
  await prisma.setPartido.create({ data: { partidoId: m1.id, numero: 1, gamesPareja1: 6, gamesPareja2: 0 } });
  await prisma.setPartido.create({ data: { partidoId: m1.id, numero: 2, gamesPareja1: 6, gamesPareja2: 0 } });

  // P2: pC vs pD -> gana pC
  const m2 = await prisma.partido.create({
    data: {
      categoriaId: catMB.id,
      zonaId: zonaMB.id,
      posicionEnRonda: 2,
      pareja1Id: pC.id,
      pareja2Id: pD.id,
      ganadorId: pC.id,
      estado: 'FINALIZADO',
    },
  });
  await prisma.setPartido.create({ data: { partidoId: m2.id, numero: 1, gamesPareja1: 6, gamesPareja2: 0 } });
  await prisma.setPartido.create({ data: { partidoId: m2.id, numero: 2, gamesPareja1: 6, gamesPareja2: 0 } });

  // P3 (Ganadores): pA vs pC -> gana pA (1°), pC queda 2°
  const m3 = await prisma.partido.create({
    data: {
      categoriaId: catMB.id,
      zonaId: zonaMB.id,
      posicionEnRonda: 3,
      pareja1Id: pA.id,
      pareja2Id: pC.id,
      ganadorId: pA.id,
      estado: 'FINALIZADO',
    },
  });
  await prisma.setPartido.create({ data: { partidoId: m3.id, numero: 1, gamesPareja1: 6, gamesPareja2: 0 } });
  await prisma.setPartido.create({ data: { partidoId: m3.id, numero: 2, gamesPareja1: 6, gamesPareja2: 0 } });

  // P4 (Perdedores): pB vs pD -> gana pB (3°), pD queda 4°
  const m4 = await prisma.partido.create({
    data: {
      categoriaId: catMB.id,
      zonaId: zonaMB.id,
      posicionEnRonda: 4,
      pareja1Id: pB.id,
      pareja2Id: pD.id,
      ganadorId: pB.id,
      estado: 'FINALIZADO',
    },
  });
  await prisma.setPartido.create({ data: { partidoId: m4.id, numero: 1, gamesPareja1: 6, gamesPareja2: 0 } });
  await prisma.setPartido.create({ data: { partidoId: m4.id, numero: 2, gamesPareja1: 6, gamesPareja2: 0 } });

  // Propagar Mini-Bracket para asentar posiciones y stats
  await propagarMiniBracket(zonaMB.id);

  // Ambas parejas pC (2do) y pB (3ro) tienen 3 puntos y 1 PG:
  const zpC = await prisma.zonaPareja.findUnique({ where: { zonaId_parejaId: { zonaId: zonaMB.id, parejaId: pC.id } } });
  const zpB = await prisma.zonaPareja.findUnique({ where: { zonaId_parejaId: { zonaId: zonaMB.id, parejaId: pB.id } } });
  if (zpC.puntos !== 3 || zpB.puntos !== 3 || zpC.posicion !== 2 || zpB.posicion !== 3) {
    throw new Error(`Fallo en setup de stats: pC pos=${zpC.posicion} pts=${zpC.puntos}, pB pos=${zpB.posicion} pts=${zpB.puntos}`);
  }

  // Generar Eliminatoria y verificar quién clasifica como 2°
  await generarEliminatoria(organizador.id, catMB.id);

  // En el bracket, los clasificados deben ser pA (1°) y pC (2°), NUNCA pB (3°)
  const partidosCuadro = await prisma.partido.findMany({
    where: { categoriaId: catMB.id, faseEliminatoriaId: { not: null } },
  });
  const parejasEnCuadro = new Set(partidosCuadro.flatMap((p) => [p.pareja1Id, p.pareja2Id]).filter(Boolean));

  if (!parejasEnCuadro.has(pC.id)) {
    throw new Error(`FALLO CRÍTICO: La Pareja C (2° puesto) NO fue clasificada al cuadro eliminatorio!`);
  }
  if (parejasEnCuadro.has(pB.id)) {
    throw new Error(`FALLO CRÍTICO: La Pareja B (3° puesto) fue erróneamente clasificada al cuadro eliminatorio!`);
  }
  console.log('  ✅ Verificado: Mini-Bracket clasificó a Pareja A (1°) y Pareja C (2°), descartando a Pareja B (3°).');

  // Verificar ordenarZonaParejas para Round Robin
  const mockRR = [
    { id: '1', puntos: 3, pg: 1, sf: 2, sc: 1, gf: 15, gc: 10 }, // diffSets +1, diffGames +5
    { id: '2', puntos: 3, pg: 1, sf: 2, sc: 0, gf: 12, gc: 2 },  // diffSets +2, diffGames +10 -> DEBE SER 1°
    { id: '3', puntos: 3, pg: 1, sf: 2, sc: 1, gf: 14, gc: 12 }, // diffSets +1, diffGames +2
  ];
  const sortedRR = ordenarZonaParejas(mockRR, 'ROUND_ROBIN');
  if (sortedRR[0].id !== '2' || sortedRR[1].id !== '1' || sortedRR[2].id !== '3') {
    throw new Error(`Fallo en desempate Round Robin: orden obtenido ${sortedRR.map(r => r.id).join(',')}`);
  }
  console.log('  ✅ Verificado: Round Robin desempata correctamente por sets y games.');

  // =========================================================================
  // TEST 2: reiniciarTorneo limpia resolucionManual y campos Modo Lluvia
  // =========================================================================
  console.log('\n🔹 Test 2: reiniciarTorneo resetea resolucionManual y Modo Lluvia...');
  const torneo2 = await prisma.torneo.create({
    data: {
      organizadorId: organizador.id,
      nombre: 'Torneo Test 2',
      slug: `t2-${crypto.randomBytes(3).toString('hex')}`,
      fecha: new Date('2026-09-11T12:00:00.000Z'),
      estado: 'EN_CURSO',
      canchasDisponiblesOverride: 2,
      overrideActivoDesde: new Date(),
    },
  });

  const cat2 = await prisma.categoria.create({
    data: { torneoId: torneo2.id, nombre: 'Cat 2', estado: 'EN_CURSO' },
  });

  const pRes = await prisma.pareja.create({
    data: { categoriaId: cat2.id, orden: 1, jugador1: 'R1', jugador2: 'R2', resolucionManual: true },
  });

  await reiniciarTorneo(organizador.id, torneo2.id);

  const t2Post = await prisma.torneo.findUnique({ where: { id: torneo2.id } });
  const pResPost = await prisma.pareja.findUnique({ where: { id: pRes.id } });

  if (t2Post.estado !== 'BORRADOR' || t2Post.canchasDisponiblesOverride !== null || t2Post.overrideActivoDesde !== null) {
    throw new Error('Fallo: Torneo 2 no limpió estado de Modo Lluvia al reiniciarse.');
  }
  if (pResPost.resolucionManual !== false) {
    throw new Error('Fallo: Pareja retuvo resolucionManual: true tras reiniciarTorneo.');
  }
  console.log('  ✅ Verificado: reiniciarTorneo limpió resolucionManual = false y reseteó overrides a null.');

  // =========================================================================
  // TEST 3: Pre-Check cache invalidation ante altas/bajas de parejas
  // =========================================================================
  console.log('\n🔹 Test 3: Invalidación de snapshot en pre-check ante cambios de parejas...');
  const torneo3 = await prisma.torneo.create({
    data: {
      organizadorId: organizador.id,
      nombre: 'Torneo Test 3',
      slug: `t3-${crypto.randomBytes(3).toString('hex')}`,
      fecha: new Date('2026-09-11T12:00:00.000Z'),
      estado: 'BORRADOR',
    },
  });

  const cat3 = await prisma.categoria.create({
    data: { torneoId: torneo3.id, nombre: 'Cat 3', estado: 'BORRADOR' },
  });

  const p3_1 = await prisma.pareja.create({ data: { categoriaId: cat3.id, orden: 1, jugador1: 'X1', jugador2: 'X2' } });
  const p3_2 = await prisma.pareja.create({ data: { categoriaId: cat3.id, orden: 2, jugador1: 'X3', jugador2: 'X4' } });
  await prisma.slotPareja.create({ data: { parejaId: p3_1.id, slotId: 'Viernes-18:00' } });
  await prisma.slotPareja.create({ data: { parejaId: p3_2.id, slotId: 'Viernes-18:00' } });

  // 1er pre-check -> crea snapshot
  await preCheckInicioTorneo(organizador.id, torneo3.id);
  const session1 = preCheckSessions.get(torneo3.id);
  if (!session1 || !session1.parejaIdsHash) {
    throw new Error('Fallo: session1 no registró parejaIdsHash.');
  }

  // Agregamos una 3ra pareja en DB
  const p3_3 = await prisma.pareja.create({ data: { categoriaId: cat3.id, orden: 3, jugador1: 'X5', jugador2: 'X6' } });
  await prisma.slotPareja.create({ data: { parejaId: p3_3.id, slotId: 'Viernes-18:00' } });

  const cambioNomina = await preCheckInicioTorneo(organizador.id, torneo3.id);
  if (!cambioNomina.nominaCambio || preCheckSessions.get(torneo3.id) !== session1) {
    throw new Error('La nomina cambiada debe bloquear sin descartar el plan.');
  }
  await preCheckInicioTorneo(organizador.id, torneo3.id, { forceReset: true });
  if (!preCheckSessions.get(torneo3.id).parejaIdsHash.includes(p3_3.id)) throw new Error('Rearmado explicito fallido');

  // =========================================================================
  // TEST 4: eliminatoriaScheduler respeta categoriaId
  // =========================================================================
  console.log('\n🔹 Test 4: eliminatoriaScheduler filtra por categoriaId...');
  const torneo4 = await prisma.torneo.create({
    data: {
      organizadorId: organizador.id,
      nombre: 'Torneo Test 4',
      slug: `t4-${crypto.randomBytes(3).toString('hex')}`,
      fecha: new Date('2026-09-11T12:00:00.000Z'),
      estado: 'EN_CURSO',
    },
  });

  const catA = await prisma.categoria.create({ data: { torneoId: torneo4.id, nombre: 'Cat A', estado: 'EN_CURSO' } });
  const catB = await prisma.categoria.create({ data: { torneoId: torneo4.id, nombre: 'Cat B', estado: 'EN_CURSO' } });

  const pA1 = await prisma.pareja.create({ data: { categoriaId: catA.id, orden: 1, jugador1: 'A1', jugador2: 'A2' } });
  const pA2 = await prisma.pareja.create({ data: { categoriaId: catA.id, orden: 2, jugador1: 'A3', jugador2: 'A4' } });
  const pB1 = await prisma.pareja.create({ data: { categoriaId: catB.id, orden: 1, jugador1: 'B1', jugador2: 'B2' } });
  const pB2 = await prisma.pareja.create({ data: { categoriaId: catB.id, orden: 2, jugador1: 'B3', jugador2: 'B4' } });

  const faseA = await prisma.faseEliminatoria.create({ data: { categoriaId: catA.id, nombre: 'Final', ronda: 2 } });
  const faseB = await prisma.faseEliminatoria.create({ data: { categoriaId: catB.id, nombre: 'Final', ronda: 2 } });

  const partidoA = await prisma.partido.create({
    data: {
      categoriaId: catA.id,
      faseEliminatoriaId: faseA.id,
      posicionEnRonda: 1,
      pareja1Id: pA1.id,
      pareja2Id: pA2.id,
      estado: 'PENDIENTE',
      fechaHora: new Date('2026-09-13T15:00:00.000Z'), // Ya agendado a las 12:00
      canchaNumero: 3,
    },
  });

  const partidoB = await prisma.partido.create({
    data: {
      categoriaId: catB.id,
      faseEliminatoriaId: faseB.id,
      posicionEnRonda: 1,
      pareja1Id: pB1.id,
      pareja2Id: pB2.id,
      estado: 'PENDIENTE',
      fechaHora: null,
      canchaNumero: null,
      sinHorarioAsignado: true,
    },
  });

  // Ejecutamos scheduler indicando SOLO catB
  await asignarHorariosRondaUno(organizador.id, torneo4.id, catB.id);

  const partidoAPost = await prisma.partido.findUnique({ where: { id: partidoA.id } });
  const partidoBPost = await prisma.partido.findUnique({ where: { id: partidoB.id } });

  // Partido A no debe haber cambiado
  if (partidoAPost.canchaNumero !== 3 || partidoAPost.fechaHora.toISOString() !== '2026-09-13T15:00:00.000Z') {
    throw new Error('Fallo: partidoA fue modificado a pesar de filtrar por catB.id!');
  }
  // Partido B debe haberse asignado en domingo
  if (!partidoBPost.fechaHora || !partidoBPost.canchaNumero) {
    throw new Error('Fallo: partidoB no fue agendado.');
  }
  console.log('  ✅ Verificado: asignarHorariosRondaUno con categoriaId no tocó la categoría A.');

  // =========================================================================
  // TEST 5: Modo Lluvia y fallback Infinity
  // =========================================================================
  console.log('\n🔹 Test 5: Modo Lluvia respeta prioridad y envía partidos sin horario previo al final...');
  const torneo5 = await prisma.torneo.create({
    data: {
      organizadorId: organizador.id,
      nombre: 'Torneo Test 5',
      slug: `t5-${crypto.randomBytes(3).toString('hex')}`,
      fecha: new Date('2026-09-11T12:00:00.000Z'),
      estado: 'EN_CURSO',
    },
  });
  const cat5 = await prisma.categoria.create({ data: { torneoId: torneo5.id, nombre: 'Cat 5', estado: 'EN_CURSO' } });
  const zona5 = await prisma.zona.create({ data: { categoriaId: cat5.id, nombre: 'Zona 5', formato: 'ROUND_ROBIN' } });

  const p5_1 = await prisma.pareja.create({ data: { categoriaId: cat5.id, orden: 1, jugador1: 'P1', jugador2: 'P2' } });
  const p5_2 = await prisma.pareja.create({ data: { categoriaId: cat5.id, orden: 2, jugador1: 'P3', jugador2: 'P4' } });
  const p5_3 = await prisma.pareja.create({ data: { categoriaId: cat5.id, orden: 3, jugador1: 'P5', jugador2: 'P6' } });
  const p5_4 = await prisma.pareja.create({ data: { categoriaId: cat5.id, orden: 4, jugador1: 'P7', jugador2: 'P8' } });

  // Partido con horario fijado a las 10:00 AM
  const pConHorario = await prisma.partido.create({
    data: {
      categoriaId: cat5.id,
      zonaId: zona5.id,
      posicionEnRonda: 1,
      pareja1Id: p5_1.id,
      pareja2Id: p5_2.id,
      estado: 'PENDIENTE',
      fechaHora: new Date('2026-09-11T13:00:00.000Z'), // 10:00 AM local
      canchaNumero: 1,
    },
  });

  // Partido de zona sin horario previo pero registrado en partidosSinSlot (Tier 0 al final por fechaHora null)
  const pSinHorarioEnMapa = await prisma.partido.create({
    data: {
      categoriaId: cat5.id,
      zonaId: zona5.id,
      posicionEnRonda: 2,
      pareja1Id: p5_3.id,
      pareja2Id: p5_4.id,
      estado: 'PENDIENTE',
      fechaHora: null,
      canchaNumero: null,
      sinHorarioAsignado: true,
    },
  });

  // Partido de zona sin horario NO registrado en partidosSinSlot (debe quedar intacto)
  const p5_5 = await prisma.pareja.create({ data: { categoriaId: cat5.id, orden: 5, jugador1: 'P9', jugador2: 'P10' } });
  const p5_6 = await prisma.pareja.create({ data: { categoriaId: cat5.id, orden: 6, jugador1: 'P11', jugador2: 'P12' } });
  const pSinHorarioFueraMapa = await prisma.partido.create({
    data: {
      categoriaId: cat5.id,
      zonaId: zona5.id,
      posicionEnRonda: 3,
      pareja1Id: p5_5.id,
      pareja2Id: p5_6.id,
      estado: 'PENDIENTE',
      fechaHora: null,
      canchaNumero: null,
      sinHorarioAsignado: true,
    },
  });

  // Registrar pSinHorarioEnMapa en el mapa de partidosSinSlot de la jornada ('2026-09-11')
  await canchasOverridesService.setOverrideDia(
    torneo5.id,
    '2026-09-11',
    2,
    new Date('2026-09-11T12:00:00.000Z'),
    { [pSinHorarioEnMapa.id]: 'Sin cancha activa libre disponible en ese horario' }
  );

  // Ejecutamos Modo Lluvia
  await prisma.$transaction(async (tx) => {
    await asignarHorariosModoLluviaMCF(organizador.id, torneo5.id, 2, tx, new Date('2026-09-11T12:00:00.000Z'));
  });

  const pConHorarioPost = await prisma.partido.findUnique({ where: { id: pConHorario.id } });
  const pSinHorarioEnMapaPost = await prisma.partido.findUnique({ where: { id: pSinHorarioEnMapa.id } });
  const pSinHorarioFueraMapaPost = await prisma.partido.findUnique({ where: { id: pSinHorarioFueraMapa.id } });

  // 1. Contrato: El partido pendiente fuera del mapa NO se toca
  if (pSinHorarioFueraMapaPost.fechaHora !== null || !pSinHorarioFueraMapaPost.sinHorarioAsignado) {
    throw new Error('FALLO: El partido sin horario fuera de partidosSinSlot fue modificado cuando debía quedar intacto!');
  }

  // 2. Contrato: El partido en mapa se agenda y respeta prioridad (después del que tenía horario asignado)
  if (!pSinHorarioEnMapaPost.fechaHora) {
    throw new Error('FALLO: El partido en partidosSinSlot no recibió fechaHora!');
  }

  const tCon = new Date(pConHorarioPost.fechaHora).getTime();
  const tSin = new Date(pSinHorarioEnMapaPost.fechaHora).getTime();

  if (tCon > tSin) {
    throw new Error('FALLO: El partido sin horario previo en mapa saltó antes del partido que tenía horario asignado!');
  }
  console.log(`  ✅ Verificado: Partido fuera del mapa quedó intacto (sin horario), y partido en mapa (${new Date(pSinHorarioEnMapaPost.fechaHora).toISOString()}) quedó después del partido con horario previo (${new Date(pConHorarioPost.fechaHora).toISOString()}).`);

  console.log('\n🎉 TODOS LOS TESTS DE AUDITORÍA PASARON EXITOSAMENTE AL 100%!');
  } finally {
    if (organizador) {
      const torneos = await prisma.torneo.findMany({ where: { organizadorId: organizador.id }, select: { id: true } });
      const tIds = torneos.map(t => t.id);
      await prisma.setPartido.deleteMany({ where: { partido: { categoria: { torneoId: { in: tIds } } } } });
      await prisma.partido.deleteMany({ where: { categoria: { torneoId: { in: tIds } } } });
      await prisma.faseEliminatoria.deleteMany({ where: { categoria: { torneoId: { in: tIds } } } });
      await prisma.zonaPareja.deleteMany({ where: { zona: { categoria: { torneoId: { in: tIds } } } } });
      await prisma.zona.deleteMany({ where: { categoria: { torneoId: { in: tIds } } } });
      await prisma.slotPareja.deleteMany({ where: { pareja: { categoria: { torneoId: { in: tIds } } } } });
      await prisma.pareja.deleteMany({ where: { categoria: { torneoId: { in: tIds } } } });
      await prisma.overrideCanchasDia.deleteMany({ where: { torneoId: { in: tIds } } });
      await prisma.categoria.deleteMany({ where: { torneoId: { in: tIds } } });
      await prisma.torneo.deleteMany({ where: { id: { in: tIds } } });
      await prisma.organizador.deleteMany({ where: { id: organizador.id } });
      console.log('✓ Limpieza de datos de test-auditoria-fixes completada en bloque finally.');
    }
  }
}

main()
  .catch((err) => {
    console.error('\n❌ ERROR EN TEST SUITE:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
