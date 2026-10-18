/**
 * Suite de tests: Invariante R32 y Fin de Zonas
 *
 * Casos cubiertos:
 * 1. Repro original (en rojo resuelto): R32 no inicia antes del fin de zonas en post-inicio, post-reducción y post-restauración.
 * 2. Caso (a): Zonas terminan el viernes -> R32 se agenda normalmente el sábado a las 20:45.
 * 3. Caso (b): Sin hueco antes del cierre de jornada del sábado -> R32 queda con sinHorarioAsignado: true.
 * 4. Caso (c): Una zona de la categoría tiene algún partido sin horario -> R32 queda pendiente (sinHorarioAsignado: true).
 *
 * Cada caso pasa por el camino real del scheduler (programarHorariosEliminatorias).
 */

require('./utils/testEnvGuard');
const { ensureTestDb } = require('./utils/testEnvGuard');
const { resetTestDb } = require('./reset-test-db');
const prisma = require('../src/lib/prisma');
const canchasOverridesService = require('../src/services/canchasOverrides.service');
const zonaService = require('../src/services/zona.service');
const organizadorService = require('../src/services/organizador.service');
const { parseFechaLocal } = require('../src/utils/dateUtils');
const { generarEliminatoria } = require('../src/services/faseEliminatoria.service');
const { programarHorariosEliminatorias } = require('../src/services/eliminatoriaScheduler.service');

const DURACION_MS = 75 * 60 * 1000;

async function limpiarDb() {
  await prisma.setPartido.deleteMany();
  await prisma.partido.deleteMany();
  await prisma.zonaPareja.deleteMany();
  await prisma.faseEliminatoria.deleteMany();
  await prisma.zona.deleteMany();
  await prisma.slotPareja.deleteMany();
  await prisma.pareja.deleteMany();
  await prisma.categoria.deleteMany();
  await prisma.overrideCanchasDia.deleteMany();
  await prisma.torneo.deleteMany();
  await prisma.organizador.deleteMany();
}

/**
 * CASO 1 (Repro en rojo resuelto):
 * Zonas terminan el sábado a las 23:15.
 * R32 no puede empezar a las 20:45. Pasa en post-inicio, post-reducción y post-restauración.
 */
async function testRepro_zonasTerminanTarde_R32NoArrancaAntes(registrar) {
  await limpiarDb();

  const org = await prisma.organizador.create({
    data: {
      nombre: 'Club Repro R32',
      email: 'repro-r32@padel.test',
      passwordHash: 'hash',
      cantidadCanchas: 2,
      viernesInicio: '18:00',
      viernesFin: '23:00',
      sabadoInicio: '09:00',
      sabadoFin: '23:00',
      domingoInicio: '09:00',
      domingoFin: '22:00',
    },
  });

  const torneo = await prisma.torneo.create({
    data: {
      nombre: 'Torneo Repro R32',
      slug: 'torneo-repro-r32',
      fecha: parseFechaLocal('2026-09-04'),
      estado: 'BORRADOR',
      organizadorId: org.id,
    },
  });

  const cat = await prisma.categoria.create({
    data: { torneoId: torneo.id, nombre: '6ta', estado: 'BORRADOR' },
  });

  for (let i = 1; i <= 25; i++) {
    const p = await prisma.pareja.create({
      data: { categoriaId: cat.id, jugador1: `J1_${i}`, jugador2: `J2_${i}`, orden: i },
    });
    if (i <= 4) {
      await prisma.slotPareja.create({ data: { parejaId: p.id, slotId: 'Sabado-22:00' } });
    }
  }

  await zonaService.iniciarCategoria(org.id, cat.id);
  await zonaService.asignarHorariosAutomatico(org.id, [cat.id]);
  await prisma.torneo.update({ where: { id: torneo.id }, data: { estado: 'EN_CURSO' } });
  await generarEliminatoria(org.id, cat.id);
  await programarHorariosEliminatorias(org.id, torneo.id);

  const checkEtapa = async (etapa) => {
    const partidos = await prisma.partido.findMany({
      where: { categoriaId: cat.id },
      include: { faseEliminatoria: true },
    });
    const maxZonaEnd = Math.max(
      ...partidos
        .filter((p) => p.zonaId && p.fechaHora && !p.sinHorarioAsignado)
        .map((p) => new Date(p.fechaHora).getTime() + DURACION_MS)
    );
    const elimAntes = partidos.find(
      (p) =>
        p.faseEliminatoriaId &&
        p.fechaHora &&
        !p.sinHorarioAsignado &&
        !p.esBye &&
        new Date(p.fechaHora).getTime() < maxZonaEnd
    );
    registrar(
      `repro_zonas_tarde:${etapa}`,
      !elimAntes,
      elimAntes
        ? `Ronda ${elimAntes.faseEliminatoria.ronda} empieza antes del fin de zonas (${new Date(maxZonaEnd).toISOString()})`
        : 'OK'
    );
  };

  await checkEtapa('post-inicio');
  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 1, null, '2026-09-04');
  await checkEtapa('post-reduccion');
  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 2, null, '2026-09-04');
  await checkEtapa('post-restauracion');
}

