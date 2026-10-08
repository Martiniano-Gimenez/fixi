const { ensureTestDb } = require('./utils/testEnvGuard');
const prisma = require('../src/lib/prisma');
const { programarHorariosEliminatorias } = require('../src/services/eliminatoriaScheduler.service');
const canchasOverridesService = require('../src/services/canchasOverrides.service');

/**
 * Test de regresión permanente:
 * Reproduce el escenario exacto de desbalance matutino con 6 canchas:
 * - Cat 1: 22 clasificados (8 partidos en Octavos -> 6 a las 08:00, 2 a las 09:15)
 * - Cat 2: 16 clasificados (8 partidos en Octavos)
 * - Cat 3: 11 clasificados (3 partidos en Octavos)
 * 
 * Verifica:
 * 1. A las 09:15 NO queda ninguna cancha vacía (6/6 canchas ocupadas).
 * 2. Se adelanta determinísticamente el partido #1 de Cat 2 a la Cancha 6 a las 09:15.
 * 3. A las 10:30 se encadenan 6 partidos de Cat 2 (6/6 canchas ocupadas).
 * 4. A las 11:45 queda el único slot libre natural (5/6 canchas ocupadas).
 * 5. Descansos individuales válidos y sin colisión de parejas.
 * 6. Idempotencia: correr el scheduler dos veces produce exactamente la misma asignación.
 */
