'use strict';

/**
 * test-scheduler-tickets-pendientes.js
 * Reproductores mínimos determinísticos correspondientes a tickets pendientes de resolución:
 * 1. Zona manual (`precheck_zona_manual_partidos:post-inicio`)
 * 2. Monotonía de pre-check (`precheck_monotonia:post-inicio`)
 * 3. Lluvia empuja zonas más allá de R32 ya fijado (`eliminatorias_descanso_y_post_zonas:post-reduccion`)
 * 4. R32 válido en sábado muta o pierde horario tras lluvia en domingo (`r32_sabado_inmutable_lluvia_domingo`)
 * 5. R32 válido en sábado con zona incompleta se borra tras lluvia en domingo (`r32_sabado_zona_incompleta_lluvia_domingo`)
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

/**
 * CASO 4: R32 con horario válido en sábado + lluvia en domingo + restauración en domingo.
 * Esperable: ningún campo del R32 debe cambiar (fechaHora, canchaNumero, sinHorarioAsignado se mantienen idénticos).
 */
async function reproR32SabadoLluviaDomingo(registrarResultado) {
  await limpiarDb();

  const org = await prisma.organizador.create({
    data: {
      nombre: 'Club Test R32 Sábado Lluvia Domingo',
      email: 'r32-domingo-rain@padel.test',
      passwordHash: 'hash',
      cantidadCanchas: 4,
      viernesInicio: '14:00',
      viernesFin: '23:00',
      sabadoInicio: '09:00',
      sabadoFin: '24:00',
      domingoInicio: '09:00',
      domingoFin: '22:00',
    },
  });

  const torneo = await prisma.torneo.create({
    data: {
      nombre: 'Torneo Test R32 Domingo Rain',
      slug: 'torneo-test-r32-domingo-rain',
      fecha: parseFechaLocal('2026-09-04'),
      estado: 'BORRADOR',
      organizadorId: org.id,
    },
  });

  const cat = await prisma.categoria.create({
    data: { torneoId: torneo.id, nombre: '5ta', estado: 'BORRADOR' },
  });

  for (let i = 1; i <= 25; i++) {
    await prisma.pareja.create({
      data: { categoriaId: cat.id, jugador1: `J1_${i}`, jugador2: `J2_${i}`, orden: i },
    });
  }

  await zonaService.iniciarCategoria(org.id, cat.id);
  await prisma.torneo.update({ where: { id: torneo.id }, data: { estado: 'EN_CURSO' } });
  await generarEliminatoria(org.id, cat.id);

  const baseSaturday = zonaService.proximaFechaPorDia('Sabado', parseFechaLocal('2026-09-04'));
  const partidosZona = await prisma.partido.findMany({
    where: { categoriaId: cat.id, zonaId: { not: null } },
  });
  for (let i = 0; i < partidosZona.length; i++) {
    const cancha = (i % 4) + 1;
    const horaOffset = Math.floor(i / 4) * DURACION_MS;
    await prisma.partido.update({
      where: { id: partidosZona[i].id },
      data: {
        fechaHora: new Date(baseSaturday.getTime() + 10 * 3600 * 1000 + horaOffset),
        canchaNumero: cancha,
        sinHorarioAsignado: false,
      },
    });
  }

  const r32 = await prisma.partido.findFirst({
    where: { categoriaId: cat.id, faseEliminatoria: { ronda: 32 }, esBye: false },
  });

  const fechaSabado22 = new Date(baseSaturday.getTime() + 22 * 3600 * 1000);
  await prisma.partido.update({
    where: { id: r32.id },
    data: {
      fechaHora: fechaSabado22,
      canchaNumero: 3,
      sinHorarioAsignado: false,
      horarioManual: false,
    },
  });

  // 1. Reducción en domingo a 2 canchas
  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 2, null, '2026-09-06');
  const r32PostRed = await prisma.partido.findUnique({ where: { id: r32.id } });
  const intactoPostRed =
    r32PostRed.fechaHora?.getTime() === fechaSabado22.getTime() &&
    r32PostRed.canchaNumero === 3 &&
    r32PostRed.sinHorarioAsignado === false;

  registrarResultado(
    'r32_sabado_inmutable_lluvia_domingo:post-reduccion',
    intactoPostRed,
    intactoPostRed
      ? 'OK'
      : `R32 mutó en domingo a fecha=${r32PostRed.fechaHora?.toISOString()}, cancha=${r32PostRed.canchaNumero}, sinHorario=${r32PostRed.sinHorarioAsignado}`
  );

  // 2. Restauración en domingo a 4 canchas
  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 4, null, '2026-09-06');
  const r32PostRest = await prisma.partido.findUnique({ where: { id: r32.id } });
  const intactoPostRest =
    r32PostRest.fechaHora?.getTime() === fechaSabado22.getTime() &&
    r32PostRest.canchaNumero === 3 &&
    r32PostRest.sinHorarioAsignado === false;

  registrarResultado(
    'r32_sabado_inmutable_lluvia_domingo:post-restauracion',
    intactoPostRest,
    intactoPostRest
      ? 'OK'
      : `R32 mutó en restauración a fecha=${r32PostRest.fechaHora?.toISOString()}, cancha=${r32PostRest.canchaNumero}, sinHorario=${r32PostRest.sinHorarioAsignado}`
  );
}

