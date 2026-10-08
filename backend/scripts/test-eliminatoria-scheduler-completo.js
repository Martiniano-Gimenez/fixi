const { ensureTestDb } = require('./utils/testEnvGuard');
const prisma = require('../src/lib/prisma');
const organizadorService = require('../src/services/organizador.service');
const { programarHorariosEliminatorias } = require('../src/services/eliminatoriaScheduler.service');
const canchasOverridesService = require('../src/services/canchasOverrides.service');

async function test() {
  await ensureTestDb();
  console.log('=== TEST: SCHEDULER COMPLETO DE ELIMINATORIAS (PRIORIDAD POR CLASIFICADOS) ===\n');
  await canchasOverridesService.loadFromDb();

  // 1. Crear organizador y club de prueba con horarios de fin de semana
  const emailOrg = `test-sched-${Date.now()}@padel.test`;
  const org = await prisma.organizador.create({
    data: {
      nombre: 'Club Test Scheduler',
      email: emailOrg,
      passwordHash: 'dummyhash123',
      cantidadCanchas: 4,
      viernesInicio: '18:00',
      viernesFin: '23:00',
      sabadoInicio: '08:00',
      sabadoFin: '23:00',
      domingoInicio: '08:00',
      domingoFin: '23:00',
    },
  });

  const slug = `torneo-sched-${Date.now()}`;
  const torneo = await prisma.torneo.create({
    data: {
      organizadorId: org.id,
      nombre: 'Torneo Test Scheduler Eliminatorias',
      slug,
      fecha: new Date('2026-09-04T12:00:00.000Z'), // Viernes 4 Septiembre 2026
      estado: 'BORRADOR',
    },
  });

  // 2. Crear dos categorías: Cat A y Cat B
  const catA = await prisma.categoria.create({
    data: {
      torneoId: torneo.id,
      nombre: 'Cat A (8 parejas)',
      estado: 'BORRADOR',
    },
  });

  const catB = await prisma.categoria.create({
    data: {
      torneoId: torneo.id,
      nombre: 'Cat B (8 parejas)',
      estado: 'BORRADOR',
    },
  });

  // Crear 8 parejas para Cat A y 8 parejas para Cat B
  for (let i = 1; i <= 8; i++) {
    await prisma.pareja.create({
      data: {
        categoriaId: catA.id,
        jugador1: `A_J1_${i}`,
        jugador2: `A_J2_${i}`,
      },
    });
    await prisma.pareja.create({
      data: {
        categoriaId: catB.id,
        jugador1: `B_J1_${i}`,
        jugador2: `B_J2_${i}`,
      },
    });
  }

  console.log('1. Iniciando torneo multi-categoría...');
  const inicioRes = await organizadorService.iniciarTorneoMultiCategoria(org.id, torneo.id);
  console.log('  Torneo iniciado:', inicioRes.message);

  console.log('\n2. Verificando que TODOS los cruces de eliminatorias tengan horario y cancha asignados desde el inicio...');
  const partidosEliminatorias = await prisma.partido.findMany({
    where: {
      faseEliminatoriaId: { not: null },
      categoria: { torneoId: torneo.id },
    },
    include: {
      faseEliminatoria: true,
      categoria: true,
    },
    orderBy: [
      { categoria: { nombre: 'asc' } },
      { faseEliminatoria: { ronda: 'desc' } },
      { posicionEnRonda: 'asc' },
    ],
  });

  console.log(`  Total partidos de eliminatoria generados: ${partidosEliminatorias.length}`);
  if (partidosEliminatorias.length === 0) {
    throw new Error('FALLO: No se generaron partidos de eliminatorias!');
  }

  let sinHorarioCount = 0;
  for (const p of partidosEliminatorias) {
    const isBye = (!p.origenPareja1 && p.origenPareja2) || (p.origenPareja1 && !p.origenPareja2);
    console.log(`  [Ronda ${p.faseEliminatoria.ronda} #${p.posicionEnRonda}] P1: ${p.origenPareja1 || p.pareja1Id} vs P2: ${p.origenPareja2 || p.pareja2Id} | sinHorario: ${p.sinHorarioAsignado} | isBye: ${isBye}`);
    if (p.sinHorarioAsignado || !p.fechaHora || !p.canchaNumero) {
      if (!isBye) {
        console.error(`  ERROR: Partido [Cat ${p.categoria.nombre} Ronda ${p.faseEliminatoria.ronda} #${p.posicionEnRonda}] sin horario/cancha!`);
        sinHorarioCount++;
      }
    } else {
      const d = new Date(p.fechaHora);
      const diaNom = d.toLocaleDateString('es-AR', { weekday: 'short', timeZone: 'America/Argentina/Buenos_Aires' });
      const horaStr = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' });
      console.log(`    -> ${diaNom} ${horaStr}hs - Cancha ${p.canchaNumero}`);
    }
  }

  if (sinHorarioCount > 0) {
    throw new Error(`FALLO: ${sinHorarioCount} partidos de eliminatoria no tienen horario asignado!`);
  }
  console.log('  ¡100% de los cruces de eliminatoria tienen horario y cancha asignados!');

  console.log('\n5. Verificando secuencia temporal y descansos (padres vs hijos)...');
  const matchMap = new Map();
  for (const p of partidosEliminatorias) {
    matchMap.set(`${p.categoriaId}:${p.faseEliminatoria.ronda}:${p.posicionEnRonda}`, p);
  }

  for (const p of partidosEliminatorias) {
    const rondaActual = p.faseEliminatoria.ronda;
    const parentRonda = rondaActual * 2;
    const parentPos1 = p.posicionEnRonda * 2 - 1;
    const parentPos2 = p.posicionEnRonda * 2;

    const parent1 = matchMap.get(`${p.categoriaId}:${parentRonda}:${parentPos1}`);
    const parent2 = matchMap.get(`${p.categoriaId}:${parentRonda}:${parentPos2}`);

    const pStart = new Date(p.fechaHora).getTime();

    if (parent1 && parent1.fechaHora) {
      const par1End = new Date(parent1.fechaHora).getTime() + 75 * 60 * 1000;
      if (pStart < par1End) {
        throw new Error(`FALLO: Partido hijo arranca antes que termine su padre 1!`);
      }
    }
    if (parent2 && parent2.fechaHora) {
      const par2End = new Date(parent2.fechaHora).getTime() + 75 * 60 * 1000;
      if (pStart < par2End) {
        throw new Error(`FALLO: Partido hijo arranca antes que termine su padre 2!`);
      }
    }
  }
  console.log('  ¡Todas las secuencias temporales entre rondas son perfectamente válidas!');

  // Limpieza
  console.log('\nLimpiando datos de prueba...');
  await prisma.partido.deleteMany({ where: { categoria: { torneoId: torneo.id } } });
  await prisma.faseEliminatoria.deleteMany({ where: { categoria: { torneoId: torneo.id } } });
  await prisma.zonaPareja.deleteMany({ where: { zona: { categoria: { torneoId: torneo.id } } } });
  await prisma.zona.deleteMany({ where: { categoria: { torneoId: torneo.id } } });
  await prisma.pareja.deleteMany({ where: { categoria: { torneoId: torneo.id } } });
  await prisma.categoria.deleteMany({ where: { torneoId: torneo.id } });
  await prisma.torneo.delete({ where: { id: torneo.id } });
  await prisma.organizador.delete({ where: { id: org.id } });

  console.log('\n=== TODOS LOS TESTS PASARON EXITOSAMENTE ===');
}

test()
  .catch((e) => {
    console.error('Error en el test:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