/**
 * CASO (a): Zonas terminan el viernes -> R32 sigue a las 20:45 del sábado
 */
async function testCasoA_zonasTerminanViernes_R32Sigue2045(registrar) {
  await limpiarDb();

  const org = await prisma.organizador.create({
    data: {
      nombre: 'Club Zonas Viernes',
      email: 'zonas-viernes@padel.test',
      passwordHash: 'hash',
      cantidadCanchas: 6,
      viernesInicio: '15:00',
      viernesFin: '23:00',
      sabadoInicio: '09:00',
      sabadoFin: '24:00',
      domingoInicio: '09:00',
      domingoFin: '22:00',
    },
  });

  const torneo = await prisma.torneo.create({
    data: {
      nombre: 'Torneo Zonas Viernes',
      slug: 'torneo-zonas-viernes',
      fecha: parseFechaLocal('2026-09-04'),
      estado: 'BORRADOR',
      organizadorId: org.id,
    },
  });

  const cat = await prisma.categoria.create({
    data: { torneoId: torneo.id, nombre: '6ta', estado: 'BORRADOR' },
  });

  // 25 parejas, todas disponibles exclusivamente en slots del viernes desde las 15:00
  const slotsViernes = [
    'Viernes-15:00', 'Viernes-16:15', 'Viernes-17:30',
    'Viernes-18:45', 'Viernes-20:00', 'Viernes-21:15'
  ];
  for (let i = 1; i <= 25; i++) {
    const p = await prisma.pareja.create({
      data: { categoriaId: cat.id, jugador1: `J1_${i}`, jugador2: `J2_${i}`, orden: i },
    });
    for (const s of slotsViernes) {
      await prisma.slotPareja.create({ data: { parejaId: p.id, slotId: s } });
    }
  }

  await zonaService.iniciarCategoria(org.id, cat.id);
  await zonaService.asignarHorariosAutomatico(org.id, [cat.id]);
  await prisma.torneo.update({ where: { id: torneo.id }, data: { estado: 'EN_CURSO' } });
  await generarEliminatoria(org.id, cat.id);
  await programarHorariosEliminatorias(org.id, torneo.id);

  const partidos = await prisma.partido.findMany({
    where: { categoriaId: cat.id },
    include: { faseEliminatoria: true },
  });

  const partidosZona = partidos.filter((p) => p.zonaId);
  const maxZonaEnd = Math.max(
    ...partidosZona
      .filter((p) => p.fechaHora && !p.sinHorarioAsignado)
      .map((p) => new Date(p.fechaHora).getTime() + DURACION_MS)
  );

  // Verificar que todas las zonas terminaron el viernes (antes de sábado 00:00)
  const baseSaturday = zonaService.proximaFechaPorDia('Sabado', parseFechaLocal('2026-09-04'));
  const zonasTerminaronViernes = maxZonaEnd < baseSaturday.getTime();

  // Partidos R32 asignados
  const r32Partidos = partidos.filter(
    (p) => p.faseEliminatoria && p.faseEliminatoria.ronda >= 32 && !p.esBye
  );

  const todosAsignados = r32Partidos.length > 0 && r32Partidos.every((p) => p.fechaHora && !p.sinHorarioAsignado);

  // Verificar que el primer R32 arranca a las 20:45 de Buenos Aires (-03:00)
  // 20:45 ART = 23:45 UTC
  const primerR32 = r32Partidos.sort((a, b) => new Date(a.fechaHora) - new Date(b.fechaHora))[0];
  const primerHoraIso = primerR32?.fechaHora ? new Date(primerR32.fechaHora).toISOString() : null;
  const horaOk = primerHoraIso && primerHoraIso.endsWith('T23:45:00.000Z');

  registrar(
    'caso_a_zonas_viernes',
    zonasTerminaronViernes && todosAsignados && horaOk,
    `zonasViernes=${zonasTerminaronViernes}, r32Asignados=${todosAsignados}, primerR32Hora=${primerHoraIso}`
  );
}

