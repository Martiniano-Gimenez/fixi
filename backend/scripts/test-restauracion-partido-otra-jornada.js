'use strict';

const { ensureTestDb } = require('./utils/testEnvGuard');
const { resetTestDb } = require('./reset-test-db');
const prisma = require('../src/lib/prisma');
const organizadorService = require('../src/services/organizador.service');
const canchasOverridesService = require('../src/services/canchasOverrides.service');
const { parseFechaLocal, getDiaCalendarioConTrasnoche } = require('../src/utils/dateUtils');
const assert = require('assert');

/**
 * Test de diagnóstico (Paso 3):
 * Demuestra qué ocurre si un id de partido de sábado está presente en el mapa partidosSinSlot
 * de un override de viernes al momento de restaurar el viernes.
 */
async function testRestauracionConIdDeOtraJornadaEnMapa() {
  await ensureTestDb();
  await prisma.$disconnect();
  resetTestDb();
  await canchasOverridesService.loadFromDb();

  const org = await prisma.organizador.create({
    data: {
      nombre: 'Club Px4 Test Q3',
      email: 'test-q3@padel.test',
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
      nombre: 'Torneo Test Q3',
      slug: 'torneo-test-q3',
      fecha: parseFechaLocal('2026-09-04'), // Viernes 4 Septiembre
      estado: 'EN_CURSO',
      organizadorId: org.id,
    },
  });

  const cat = await prisma.categoria.create({
    data: { torneoId: torneo.id, nombre: '5ta', estado: 'EN_CURSO' },
  });

  const zona = await prisma.zona.create({
    data: { categoriaId: cat.id, nombre: 'Zona Sabado', clasifican: 2, formato: 'ROUND_ROBIN' },
  });

  const parejas = [];
  for (let i = 1; i <= 2; i++) {
    const p = await prisma.pareja.create({
      data: { categoriaId: cat.id, jugador1: `J1_${i}`, jugador2: `J2_${i}`, orden: i },
    });
    parejas.push(p);
  }

  // Partido de sábado que quedó sin horario y con su ID en el mapa de viernes
  const partidoSabado = await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      zonaId: zona.id,
      posicionEnRonda: 1,
      pareja1Id: parejas[0].id,
      pareja2Id: parejas[1].id,
      estado: 'PENDIENTE',
      fechaHora: null,
      canchaNumero: null,
      sinHorarioAsignado: true,
    },
  });

  // Override de viernes (2026-09-04) con el id del partido en partidosSinSlot
  await prisma.overrideCanchasDia.create({
    data: {
      torneoId: torneo.id,
      diaKey: '2026-09-04',
      canchas: 4,
      isLluvia: true,
      activoDesde: new Date('2026-09-04T15:00:00.000Z'),
      partidosSinSlot: {
        [partidoSabado.id]: 'Desplazado porque el nuevo fin de P1/P2 supera su horario de inicio',
      },
    },
  });
  await canchasOverridesService.loadFromDb();

  console.log('--- Estado previo a la restauración del Viernes ---');
  console.log(`Partido ID: ${partidoSabado.id}`);
  console.log(`partidosSinSlot en Viernes:`, canchasOverridesService.getCanchasDia(torneo.id, '2026-09-04', 6).partidosSinSlot);

  // Acción: Restaurar canchas del VIERNES a 6
  console.log('\n--- Ejecutando restauración del Viernes a 6 canchas ---');
  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 6, null, '2026-09-04');

  // Resultado
  const pPost = await prisma.partido.findUnique({ where: { id: partidoSabado.id } });
  const diaInfoPost = pPost.fechaHora ? getDiaCalendarioConTrasnoche(pPost.fechaHora, org) : null;

  console.log('\n--- Estado posterior a la restauración del Viernes ---');
  console.log(`fechaHora: ${pPost.fechaHora ? pPost.fechaHora.toISOString() : 'NULL'}`);
  console.log(`canchaNumero: ${pPost.canchaNumero}`);
  console.log(`sinHorarioAsignado: ${pPost.sinHorarioAsignado}`);
  console.log(`Día asignado: ${diaInfoPost?.key} (${diaInfoPost?.dia})`);

  // Comprobación de comportamiento:
  // Al no tener fechaHora, Earliest-Fit usa overrideTimestamp (Viernes) y le asigna un slot en VIERNES
  assert.strictEqual(
    diaInfoPost?.key,
    '2026-09-04',
    'Comportamiento observado: El partido fue agendado en VIERNES a pesar de pertenecer a otra jornada.'
  );

  console.log('\n✅ COMPORTAMIENTO CONFIRMADO: Al restaurar el viernes, el algoritmo intentó y agendó el partido en la jornada del viernes.');
  await prisma.$disconnect();
  process.exit(0);
}

testRestauracionConIdDeOtraJornadaEnMapa().catch((err) => {
  console.error('\nError en test:', err.message);
  process.exit(1);
});