/**
 * CASO 5: R32 con horario válido en sábado + lluvia en domingo con un partido de zona sin horario.
 * Esperable: ningún campo del R32 debe cambiar (no debe borrarse a sinHorarioAsignado: true por lluvia del domingo).
 */
async function reproR32SabadoLluviaDomingoZonaIncompleta(registrarResultado) {
  await limpiarDb();

  const org = await prisma.organizador.create({
    data: {
      nombre: 'Club Test R32 Sábado Lluvia Domingo Incompleta',
      email: 'r32-domingo-rain-incompleta@padel.test',
      passwordHash: 'hash',
      cantidadCanchas: 4,
      viernesInicio: '14:00',
      viernesFin: '23:00',
      sabadoInicio: '09:00',
      sabadoFin: '24:00',
      domingoInicio: '09:00',
      domingoFin: '22:00',
    },
  });

  const torneo = await prisma.torneo.create({
    data: {
      nombre: 'Torneo Test R32 Domingo Rain Incompleta',
      slug: 'torneo-test-r32-domingo-rain-incompleta',
      fecha: parseFechaLocal('2026-09-04'),
      estado: 'BORRADOR',
      organizadorId: org.id,
    },
  });

  const cat = await prisma.categoria.create({
    data: { torneoId: torneo.id, nombre: '5ta', estado: 'BORRADOR' },
  });

  for (let i = 1; i <= 25; i++) {
    await prisma.pareja.create({
      data: { categoriaId: cat.id, jugador1: `J1_${i}`, jugador2: `J2_${i}`, orden: i },
    });
  }

  await zonaService.iniciarCategoria(org.id, cat.id);
  await prisma.torneo.update({ where: { id: torneo.id }, data: { estado: 'EN_CURSO' } });
  await generarEliminatoria(org.id, cat.id);

  const baseSaturday = zonaService.proximaFechaPorDia('Sabado', parseFechaLocal('2026-09-04'));
  const partidosZona = await prisma.partido.findMany({
    where: { categoriaId: cat.id, zonaId: { not: null } },
  });
  for (let i = 0; i < partidosZona.length - 1; i++) {
    const cancha = (i % 4) + 1;
    const horaOffset = Math.floor(i / 4) * DURACION_MS;
    await prisma.partido.update({
      where: { id: partidosZona[i].id },
      data: {
        fechaHora: new Date(baseSaturday.getTime() + 10 * 3600 * 1000 + horaOffset),
        canchaNumero: cancha,
        sinHorarioAsignado: false,
      },
    });
  }
  // Último partido de zona queda sin horario
  await prisma.partido.update({
    where: { id: partidosZona[partidosZona.length - 1].id },
    data: {
      fechaHora: null,
      canchaNumero: null,
      sinHorarioAsignado: true,
    },
  });

  const r32 = await prisma.partido.findFirst({
    where: { categoriaId: cat.id, faseEliminatoria: { ronda: 32 }, esBye: false },
  });

  const fechaSabado22 = new Date(baseSaturday.getTime() + 22 * 3600 * 1000);
  await prisma.partido.update({
    where: { id: r32.id },
    data: {
      fechaHora: fechaSabado22,
      canchaNumero: 3,
      sinHorarioAsignado: false,
      horarioManual: false,
    },
  });

  // 1. Reducción en domingo a 2 canchas
  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 2, null, '2026-09-06');
  const r32PostRed = await prisma.partido.findUnique({ where: { id: r32.id } });
  const intactoPostRed =
    r32PostRed.fechaHora?.getTime() === fechaSabado22.getTime() &&
    r32PostRed.canchaNumero === 3 &&
    r32PostRed.sinHorarioAsignado === false;

  registrarResultado(
    'r32_sabado_zona_incompleta_lluvia_domingo:post-reduccion',
    intactoPostRed,
    intactoPostRed
      ? 'OK'
      : `R32 mutó en domingo a fecha=${r32PostRed.fechaHora?.toISOString()}, cancha=${r32PostRed.canchaNumero}, sinHorario=${r32PostRed.sinHorarioAsignado}`
  );

  // 2. Restauración en domingo a 4 canchas
  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 4, null, '2026-09-06');
  const r32PostRest = await prisma.partido.findUnique({ where: { id: r32.id } });
  const intactoPostRest =
    r32PostRest.fechaHora?.getTime() === fechaSabado22.getTime() &&
    r32PostRest.canchaNumero === 3 &&
    r32PostRest.sinHorarioAsignado === false;

  registrarResultado(
    'r32_sabado_zona_incompleta_lluvia_domingo:post-restauracion',
    intactoPostRest,
    intactoPostRest
      ? 'OK'
      : `R32 mutó en restauración a fecha=${r32PostRest.fechaHora?.toISOString()}, cancha=${r32PostRest.canchaNumero}, sinHorario=${r32PostRest.sinHorarioAsignado}`
  );
}