/**
 * CASO (b): Sin hueco antes del cierre -> R32 queda sinHorarioAsignado
 * Sábado cierra a las 23:00. Las zonas terminan a las 22:30.
 * Como el partido dura 75 min (22:30 + 75 = 23:45 > 23:00), no hay hueco y R32 queda sin horario.
 */
async function testCasoB_sinHuecoAntesDelCierre_R32SinHorario(registrar) {
  await limpiarDb();

  const org = await prisma.organizador.create({
    data: {
      nombre: 'Club Cierre Temprano',
      email: 'cierre-temprano@padel.test',
      passwordHash: 'hash',
      cantidadCanchas: 2,
      viernesInicio: '18:00',
      viernesFin: '23:00',
      sabadoInicio: '09:00',
      sabadoFin: '23:00',
      domingoInicio: '09:00',
      domingoFin: '22:00',
    },
  });

  const torneo = await prisma.torneo.create({
    data: {
      nombre: 'Torneo Cierre Temprano',
      slug: 'torneo-cierre-temprano',
      fecha: parseFechaLocal('2026-09-04'),
      estado: 'BORRADOR',
      organizadorId: org.id,
    },
  });

  const cat = await prisma.categoria.create({
    data: { torneoId: torneo.id, nombre: '6ta', estado: 'BORRADOR' },
  });

  // Crear 25 parejas (fase R32)
  for (let i = 1; i <= 25; i++) {
    await prisma.pareja.create({
      data: { categoriaId: cat.id, jugador1: `J1_${i}`, jugador2: `J2_${i}`, orden: i },
    });
  }

  await zonaService.iniciarCategoria(org.id, cat.id);
  await prisma.torneo.update({ where: { id: torneo.id }, data: { estado: 'EN_CURSO' } });
  await generarEliminatoria(org.id, cat.id);

  // Fijar manualmente un partido de zona terminando a las 22:30 del sábado (21:15 a 22:30)
  // 21:15 ART = 00:15 UTC del domingo
  const baseSaturday = zonaService.proximaFechaPorDia('Sabado', parseFechaLocal('2026-09-04'));
  const sat2115 = new Date(baseSaturday.getTime() + (21 * 60 + 15) * 60 * 1000);

  const unPartidoZona = await prisma.partido.findFirst({
    where: { categoriaId: cat.id, zonaId: { not: null } },
  });

  await prisma.partido.update({
    where: { id: unPartidoZona.id },
    data: {
      fechaHora: sat2115,
      canchaNumero: 1,
      sinHorarioAsignado: false,
    },
  });

  // Los demás partidos de zona con horario previo a las 20:00
  const otrosPartidosZona = await prisma.partido.findMany({
    where: { categoriaId: cat.id, zonaId: { not: null }, id: { not: unPartidoZona.id } },
  });
  const sat1000 = new Date(baseSaturday.getTime() + 10 * 60 * 60 * 1000);
  for (const p of otrosPartidosZona) {
    await prisma.partido.update({
      where: { id: p.id },
      data: { fechaHora: sat1000, canchaNumero: 2, sinHorarioAsignado: false },
    });
  }

  // Ejecutar el scheduler real de eliminatorias
  await programarHorariosEliminatorias(org.id, torneo.id);

  const r32Partidos = await prisma.partido.findMany({
    where: {
      categoriaId: cat.id,
      faseEliminatoria: { ronda: { gte: 32 } },
      esBye: false,
    },
  });

  const todosSinHorario = r32Partidos.length > 0 && r32Partidos.every((p) => p.sinHorarioAsignado && p.fechaHora === null);

  registrar(
    'caso_b_sin_hueco_cierre',
    todosSinHorario,
    `totalR32=${r32Partidos.length}, sinHorario=${r32Partidos.filter((p) => p.sinHorarioAsignado).length}`
  );
}

/**
 * CASO (c): Una zona de la categoría con algún partido sin horario -> R32 queda pendiente
 */
