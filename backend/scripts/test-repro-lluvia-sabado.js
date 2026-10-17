'use strict';

/**
 * Reproductor mínimo del bug reportado en dev.db:
 * Reducir canchas el VIERNES no debe alterar partidos de MINI_BRACKET del SÁBADO.
 */
const { ensureTestDb } = require('./utils/testEnvGuard');
const { resetTestDb } = require('./reset-test-db');
const prisma = require('../src/lib/prisma');
const organizadorService = require('../src/services/organizador.service');
const canchasOverridesService = require('../src/services/canchasOverrides.service');
const { parseFechaLocal } = require('../src/utils/dateUtils');
const assert = require('assert');

async function testReproductorLluviaViernesAfectaSabado() {
  await ensureTestDb();
  resetTestDb();
  await canchasOverridesService.loadFromDb();

  console.log('--- Configurando club y torneo con datos idénticos a dev.db ---');
  const org = await prisma.organizador.create({
    data: {
      nombre: 'Club Px4 Reproductor',
      email: 'repro-px4@padel.test',
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
      nombre: 'Torneo Reproductor',
      slug: 'torneo-reproductor',
      fecha: parseFechaLocal('2026-09-04'), // Viernes 4 de Septiembre 2026
      estado: 'EN_CURSO',
      organizadorId: org.id,
    },
  });

  const cat = await prisma.categoria.create({
    data: { torneoId: torneo.id, nombre: '5ta', estado: 'EN_CURSO' },
  });

  const zonaMB = await prisma.zona.create({
    data: {
      categoriaId: cat.id,
      nombre: 'Zona B',
      clasifican: 3,
      formato: 'MINI_BRACKET',
    },
  });

  const parejas = [];
  for (let i = 1; i <= 4; i++) {
    const p = await prisma.pareja.create({
      data: {
        categoriaId: cat.id,
        jugador1: `J1_${i}`,
        jugador2: `J2_${i}`,
        orden: i,
      },
    });
    parejas.push(p);
    await prisma.zonaPareja.create({ data: { zonaId: zonaMB.id, parejaId: p.id } });
  }

  // P1: Sábado 08:30 hs (11:30 UTC) - Cancha 5 - FINALIZADO (fin 09:45 hs ART / 12:45 UTC)
  await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      zonaId: zonaMB.id,
      posicionEnRonda: 1,
      pareja1Id: parejas[0].id,
      pareja2Id: parejas[1].id,
      estado: 'FINALIZADO',
      fechaHora: new Date('2026-09-05T11:30:00.000Z'),
      canchaNumero: 5,
      sinHorarioAsignado: false,
    },
  });

  // P2: Sábado 14:30 hs (17:30 UTC) - Cancha 1 - FINALIZADO (fin 15:45 hs ART / 18:45 UTC)
  await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      zonaId: zonaMB.id,
      posicionEnRonda: 2,
      pareja1Id: parejas[2].id,
      pareja2Id: parejas[3].id,
      estado: 'FINALIZADO',
      fechaHora: new Date('2026-09-05T17:30:00.000Z'),
      canchaNumero: 1,
      sinHorarioAsignado: false,
    },
  });

  // P3: Sábado 15:45 hs (18:45 UTC) - Cancha 2 - PENDIENTE
  await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      zonaId: zonaMB.id,
      posicionEnRonda: 3,
      pareja1Id: parejas[0].id,
      pareja2Id: parejas[2].id,
      origenPareja1: 'Ganador Partido 1',
      origenPareja2: 'Ganador Partido 2',
      estado: 'PENDIENTE',
      fechaHora: new Date('2026-09-05T18:45:00.000Z'),
      canchaNumero: 2,
      sinHorarioAsignado: false,
    },
  });

  // P4: Sábado 09:45 hs (12:45 UTC) - Cancha 5 - PENDIENTE (Figueroa/Esquivel vs Zelaya/Frías)
  const p4 = await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      zonaId: zonaMB.id,
      posicionEnRonda: 4,
      pareja1Id: parejas[1].id,
      pareja2Id: parejas[3].id,
      origenPareja1: 'Perdedor Partido 1',
      origenPareja2: 'Perdedor Partido 2',
      estado: 'PENDIENTE',
      fechaHora: new Date('2026-09-05T12:45:00.000Z'),
      canchaNumero: 5,
      sinHorarioAsignado: false,
    },
  });

  console.log(`Estado antes de reducir Viernes:`);
  console.log(`   P4 sábado: fechaHora=${p4.fechaHora.toISOString()}, cancha=${p4.canchaNumero}, sinHorario=${p4.sinHorarioAsignado}`);

  // Acción: Reducción del VIERNES (2026-09-04) a 4 canchas
  console.log('\n--- Ejecutando reducción de VIERNES (2026-09-04) a 4 canchas ---');
  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 4, null, '2026-09-04');

  // Verificar estado de P4 de SÁBADO
  const p4Post = await prisma.partido.findUnique({ where: { id: p4.id } });
  const ovVie = canchasOverridesService.getCanchasDia(torneo.id, '2026-09-04', 6);

  console.log(`\nEstado después de reducir Viernes:`);
  console.log(`   P4 sábado: fechaHora=${p4Post.fechaHora ? p4Post.fechaHora.toISOString() : 'NULL'}, cancha=${p4Post.canchaNumero}, sinHorario=${p4Post.sinHorarioAsignado}`);
  console.log(`   Overrides de Viernes (partidosSinSlot):`, ovVie.partidosSinSlot);

  assert.strictEqual(
    p4Post.sinHorarioAsignado,
    false,
    'P4 de SÁBADO no debe quedar sinHorarioAsignado=true por una reducción del VIERNES'
  );
  assert.notStrictEqual(
    p4Post.fechaHora,
    null,
    'P4 de SÁBADO no debe perder su fechaHora'
  );
  assert.strictEqual(
    p4Post.canchaNumero,
    5,
    'P4 de SÁBADO debe mantener su Cancha 5'
  );
  assert.strictEqual(
    Object.keys(ovVie.partidosSinSlot || {}).includes(p4.id),
    false,
    'partidosSinSlot del viernes no debe incluir a P4 de sábado'
  );

  console.log('✅ TEST PASÓ: P4 de sábado no fue alterado.');
}

if (require.main === module) {
  testReproductorLluviaViernesAfectaSabado()
    .then(() => {
      prisma.$disconnect().then(() => process.exit(0));
    })
    .catch((err) => {
      console.error('\n❌ ' + err.message);
      prisma.$disconnect().then(() => process.exit(1));
    });
}

module.exports = { testReproductorLluviaViernesAfectaSabado };