/**
 * CASO (a): R32 manual (horarioManual: true) y R32 automático de sábado intactos con lluvia de domingo.
 * El R32 manual está en una cancha que el domingo queda cerrada (ej: Cancha 4 cuando domingo reduce a 2 canchas).
 */
async function reproR32ManualYAutoSabadoLluviaDomingo(registrarResultado) {
  await limpiarDb();

  const org = await prisma.organizador.create({
    data: {
      nombre: 'Club Test R32 Manual y Auto',
      email: 'r32-manual-auto@padel.test',
      passwordHash: 'hash',
      cantidadCanchas: 4,
      viernesInicio: '14:00',
      viernesFin: '23:00',
      sabadoInicio: '09:00',
      sabadoFin: '24:00',
      domingoInicio: '09:00',
      domingoFin: '22:00',
    },
  });

  const torneo = await prisma.torneo.create({
    data: {
      nombre: 'Torneo Test R32 Manual y Auto',
      slug: 'torneo-r32-manual-auto',
      fecha: parseFechaLocal('2026-09-04'),
      estado: 'BORRADOR',
      organizadorId: org.id,
    },
  });

  const cat = await prisma.categoria.create({
    data: { torneoId: torneo.id, nombre: '5ta', estado: 'BORRADOR' },
  });

  for (let i = 1; i <= 25; i++) {
    await prisma.pareja.create({
      data: { categoriaId: cat.id, jugador1: `J1_${i}`, jugador2: `J2_${i}`, orden: i },
    });
  }

  await zonaService.iniciarCategoria(org.id, cat.id);
  const zonasCat = await prisma.zona.findMany({ where: { categoriaId: cat.id } });
  await prisma.zona.update({ where: { id: zonasCat[0].id }, data: { clasifican: 3 } });
  await prisma.zona.update({ where: { id: zonasCat[1].id }, data: { clasifican: 3 } });
  await prisma.torneo.update({ where: { id: torneo.id }, data: { estado: 'EN_CURSO' } });
  await generarEliminatoria(org.id, cat.id);

  const baseSaturday = zonaService.proximaFechaPorDia('Sabado', parseFechaLocal('2026-09-04'));
  const partidosZona = await prisma.partido.findMany({
    where: { categoriaId: cat.id, zonaId: { not: null } },
  });
  for (let i = 0; i < partidosZona.length; i++) {
    const cancha = (i % 4) + 1;
    const horaOffset = Math.floor(i / 4) * DURACION_MS;
    await prisma.partido.update({
      where: { id: partidosZona[i].id },
      data: {
        fechaHora: new Date(baseSaturday.getTime() + 10 * 3600 * 1000 + horaOffset),
        canchaNumero: cancha,
        sinHorarioAsignado: false,
      },
    });
  }

  const r32Matches = await prisma.partido.findMany({
    where: { categoriaId: cat.id, faseEliminatoria: { ronda: 32 }, esBye: false },
    take: 2,
  });

  const fechaSabado22 = new Date(baseSaturday.getTime() + 22 * 3600 * 1000);
  // R32_1: Automático en Cancha 3
  await prisma.partido.update({
    where: { id: r32Matches[0].id },
    data: {
      fechaHora: fechaSabado22,
      canchaNumero: 3,
      sinHorarioAsignado: false,
      horarioManual: false,
    },
  });

  // R32_2: Manual en Cancha 4 (cancha que queda cerrada en domingo al reducir a 2 canchas)
  await prisma.partido.update({
    where: { id: r32Matches[1].id },
    data: {
      fechaHora: fechaSabado22,
      canchaNumero: 4,
      sinHorarioAsignado: false,
      horarioManual: true,
    },
  });

  // 1. Reducción en domingo a 2 canchas
  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 2, null, '2026-09-06');
  const p1Red = await prisma.partido.findUnique({ where: { id: r32Matches[0].id } });
  const p2Red = await prisma.partido.findUnique({ where: { id: r32Matches[1].id } });

  const p1IntactoRed = p1Red.fechaHora?.getTime() === fechaSabado22.getTime() && p1Red.canchaNumero === 3 && p1Red.sinHorarioAsignado === false;
  const p2IntactoRed = p2Red.fechaHora?.getTime() === fechaSabado22.getTime() && p2Red.canchaNumero === 4 && p2Red.horarioManual === true && p2Red.sinHorarioAsignado === false;

  registrarResultado(
    'r32_manual_y_auto_sabado_lluvia_domingo:post-reduccion',
    p1IntactoRed && p2IntactoRed,
    p1IntactoRed && p2IntactoRed
      ? 'OK'
      : `Auto: c=${p1Red.canchaNumero}, t=${p1Red.fechaHora?.toISOString()} | Manual: c=${p2Red.canchaNumero}, t=${p2Red.fechaHora?.toISOString()}, man=${p2Red.horarioManual}`
  );

  // 2. Restauración en domingo a 4 canchas
  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 4, null, '2026-09-06');
  const p1Rest = await prisma.partido.findUnique({ where: { id: r32Matches[0].id } });
  const p2Rest = await prisma.partido.findUnique({ where: { id: r32Matches[1].id } });

  const p1IntactoRest = p1Rest.fechaHora?.getTime() === fechaSabado22.getTime() && p1Rest.canchaNumero === 3 && p1Rest.sinHorarioAsignado === false;
  const p2IntactoRest = p2Rest.fechaHora?.getTime() === fechaSabado22.getTime() && p2Rest.canchaNumero === 4 && p2Rest.horarioManual === true && p2Rest.sinHorarioAsignado === false;

  registrarResultado(
    'r32_manual_y_auto_sabado_lluvia_domingo:post-restauracion',
    p1IntactoRest && p2IntactoRest,
    p1IntactoRest && p2IntactoRest
      ? 'OK'
      : `Auto: c=${p1Rest.canchaNumero}, t=${p1Rest.fechaHora?.toISOString()} | Manual: c=${p2Rest.canchaNumero}, t=${p2Rest.fechaHora?.toISOString()}, man=${p2Rest.horarioManual}`
  );
}

