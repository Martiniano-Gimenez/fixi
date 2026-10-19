'use strict';

/**
 * test-scheduler-tickets-pendientes.js
 * Reproductores mínimos determinísticos correspondientes a tickets pendientes de resolución:
 * 1. Zona manual (`precheck_zona_manual_partidos:post-inicio`)
 * 2. Monotonía de pre-check (`precheck_monotonia:post-inicio`)
 * 3. Lluvia empuja zonas más allá de R32 ya fijado (`eliminatorias_descanso_y_post_zonas:post-reduccion`)
 *
 * Mantenido fuera de run-all-tests.js hasta la implementación de sus respectivos tickets.
 */

const { ensureTestDb } = require('./utils/testEnvGuard');
const { resetTestDb } = require('./reset-test-db');
const prisma = require('../src/lib/prisma');
const organizadorService = require('../src/services/organizador.service');
const zonaService = require('../src/services/zona.service');
const disponibilidadService = require('../src/services/disponibilidad.service');
const canchasOverridesService = require('../src/services/canchasOverrides.service');
const partidoService = require('../src/services/partido.service');
const { generarEliminatoria } = require('../src/services/faseEliminatoria.service');
const { programarHorariosEliminatorias } = require('../src/services/eliminatoriaScheduler.service');
const { parseFechaLocal } = require('../src/utils/dateUtils');
const { DURACION_PARTIDO_MIN } = require('../src/services/slots.service');

const DURACION_MS = DURACION_PARTIDO_MIN * 60 * 1000;

async function limpiarDb() {
  organizadorService.preCheckSessions.clear();
  organizadorService.planesCache.clear();
  await prisma.setPartido.deleteMany({});
  await prisma.partido.deleteMany({});
  await prisma.faseEliminatoria.deleteMany({});
  await prisma.zonaPareja.deleteMany({});
  await prisma.zona.deleteMany({});
  await prisma.slotPareja.deleteMany({});
  await prisma.pareja.deleteMany({});
  await prisma.categoria.deleteMany({});
  await prisma.overrideCanchasDia.deleteMany({});
  await prisma.torneo.deleteMany({});
  await prisma.organizador.deleteMany({});
  await canchasOverridesService.loadFromDb();
}

/**
 * CASO 1: Reproductor mínimo de `precheck_zona_manual_partidos:post-inicio`
 * Configuración mínima: 1 cancha, 1 categoría, 3 parejas.
 * - P1 y P2 tienen 'Viernes-18:00'; P3 tiene 'Viernes-19:15' (incompatibles -> van a zona manual sin partidos).
 * - Al destrabar el cruce agregando 'Viernes-19:15' a P1 y P2 en preCheck, la zona queda
 *   con requiereArmadoManual = false (100% destrabada), pero con 0 partidos creados.
 */
async function reproPrecheckZonaManualPartidos(registrarResultado) {
  await limpiarDb();

  const org = await prisma.organizador.create({
    data: {
      nombre: 'Club Repro Manual Zone',
      email: 'repro-manual@padel.test',
      passwordHash: 'hash',
      cantidadCanchas: 1,
      viernesInicio: '18:00',
      viernesFin: '22:00',
      sabadoInicio: '09:00',
      sabadoFin: '22:00',
      domingoInicio: '09:00',
      domingoFin: '22:00',
    },
  });

  const torneo = await prisma.torneo.create({
    data: {
      nombre: 'Torneo Repro Manual Zone',
      slug: 'torneo-repro-manual',
      fecha: parseFechaLocal('2026-09-04'),
      estado: 'BORRADOR',
      organizadorId: org.id,
    },
  });

  const cat = await prisma.categoria.create({
    data: { torneoId: torneo.id, nombre: '6ta', estado: 'BORRADOR' },
  });

  const p1 = await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: 'A1', jugador2: 'A2', orden: 1 } });
  const p2 = await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: 'B1', jugador2: 'B2', orden: 2 } });
  const p3 = await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: 'C1', jugador2: 'C2', orden: 3 } });

  await prisma.slotPareja.createMany({
    data: [
      { parejaId: p1.id, slotId: 'Viernes-18:00' },
      { parejaId: p2.id, slotId: 'Viernes-18:00' },
      { parejaId: p3.id, slotId: 'Viernes-19:15' },
    ],
  });

  await organizadorService.preCheckInicioTorneo(org.id, torneo.id);
  // Destrabar P1 y P2 con P3 agregándoles 'Viernes-19:15'
  await disponibilidadService.setDisponibilidadDoble(org.id, p1.id, ['Viernes-19:15'], p2.id, ['Viernes-19:15']);
  await organizadorService.preCheckInicioTorneo(org.id, torneo.id, { isReCheck: true });

  const session = organizadorService.preCheckSessions.get(torneo.id);
  const zona = session.categoriasPlan[0].zonas[0];

  if (!zona.requiereArmadoManual && (!zona.partidos || zona.partidos.length === 0)) {
    registrarResultado(
      'precheck_zona_manual_partidos:post-inicio',
      false,
      `1 cancha, 1 cat, 3 parejas: ${zona.nombre} quedó con requiereArmadoManual=false pero tiene ${zona.partidos?.length || 0} partidos creados`
    );
  } else {
    registrarResultado('precheck_zona_manual_partidos:post-inicio', true, 'OK');
  }
}