async function testCasoC_zonaConPartidoSinHorario_R32Pendiente(registrar) {
  await limpiarDb();

  const org = await prisma.organizador.create({
    data: {
      nombre: 'Club Zona Incompleta',
      email: 'zona-incompleta@padel.test',
      passwordHash: 'hash',
      cantidadCanchas: 4,
      viernesInicio: '18:00',
      viernesFin: '23:00',
      sabadoInicio: '09:00',
      sabadoFin: '23:00',
      domingoInicio: '09:00',
      domingoFin: '22:00',
    },
  });

  const torneo = await prisma.torneo.create({
    data: {
      nombre: 'Torneo Zona Incompleta',
      slug: 'torneo-zona-incompleta',
      fecha: parseFechaLocal('2026-09-04'),
      estado: 'BORRADOR',
      organizadorId: org.id,
    },
  });

  const cat = await prisma.categoria.create({
    data: { torneoId: torneo.id, nombre: '6ta', estado: 'BORRADOR' },
  });

  for (let i = 1; i <= 25; i++) {
    await prisma.pareja.create({
      data: { categoriaId: cat.id, jugador1: `J1_${i}`, jugador2: `J2_${i}`, orden: i },
    });
  }

  await zonaService.iniciarCategoria(org.id, cat.id);
  await prisma.torneo.update({ where: { id: torneo.id }, data: { estado: 'EN_CURSO' } });
  await generarEliminatoria(org.id, cat.id);

  // Asignar todos los partidos de zona excepto 1 que queda con sinHorarioAsignado: true
  const baseSaturday = zonaService.proximaFechaPorDia('Sabado', parseFechaLocal('2026-09-04'));
  const sat1000 = new Date(baseSaturday.getTime() + 10 * 60 * 60 * 1000);

  const partidosZona = await prisma.partido.findMany({
    where: { categoriaId: cat.id, zonaId: { not: null } },
  });

  for (let i = 0; i < partidosZona.length; i++) {
    if (i === 0) {
      await prisma.partido.update({
        where: { id: partidosZona[i].id },
        data: { fechaHora: null, canchaNumero: null, sinHorarioAsignado: true },
      });
    } else {
      await prisma.partido.update({
        where: { id: partidosZona[i].id },
        data: { fechaHora: sat1000, canchaNumero: 1, sinHorarioAsignado: false },
      });
    }
  }

  // Correr el scheduler real de eliminatorias
  await programarHorariosEliminatorias(org.id, torneo.id);

  const r32Partidos = await prisma.partido.findMany({
    where: {
      categoriaId: cat.id,
      faseEliminatoria: { ronda: { gte: 32 } },
      esBye: false,
    },
  });

  const todosPendientes = r32Partidos.length > 0 && r32Partidos.every((p) => p.sinHorarioAsignado && p.fechaHora === null);

  registrar(
    'caso_c_zona_sin_horario',
    todosPendientes,
    `totalR32=${r32Partidos.length}, pendientes=${r32Partidos.filter((p) => p.sinHorarioAsignado).length}`
  );
}

async function runAll() {
  await ensureTestDb();
  resetTestDb();
  await canchasOverridesService.loadFromDb();

  console.log('='.repeat(80));
  console.log('🧪 SUITE: INVARIANTE R32 Y FIN DE ZONAS (SCHEDULER ELIMINATORIAS)');
  console.log('='.repeat(80));

  const resultados = [];
  function registrar(caso, passed, detalle) {
    resultados.push({ caso, estado: passed ? 'PASS' : 'FAIL', detalle });
  }

  try {
    await testRepro_zonasTerminanTarde_R32NoArrancaAntes(registrar);
    await testCasoA_zonasTerminanViernes_R32Sigue2045(registrar);
    await testCasoB_sinHuecoAntesDelCierre_R32SinHorario(registrar);
    await testCasoC_zonaConPartidoSinHorario_R32Pendiente(registrar);
  } finally {
    await limpiarDb();
    await prisma.$disconnect();
  }

  console.table(resultados);
  const fallos = resultados.filter((r) => r.estado === 'FAIL');
  if (fallos.length > 0) {
    console.error(`❌ Fallaron ${fallos.length} casos de prueba.`);
    process.exit(1);
  } else {
    console.log(`✅ Todos los casos pasaron correctamente (${resultados.length}/${resultados.length}).`);
    process.exit(0);
  }
}

if (require.main === module) {
  runAll().catch((err) => {
    console.error('Error fatal en suite R32:', err);
    process.exit(1);
  });
}

module.exports = { runAll };