/**
 * CASO (b): Octavos en adelante SÍ se reubican con la lluvia de domingo y se compactan al restaurar.
 */
async function reproOctavosSeReubicanLluviaDomingo(registrarResultado) {
  await limpiarDb();

  const org = await prisma.organizador.create({
    data: {
      nombre: 'Club Test Octavos Lluvia',
      email: 'octavos-lluvia@padel.test',
      passwordHash: 'hash',
      cantidadCanchas: 4,
      viernesInicio: '14:00',
      viernesFin: '23:00',
      sabadoInicio: '09:00',
      sabadoFin: '24:00',
      domingoInicio: '09:00',
      domingoFin: '22:00',
    },
  });

  const torneo = await prisma.torneo.create({
    data: {
      nombre: 'Torneo Test Octavos Lluvia',
      slug: 'torneo-octavos-lluvia',
      fecha: parseFechaLocal('2026-09-04'),
      estado: 'BORRADOR',
      organizadorId: org.id,
    },
  });

  const cat = await prisma.categoria.create({
    data: { torneoId: torneo.id, nombre: '6ta', estado: 'BORRADOR' },
  });

  for (let i = 1; i <= 16; i++) {
    await prisma.pareja.create({
      data: { categoriaId: cat.id, jugador1: `J1_${i}`, jugador2: `J2_${i}`, orden: i },
    });
  }

  await zonaService.iniciarCategoria(org.id, cat.id);
  await prisma.torneo.update({ where: { id: torneo.id }, data: { estado: 'EN_CURSO' } });
  await generarEliminatoria(org.id, cat.id);
  await programarHorariosEliminatorias(org.id, torneo.id);

  // Reducción domingo a 2 canchas
  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 2, null, '2026-09-06');
  const partidosRed = await prisma.partido.findMany({
    where: { categoriaId: cat.id, faseEliminatoriaId: { not: null }, fechaHora: { not: null }, sinHorarioAsignado: false },
  });

  const todasEnCanchasActivas = partidosRed.every((p) => p.canchaNumero <= 2);
  registrarResultado(
    'octavos_reubicacion_domingo:post-reduccion',
    todasEnCanchasActivas && partidosRed.length > 0,
    todasEnCanchasActivas ? 'OK' : `Hay partidos en canchas > 2: ${partidosRed.filter(p => p.canchaNumero > 2).map(p => p.canchaNumero)}`
  );

  // Restauración domingo a 4 canchas
  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 4, null, '2026-09-06');
  const partidosRest = await prisma.partido.findMany({
    where: { categoriaId: cat.id, faseEliminatoriaId: { not: null }, fechaHora: { not: null }, sinHorarioAsignado: false },
  });

  const usaCanchasRestauradas = partidosRest.some((p) => p.canchaNumero > 2);
  registrarResultado(
    'octavos_reubicacion_domingo:post-restauracion',
    usaCanchasRestauradas,
    usaCanchasRestauradas ? 'OK' : 'Ningún partido se expandió a canchas 3 o 4 tras restaurar'
  );
}