/**
 * CASO 2: Reproductor mínimo de `precheck_monotonia:post-inicio`
 * Configuración mínima: 1 cancha, 1 categoría, 4 parejas (1 zona MINI_BRACKET).
 * - Las 4 parejas comparten únicamente 'Viernes-18:00' -> se agrupan en 1 zona MINI_BRACKET.
 * - Con 1 sola cancha, P1 toma 'Viernes-18:00' y P2 queda sin horario (1 conflicto base; P3 y P4 son derivados).
 * - Al resolver P2 dándole 'Viernes-19:15' a las parejas 3 y 4, P2 se agenda pero P3 y P4 pasan a ser
 *   conflictos base sin horario (no hay intersección cuádruple >= 20:30), subiendo los conflictos base de 1 a 2.
 */
async function reproPrecheckMonotonia(registrarResultado) {
  await limpiarDb();

  const org = await prisma.organizador.create({
    data: {
      nombre: 'Club Repro Monotonia',
      email: 'repro-monotonia@padel.test',
      passwordHash: 'hash',
      cantidadCanchas: 1,
      viernesInicio: '18:00',
      viernesFin: '23:00',
      sabadoInicio: '09:00',
      sabadoFin: '22:00',
      domingoInicio: '09:00',
      domingoFin: '22:00',
    },
  });

  const torneo = await prisma.torneo.create({
    data: {
      nombre: 'Torneo Repro Monotonia',
      slug: 'torneo-repro-monotonia',
      fecha: parseFechaLocal('2026-09-04'),
      estado: 'BORRADOR',
      organizadorId: org.id,
    },
  });

  const cat = await prisma.categoria.create({
    data: { torneoId: torneo.id, nombre: '6ta', estado: 'BORRADOR' },
  });

  const parejas = [];
  for (let i = 1; i <= 4; i++) {
    const p = await prisma.pareja.create({
      data: { categoriaId: cat.id, jugador1: `J1_${i}`, jugador2: `J2_${i}`, orden: i },
    });
    parejas.push(p);
    await prisma.slotPareja.create({ data: { parejaId: p.id, slotId: 'Viernes-18:00' } });
  }

  const countBase = (pc, sess) => {
    const derived = new Set();
    for (const cp of sess.categoriasPlan) {
      for (const z of cp.zonas) {
        if (z.formato !== 'MINI_BRACKET') continue;
        const p1 = z.partidos.find((p) => p.posicionEnRonda === 1);
        const p2 = z.partidos.find((p) => p.posicionEnRonda === 2);
        if (!p1?.fechaHora || p1.sinHorarioAsignado || !p2?.fechaHora || p2.sinHorarioAsignado) {
          for (const p of z.partidos) {
            if (p.posicionEnRonda >= 3) derived.add(p.id);
          }
        }
      }
    }
    let total = 0;
    for (const c of pc.conflictos || []) {
      for (const item of c.partidosSinHorario || []) {
        if (!derived.has(item.partidoId)) total++;
      }
    }
    return total;
  };

  const pc1 = await organizadorService.preCheckInicioTorneo(org.id, torneo.id);
  const sess1 = organizadorService.preCheckSessions.get(torneo.id);
  const baseAntes = countBase(pc1, sess1);

  // Resolver el único conflicto base (P2)
  const p2Match = sess1.categoriasPlan[0].zonas[0].partidos.find((p) => p.posicionEnRonda === 2);
  await disponibilidadService.setDisponibilidadDoble(
    org.id,
    p2Match.pareja1Id,
    ['Viernes-19:15'],
    p2Match.pareja2Id,
    ['Viernes-19:15']
  );

  const pc2 = await organizadorService.preCheckInicioTorneo(org.id, torneo.id, { isReCheck: true });
  const sess2 = organizadorService.preCheckSessions.get(torneo.id);
  const baseDespues = countBase(pc2, sess2);

  if (baseDespues > baseAntes) {
    registrarResultado(
      'precheck_monotonia:post-inicio',
      false,
      `1 cancha, 1 cat, 4 parejas: los conflictos base subieron de ${baseAntes} a ${baseDespues} tras resolver P2`
    );
  } else {
    registrarResultado('precheck_monotonia:post-inicio', true, 'OK');
  }
}

