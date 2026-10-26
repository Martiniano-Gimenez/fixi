'use strict';

/**
 * test-r32-inmutabilidad.js
 *
 * Prueba el caso:
 * (a) R32 FINALIZADO con alguna zona sin horario -> programarHorariosEliminatorias
 * NO debe modificar el partido R32 (conserva estado FINALIZADO, fechaHora y canchaNumero).
 */

require('./utils/testEnvGuard');
const { ensureTestDb } = require('./utils/testEnvGuard');
const { resetTestDb } = require('./reset-test-db');
const prisma = require('../src/lib/prisma');
const zonaService = require('../src/services/zona.service');
const { parseFechaLocal } = require('../src/utils/dateUtils');
const { generarEliminatoria } = require('../src/services/faseEliminatoria.service');
const { programarHorariosEliminatorias } = require('../src/services/eliminatoriaScheduler.service');
const canchasOverridesService = require('../src/services/canchasOverrides.service');

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

async function testCasoA_R32FinalizadoConZonaSinHorario() {
  await limpiarDb();

  const org = await prisma.organizador.create({
    data: {
      nombre: 'Club Test Inmutabilidad',
      email: 'inmutabilidad@padel.test',
      passwordHash: 'hash',
      cantidadCanchas: 3,
      viernesInicio: '18:00',
      viernesFin: '23:00',
      sabadoInicio: '09:00',
      sabadoFin: '24:00',
      domingoInicio: '09:00',
      domingoFin: '22:00',
    },
  });

  const torneo = await prisma.torneo.create({
    data: {
      nombre: 'Torneo Test Inmutabilidad',
      slug: 'torneo-inmutabilidad',
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

  // Buscar un partido de R32 (no bye)
  const partidoR32 = await prisma.partido.findFirst({
    where: {
      categoriaId: cat.id,
      faseEliminatoria: { ronda: { gte: 32 } },
      esBye: false,
    },
  });

  const baseSaturday = zonaService.proximaFechaPorDia('Sabado', parseFechaLocal('2026-09-04'));
  const horaOriginal = new Date(baseSaturday.getTime() + 21 * 60 * 60 * 1000); // 21:00

  // Marcar R32 como FINALIZADO
  await prisma.partido.update({
    where: { id: partidoR32.id },
    data: {
      fechaHora: horaOriginal,
      canchaNumero: 1,
      sinHorarioAsignado: false,
      estado: 'FINALIZADO',
    },
  });

  // Dejar al menos un partido de zona sin horario
  const unPartidoZona = await prisma.partido.findFirst({
    where: { categoriaId: cat.id, zonaId: { not: null } },
  });
  await prisma.partido.update({
    where: { id: unPartidoZona.id },
    data: { fechaHora: null, canchaNumero: null, sinHorarioAsignado: true },
  });

  // Ejecutar programarHorariosEliminatorias
  await programarHorariosEliminatorias(org.id, torneo.id);

  const despues = await prisma.partido.findUnique({ where: { id: partidoR32.id } });

  const noModificado =
    despues.estado === 'FINALIZADO' &&
    despues.fechaHora &&
    new Date(despues.fechaHora).getTime() === horaOriginal.getTime() &&
    despues.canchaNumero === 1 &&
    despues.sinHorarioAsignado === false;

  if (!noModificado) {
    throw new Error(
      `FALLÓ: R32 fue modificado. estado=${despues.estado}, fechaHora=${despues.fechaHora}, cancha=${despues.canchaNumero}, sinHorario=${despues.sinHorarioAsignado}`
    );
  }

  console.log('✅ Caso (a) PASS: R32 conservó estado FINALIZADO, fechaHora y cancha.');
}

async function run() {
  await ensureTestDb();
  resetTestDb();
  await canchasOverridesService.loadFromDb();

  console.log('='.repeat(80));
  console.log('🧪 TEST: INMUTABILIDAD DE R32 FINALIZADO ANTE ZONAS SIN HORARIO');
  console.log('='.repeat(80));

  await testCasoA_R32FinalizadoConZonaSinHorario();
  await limpiarDb();
  await prisma.$disconnect();
}

if (require.main === module) {
  run().catch((e) => {
    console.error('Error en test-r32-inmutabilidad.js:', e);
    process.exit(1);
  });
}

module.exports = { run };