/**
 * CASO (c): R32 recién generado con zonas incompletas queda pendiente.
 */
async function reproR32RecienGeneradoZonasIncompletasQuedaPendiente(registrarResultado) {
  await limpiarDb();

  const org = await prisma.organizador.create({
    data: {
      nombre: 'Club Test R32 Recien Generado',
      email: 'r32-nuevo-incompleto@padel.test',
      passwordHash: 'hash',
      cantidadCanchas: 4,
      viernesInicio: '14:00',
      viernesFin: '23:00',
      sabadoInicio: '09:00',
      sabadoFin: '24:00',
      domingoInicio: '09:00',
      domingoFin: '22:00',
    },
  });

  const torneo = await prisma.torneo.create({
    data: {
      nombre: 'Torneo Test R32 Nuevo',
      slug: 'torneo-r32-nuevo',
      fecha: parseFechaLocal('2026-09-04'),
      estado: 'BORRADOR',
      organizadorId: org.id,
    },
  });

  const cat = await prisma.categoria.create({
    data: { torneoId: torneo.id, nombre: '5ta', estado: 'BORRADOR' },
  });

  for (let i = 1; i <= 25; i++) {
    await prisma.pareja.create({
      data: { categoriaId: cat.id, jugador1: `J1_${i}`, jugador2: `J2_${i}`, orden: i },
    });
  }

  await zonaService.iniciarCategoria(org.id, cat.id);
  await prisma.torneo.update({ where: { id: torneo.id }, data: { estado: 'EN_CURSO' } });
  await generarEliminatoria(org.id, cat.id);

  // Dejamos un partido de zona sin horario
  const primerPartidoZona = await prisma.partido.findFirst({
    where: { categoriaId: cat.id, zonaId: { not: null } },
  });
  await prisma.partido.update({
    where: { id: primerPartidoZona.id },
    data: { fechaHora: null, canchaNumero: null, sinHorarioAsignado: true },
  });

  // Ejecutamos programarHorariosEliminatorias
  await programarHorariosEliminatorias(org.id, torneo.id, cat.id);

  const r32Matches = await prisma.partido.findMany({
    where: { categoriaId: cat.id, faseEliminatoria: { ronda: 32 }, esBye: false },
  });

  const todosSinHorario = r32Matches.every((p) => p.sinHorarioAsignado === true && p.fechaHora === null);
  registrarResultado(
    'r32_recien_generado_zonas_incompletas:post-inicio',
    todosSinHorario && r32Matches.length > 0,
    todosSinHorario ? 'OK' : 'Algún R32 recibió horario a pesar de zonas incompletas'
  );
}