/**
 * CASO 3: Reproductor mínimo de `eliminatorias_descanso_y_post_zonas:post-reduccion`
 * Escenario:
 * - 4 canchas, 1 categoría de 25 parejas (tiene R32).
 * - En post-inicio, con 4 canchas, las zonas se juegan el sábado a la tarde y terminan a las 19:00 / 20:15.
 * - R32 se agenda normalmente el sábado a las 20:45 en Cancha 1.
 * - Al reducir canchas a 1 en Sábado por lluvia, los partidos de zona de la tarde se compactan en fila india
 *   y terminan después de las 20:45 (ej. a las 22:30 o posterior).
 * - R32 (ya fijado a las 20:45) queda iniciando ANTES de que terminen las zonas de su categoría.
 * - En post-restauración, las canchas vuelven a 4 y las zonas vuelven a terminar antes de las 20:45.
 */
async function reproLluviaEmpujaZonasMasAllaR32(registrarResultado) {
  await limpiarDb();

  const org = await prisma.organizador.create({
    data: {
      nombre: 'Club Repro Lluvia R32',
      email: 'repro-lluvia-r32@padel.test',
      passwordHash: 'hash',
      cantidadCanchas: 4,
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
      nombre: 'Torneo Repro Lluvia R32',
      slug: 'torneo-repro-lluvia-r32',
      fecha: parseFechaLocal('2026-09-04'),
      estado: 'BORRADOR',
      organizadorId: org.id,
    },
  });

  const cat = await prisma.categoria.create({
    data: { torneoId: torneo.id, nombre: '6ta', estado: 'BORRADOR' },
  });

  // 25 parejas con slots suficientes en Sábado de 09:00 a 17:45 (zonas terminan a las 17:45 con 4 canchas)
  const slotsSabado = [
    'Sabado-09:00', 'Sabado-10:15', 'Sabado-11:30', 'Sabado-12:45',
    'Sabado-14:00', 'Sabado-15:15', 'Sabado-16:30', 'Sabado-17:45'
  ];
  for (let i = 1; i <= 25; i++) {
    const p = await prisma.pareja.create({
      data: { categoriaId: cat.id, jugador1: `J1_${i}`, jugador2: `J2_${i}`, orden: i },
    });
    for (const s of slotsSabado) {
      await prisma.slotPareja.create({ data: { parejaId: p.id, slotId: s } });
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
    registrarResultado(
      `eliminatorias_descanso_y_post_zonas:${etapa}`,
      !elimAntes,
      elimAntes
        ? `Ronda ${elimAntes.faseEliminatoria.ronda} empieza en ${new Date(elimAntes.fechaHora).toISOString()} antes del fin de zonas (${new Date(maxZonaEnd).toISOString()})`
        : 'OK'
    );
  };

  await checkEtapa('post-inicio');
  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 1, null, '2026-09-05');
  await checkEtapa('post-reduccion');
  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 4, null, '2026-09-05');
}

async function runPendingTickets() {
  await ensureTestDb();
  resetTestDb();

  console.log('='.repeat(85));
  console.log('⚠️  SUITE DE TICKETS PENDIENTES DE RESOLUCIÓN (FUERA DEL RUNNER)');
  console.log('='.repeat(85));

  const resultados = [];
  function registrarResultado(invarianteEtapa, passed, detalle) {
    const [invariante, etapa] = invarianteEtapa.split(':');
    resultados.push({
      invariante,
      etapa,
      estado: passed ? 'PASS' : 'FAIL',
      detalle,
    });
  }

  try {
    await reproPrecheckZonaManualPartidos(registrarResultado);
    await reproPrecheckMonotonia(registrarResultado);
    await reproLluviaEmpujaZonasMasAllaR32(registrarResultado);
  } finally {
    await limpiarDb();
    await prisma.$disconnect();
  }

  console.table(resultados.map(({ invariante, etapa, estado }) => ({ invariante, etapa, estado })));
  process.exit(0);
}

if (require.main === module) {
  runPendingTickets().catch((err) => {
    console.error('Error fatal:', err);
    process.exit(1);
  });
}

module.exports = { runPendingTickets };