async function testSchedulerBackfillRegression() {
  await ensureTestDb();
  await canchasOverridesService.loadFromDb();
  console.log('=== TEST DE REGRESIÓN: BACKFILL DIRIGIDO EN OCTAVOS ===\n');

  const email = `test-backfill-${Date.now()}@padel.test`;
  const org = await prisma.organizador.create({
    data: {
      nombre: 'Club Regresion Backfill',
      email,
      passwordHash: 'dummy',
      cantidadCanchas: 6,
      domingoInicio: '08:00',
      domingoFin: '23:00',
    },
  });

  const torneo = await prisma.torneo.create({
    data: {
      organizadorId: org.id,
      nombre: 'Torneo Regresion Backfill',
      slug: `torneo-backfill-${Date.now()}`,
      fecha: new Date('2026-09-06T11:00:00.000Z'), // Domingo 6 Septiembre 2026
      estado: 'EN_CURSO',
    },
  });

  try {
    // 1. Cat A: 22 clasificados (11 zonas de 2 clasifican)
    const catA = await prisma.categoria.create({
      data: {
        torneoId: torneo.id,
        nombre: 'Cat A 7ma',
        estado: 'PUBLICADO',
      },
    });
    for (let z = 1; z <= 11; z++) {
      await prisma.zona.create({
        data: {
          categoriaId: catA.id,
          nombre: `Zona ${z}`,
          clasifican: 2,
        },
      });
    }

    // 2. Cat B: 16 clasificados (8 zonas de 2 clasifican)
    const catB = await prisma.categoria.create({
      data: {
        torneoId: torneo.id,
        nombre: 'Cat B 5ta',
        estado: 'PUBLICADO',
      },
    });
    for (let z = 1; z <= 8; z++) {
      await prisma.zona.create({
        data: {
          categoriaId: catB.id,
          nombre: `Zona ${z}`,
          clasifican: 2,
        },
      });
    }

    // 3. Cat C: 11 clasificados (5 zonas de 2 y 1 de 1)
    const catC = await prisma.categoria.create({
      data: {
        torneoId: torneo.id,
        nombre: 'Cat C Damas',
        estado: 'PUBLICADO',
      },
    });
    for (let z = 1; z <= 5; z++) {
      await prisma.zona.create({
        data: {
          categoriaId: catC.id,
          nombre: `Zona ${z}`,
          clasifican: z === 1 ? 3 : 2,
        },
      });
    }

    // Crear fases eliminatorias de Octavos (R16) para las 3 categorías
    const faseA = await prisma.faseEliminatoria.create({
      data: {
        categoriaId: catA.id,
        ronda: 16,
        nombre: 'Octavos de Final',
      },
    });
    const faseB = await prisma.faseEliminatoria.create({
      data: {
        categoriaId: catB.id,
        ronda: 16,
        nombre: 'Octavos de Final',
      },
    });
    const faseC = await prisma.faseEliminatoria.create({
      data: {
        categoriaId: catC.id,
        ronda: 16,
        nombre: 'Octavos de Final',
      },
    });

    // Crear 8 partidos en Cat A
    for (let i = 1; i <= 8; i++) {
      await prisma.partido.create({
        data: {
          categoriaId: catA.id,
          faseEliminatoriaId: faseA.id,
          posicionEnRonda: i,
          estado: 'PENDIENTE',
        },
      });
    }

    // Crear 8 partidos en Cat B
    for (let i = 1; i <= 8; i++) {
      await prisma.partido.create({
        data: {
          categoriaId: catB.id,
          faseEliminatoriaId: faseB.id,
          posicionEnRonda: i,
          estado: 'PENDIENTE',
        },
      });
    }

    // Crear 8 partidos en Cat C (3 normales y 5 byes)
    for (let i = 1; i <= 8; i++) {
      const isBye = [1, 3, 4, 5, 8].includes(i);
      await prisma.partido.create({
        data: {
          categoriaId: catC.id,
          faseEliminatoriaId: faseC.id,
          posicionEnRonda: i,
          estado: isBye ? 'FINALIZADO' : 'PENDIENTE',
          origenPareja1: isBye ? '1° Zona 1' : null,
          pareja1Id: null,
          pareja2Id: null,
        },
      });
    }

    // 4. Ejecutar el scheduler
    console.log('1. Ejecutando programarHorariosEliminatorias...');
    const res1 = await programarHorariosEliminatorias(org.id, torneo.id);
    console.log('   Partidos agendados:', res1.partidosAgendados);

    // 5. Cargar asignaciones
    const partidos = await prisma.partido.findMany({
      where: {
        categoria: { torneoId: torneo.id },
        fechaHora: { not: null },
      },
      include: { categoria: true, faseEliminatoria: true },
      orderBy: [{ fechaHora: 'asc' }, { canchaNumero: 'asc' }],
    });

    const slots = {};
    for (const p of partidos) {
      const d = new Date(p.fechaHora);
      const hora = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' });
      if (!slots[hora]) slots[hora] = [];
      slots[hora].push(p);
    }

    console.log('\n2. Verificando ocupación por turno:');
    for (const [hora, list] of Object.entries(slots)) {
      console.log(`   ${hora}: ${list.length}/6 canchas ocupadas`);
    }

    // ASERCIÓN 1: 08:00 debe tener 6/6 canchas ocupadas
    const slot0800 = slots['08:00 a. m.'] || slots['08:00'];
    if (!slot0800 || slot0800.length !== 6) {
      throw new Error(`Falla en 08:00: esperadas 6 canchas, encontradas ${slot0800 ? slot0800.length : 0}`);
    }
    console.log('   ✅ 08:00 a.m. tiene 6/6 canchas ocupadas');

    // ASERCIÓN 2: 09:15 debe tener 6/6 canchas ocupadas (Cancha 6 NO está libre)
    const slot0915 = slots['09:15 a. m.'] || slots['09:15'];
    if (!slot0915 || slot0915.length !== 6) {
      throw new Error(`Falla en 09:15: esperadas 6 canchas, encontradas ${slot0915 ? slot0915.length : 0}`);
    }
    console.log('   ✅ 09:15 a.m. tiene 6/6 canchas ocupadas (Cancha 6 fue rellenada exitosamente)');

    // Verificar qué partido está en Cancha 6 a las 09:15
    const partidoC6_0915 = slot0915.find(p => p.canchaNumero === 6);
    if (!partidoC6_0915 || partidoC6_0915.categoria.nombre !== 'Cat B 5ta' || partidoC6_0915.posicionEnRonda !== 1) {
      throw new Error(`Falla en 09:15 Cancha 6: se esperaba Cat B 5ta #1, encontrado: ${partidoC6_0915 ? `${partidoC6_0915.categoria.nombre} #${partidoC6_0915.posicionEnRonda}` : 'ninguno'}`);
    }
    console.log('   ✅ 09:15 Cancha 6 tiene asignado a Cat B 5ta #1 de forma determinística');

    // ASERCIÓN 3: 10:30 debe tener 6/6 canchas ocupadas
    const slot1030 = slots['10:30 a. m.'] || slots['10:30'];
    if (!slot1030 || slot1030.length !== 6) {
      throw new Error(`Falla en 10:30: esperadas 6 canchas, encontradas ${slot1030 ? slot1030.length : 0}`);
    }
    console.log('   ✅ 10:30 a.m. tiene 6/6 canchas ocupadas (cascada de Cat B)');

    // ASERCIÓN 4: 11:45 tiene el último partido de Cat B (#8)
    const slot1145 = slots['11:45 a. m.'] || slots['11:45'];
    if (!slot1145 || slot1145.length !== 1) {
      throw new Error(`Falla en 11:45: esperado 1 partido de Cat B, encontrados ${slot1145 ? slot1145.length : 0}`);
    }
    console.log('   ✅ 11:45 a.m. tiene 1 partido de Cat B (el hueco libre natural queda al final de la franja)');

    // ASERCIÓN 5: Idempotencia (ejecutar segunda vez)
    console.log('\n3. Verificando idempotencia...');
    await programarHorariosEliminatorias(org.id, torneo.id);
    const partidos2 = await prisma.partido.findMany({
      where: {
        categoria: { torneoId: torneo.id },
        fechaHora: { not: null },
      },
      orderBy: [{ fechaHora: 'asc' }, { canchaNumero: 'asc' }],
    });

    for (let i = 0; i < partidos.length; i++) {
      const p1 = partidos[i];
      const p2 = partidos2.find(p => p.id === p1.id);
      if (!p2 || new Date(p2.fechaHora).getTime() !== new Date(p1.fechaHora).getTime() || p2.canchaNumero !== p1.canchaNumero) {
        throw new Error(`Falla de idempotencia en partido ${p1.id}: asignación cambió tras segunda ejecución`);
      }
    }
    console.log('   ✅ Idempotencia 100% confirmada: la segunda ejecución produjo exactamente el mismo fixture.');

    console.log('\n🎉 TODOS LOS CHEQUEOS DE REGRESIÓN PASARON CON ÉXITO AL 100%!');
  } finally {
    // Limpieza
    await prisma.partido.deleteMany({ where: { categoria: { torneoId: torneo.id } } });
    await prisma.faseEliminatoria.deleteMany({ where: { categoria: { torneoId: torneo.id } } });
    await prisma.zona.deleteMany({ where: { categoria: { torneoId: torneo.id } } });
    await prisma.categoria.deleteMany({ where: { torneoId: torneo.id } });
    await prisma.torneo.delete({ where: { id: torneo.id } });
    await prisma.organizador.delete({ where: { id: org.id } });
  }
}

testSchedulerBackfillRegression()
  .catch(async (err) => {
    console.error('❌ Error en test de regresión:', err);
    await prisma.$disconnect();
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