/**
 * CASO (d): Restauración global sin diaKey con overrides de sábado y domingo: la iteración de domingo no modifica ningún R32 del sábado.
 */
async function reproRestauracionGlobalSinDiaKeyNoModificaR32(registrarResultado) {
  await limpiarDb();

  const org = await prisma.organizador.create({
    data: {
      nombre: 'Club Test Global Sin DiaKey',
      email: 'global-sin-diakey@padel.test',
      passwordHash: 'hash',
      cantidadCanchas: 4,
      viernesInicio: '14:00',
      viernesFin: '23:00',
      sabadoInicio: '09:00',
      sabadoFin: '24:00',
      domingoInicio: '09:00',
      domingoFin: '22:00',
    },
  });

  const torneo = await prisma.torneo.create({
    data: {
      nombre: 'Torneo Test Global Sin DiaKey',
      slug: 'torneo-global-sin-diakey',
      fecha: parseFechaLocal('2026-09-04'),
      estado: 'BORRADOR',
      organizadorId: org.id,
    },
  });

  const cat = await prisma.categoria.create({
    data: { torneoId: torneo.id, nombre: '5ta', estado: 'BORRADOR' },
  });

  for (let i = 1; i <= 25; i++) {
    await prisma.pareja.create({
      data: { categoriaId: cat.id, jugador1: `J1_${i}`, jugador2: `J2_${i}`, orden: i },
    });
  }

  await zonaService.iniciarCategoria(org.id, cat.id);
  await prisma.torneo.update({ where: { id: torneo.id }, data: { estado: 'EN_CURSO' } });
  await generarEliminatoria(org.id, cat.id);

  const baseSaturday = zonaService.proximaFechaPorDia('Sabado', parseFechaLocal('2026-09-04'));
  const partidosZona = await prisma.partido.findMany({
    where: { categoriaId: cat.id, zonaId: { not: null } },
  });
  for (let i = 0; i < partidosZona.length; i++) {
    const cancha = (i % 4) + 1;
    const horaOffset = Math.floor(i / 4) * DURACION_MS;
    await prisma.partido.update({
      where: { id: partidosZona[i].id },
      data: {
        fechaHora: new Date(baseSaturday.getTime() + 10 * 3600 * 1000 + horaOffset),
        canchaNumero: cancha,
        sinHorarioAsignado: false,
      },
    });
  }

  const r32 = await prisma.partido.findFirst({
    where: { categoriaId: cat.id, faseEliminatoria: { ronda: 32 }, esBye: false },
  });

  const fechaSabado22 = new Date(baseSaturday.getTime() + 22 * 3600 * 1000);
  await prisma.partido.update({
    where: { id: r32.id },
    data: {
      fechaHora: fechaSabado22,
      canchaNumero: 3,
      sinHorarioAsignado: false,
      horarioManual: false,
    },
  });

  // Creamos overrides en Sábado (3 canchas) y en Domingo (2 canchas)
  await canchasOverridesService.setOverrideDia(torneo.id, '2026-09-05', 3, new Date(), {});
  await canchasOverridesService.setOverrideDia(torneo.id, '2026-09-06', 2, new Date(), {});

  // Ejecutar restauración global sin diaKey (restaurar todas las canchas a 4)
  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 4, null, null);

  const r32Post = await prisma.partido.findUnique({ where: { id: r32.id } });
  const intacto =
    r32Post.fechaHora?.getTime() === fechaSabado22.getTime() &&
    r32Post.canchaNumero === 3 &&
    r32Post.sinHorarioAsignado === false;

  registrarResultado(
    'restauracion_global_sin_diakey_no_toca_r32:post-restauracion',
    intacto,
    intacto
      ? 'OK'
      : `R32 mutó a fecha=${r32Post.fechaHora?.toISOString()}, cancha=${r32Post.canchaNumero}, sinHorario=${r32Post.sinHorarioAsignado}`
  );
}

/**
 * TEST DE EQUIVALENCIA: Con un R32 con horario válido, los Octavos en adelante quedan
 * idénticos corriendo con soloDomingo: true que con la corrida completa.
 */
async function reproEquivalenciaSoloDomingo(registrarResultado) {
  await limpiarDb();

  const org = await prisma.organizador.create({
    data: {
      nombre: 'Club Test Equivalencia SoloDomingo',
      email: 'equiv-solodomingo@padel.test',
      passwordHash: 'hash',
      cantidadCanchas: 4,
      viernesInicio: '14:00',
      viernesFin: '23:00',
      sabadoInicio: '09:00',
      sabadoFin: '24:00',
      domingoInicio: '09:00',
      domingoFin: '22:00',
    },
  });

  const setupTorneo = async (slug) => {
    const org = await prisma.organizador.create({
      data: {
        nombre: `Club ${slug}`,
        email: `${slug}@padel.test`,
        passwordHash: 'hash',
        cantidadCanchas: 4,
        viernesInicio: '14:00',
        viernesFin: '23:00',
        sabadoInicio: '09:00',
        sabadoFin: '24:00',
        domingoInicio: '09:00',
        domingoFin: '22:00',
      },
    });

    const torneo = await prisma.torneo.create({
      data: {
        nombre: `Torneo ${slug}`,
        slug,
        fecha: parseFechaLocal('2026-09-04'),
        estado: 'BORRADOR',
        organizadorId: org.id,
      },
    });

    const cat = await prisma.categoria.create({
      data: { torneoId: torneo.id, nombre: '5ta', estado: 'BORRADOR' },
    });

    for (let i = 1; i <= 25; i++) {
      await prisma.pareja.create({
        data: { categoriaId: cat.id, jugador1: `J1_${i}`, jugador2: `J2_${i}`, orden: i },
      });
    }

    await zonaService.iniciarCategoria(org.id, cat.id);
    await prisma.torneo.update({ where: { id: torneo.id }, data: { estado: 'EN_CURSO' } });
    await generarEliminatoria(org.id, cat.id);

    const baseSaturday = zonaService.proximaFechaPorDia('Sabado', parseFechaLocal('2026-09-04'));
    const partidosZona = await prisma.partido.findMany({
      where: { categoriaId: cat.id, zonaId: { not: null } },
    });
    for (let i = 0; i < partidosZona.length; i++) {
      const cancha = (i % 4) + 1;
      const horaOffset = Math.floor(i / 4) * DURACION_MS;
      await prisma.partido.update({
        where: { id: partidosZona[i].id },
        data: {
          fechaHora: new Date(baseSaturday.getTime() + 10 * 3600 * 1000 + horaOffset),
          canchaNumero: cancha,
          sinHorarioAsignado: false,
        },
      });
    }

    const r32 = await prisma.partido.findFirst({
      where: { categoriaId: cat.id, faseEliminatoria: { ronda: 32 }, esBye: false },
    });
    const fechaSabado22 = new Date(baseSaturday.getTime() + 22 * 3600 * 1000);
    await prisma.partido.update({
      where: { id: r32.id },
      data: {
        fechaHora: fechaSabado22,
        canchaNumero: 3,
        sinHorarioAsignado: false,
        horarioManual: false,
      },
    });

    return { org, torneo, cat, r32, fechaSabado22 };
  };

  // Torneo A: corrida completa
  const { org: orgA, torneo: torneoA, cat: catA } = await setupTorneo('torneo-a-completo');
  await programarHorariosEliminatorias(orgA.id, torneoA.id, catA.id);

  const partidosA = await prisma.partido.findMany({
    where: { categoriaId: catA.id, faseEliminatoria: { ronda: { lt: 32 } } },
    include: { faseEliminatoria: true },
    orderBy: [{ faseEliminatoria: { ronda: 'desc' } }, { posicionEnRonda: 'asc' }],
  });

  // Torneo B: corrida con soloDomingo: true
  const { org: orgB, torneo: torneoB, cat: catB, r32: r32B, fechaSabado22 } = await setupTorneo('torneo-b-solodomingo');
  await programarHorariosEliminatorias(orgB.id, torneoB.id, catB.id, null, null, { soloDomingo: true });

  const r32PostB = await prisma.partido.findUnique({ where: { id: r32B.id } });
  const r32IntactoB = r32PostB.fechaHora?.getTime() === fechaSabado22.getTime() && r32PostB.canchaNumero === 3;

  const partidosB = await prisma.partido.findMany({
    where: { categoriaId: catB.id, faseEliminatoria: { ronda: { lt: 32 } } },
    include: { faseEliminatoria: true },
    orderBy: [{ faseEliminatoria: { ronda: 'desc' } }, { posicionEnRonda: 'asc' }],
  });

  let diferencias = [];
  if (!r32IntactoB) {
    diferencias.push(`R32 en B mutó: t=${r32PostB.fechaHora?.toISOString()}, c=${r32PostB.canchaNumero}`);
  }
  if (partidosA.length !== partidosB.length) {
    diferencias.push(`Cantidad distinta de partidos: A=${partidosA.length}, B=${partidosB.length}`);
  } else {
    for (let i = 0; i < partidosA.length; i++) {
      const pA = partidosA[i];
      const pB = partidosB[i];
      const tA = pA.fechaHora ? new Date(pA.fechaHora).getTime() : null;
      const tB = pB.fechaHora ? new Date(pB.fechaHora).getTime() : null;
      if (tA !== tB || pA.canchaNumero !== pB.canchaNumero || pA.sinHorarioAsignado !== pB.sinHorarioAsignado) {
        diferencias.push(`Ronda ${pA.faseEliminatoria.ronda} Pos ${pA.posicionEnRonda}: A=(t=${pA.fechaHora?.toISOString()}, c=${pA.canchaNumero}, sinH=${pA.sinHorarioAsignado}) vs B=(t=${pB.fechaHora?.toISOString()}, c=${pB.canchaNumero}, sinH=${pB.sinHorarioAsignado})`);
      }
    }
  }

  const sonIdenticos = diferencias.length === 0;
  registrarResultado(
    'equivalencia_solo_domingo:comparacion',
    sonIdenticos,
    sonIdenticos ? 'OK' : diferencias.slice(0, 3).join('; ')
  );
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
    await reproR32SabadoLluviaDomingo(registrarResultado);
    await reproR32SabadoLluviaDomingoZonaIncompleta(registrarResultado);
    await reproR32ManualYAutoSabadoLluviaDomingo(registrarResultado);
    await reproOctavosSeReubicanLluviaDomingo(registrarResultado);
    await reproR32RecienGeneradoZonasIncompletasQuedaPendiente(registrarResultado);
    await reproRestauracionGlobalSinDiaKeyNoModificaR32(registrarResultado);
    await reproEquivalenciaSoloDomingo(registrarResultado);
  } finally {
    await limpiarDb();
    await prisma.$disconnect();
  }

  console.table(resultados.map(({ invariante, etapa, estado, detalle }) => ({ invariante, etapa, estado, detalle })));
  process.exit(0);
}

if (require.main === module) {
  runPendingTickets().catch((err) => {
    console.error('Error fatal:', err);
    process.exit(1);
  });
}

module.exports = { runPendingTickets };
