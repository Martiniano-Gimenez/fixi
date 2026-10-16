'use strict';

/**
 * test-scheduler-invariantes-repro.js
 * Reproductores determinísticos mínimos (sin PRNG) para cada invariante:etapa
 * detectado por test-fuzz-scheduler.js.
 *
 * Cada caso construye la configuración mínima de canchas, categorías y parejas
 * y verifica el invariante correspondiente. Hoy falla (exit code 1) exponiendo
 * los bugs de producción sin tocar código de producción.
 */

const { ensureTestDb } = require('./utils/testEnvGuard');
const { resetTestDb } = require('./reset-test-db');
const prisma = require('../src/lib/prisma');
const organizadorService = require('../src/services/organizador.service');
const zonaService = require('../src/services/zona.service');
const disponibilidadService = require('../src/services/disponibilidad.service');
const { generarEliminatoria } = require('../src/services/faseEliminatoria.service');
const { programarHorariosEliminatorias } = require('../src/services/eliminatoriaScheduler.service');
const canchasOverridesService = require('../src/services/canchasOverrides.service');
const { DURACION_PARTIDO_MIN } = require('../src/services/slots.service');
const { parseFechaLocal } = require('../src/utils/dateUtils');

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
 * CASO 3: Reproductor mínimo de:
 * - `cancha_sin_solapamiento:post-reduccion`
 * - `cancha_sin_solapamiento:post-restauracion`
 * - `mini_bracket_orden_p3_p4:post-reduccion`
 * - `modo_lluvia:post-reduccion`
 *
 * Configuración mínima: 2 canchas, 1 categoría, 6 parejas (1 zona MINI_BRACKET de 4 + 1 zona RR de 2).
 * - En 2 canchas el viernes:
 *   - Zona A (4 parejas, MINI_BRACKET): P1 (18:00 C1), P2 (18:00 C2), P3 (19:15 C1), P4 (19:15 C2).
 *   - Zona B (2 parejas, ROUND_ROBIN): P_B (20:30 C1).
 * - Al reducir de 2 a 1 cancha el viernes:
 *   - P3 y P4 son ignorados por asignarHorariosModoLluviaMCF (tienen pareja1Id=null, faseEliminatoriaId=null).
 *   - P2 se mueve a 19:15 C1 (solapando Cancha 1 con P3 -> falla `cancha_sin_solapamiento:post-reduccion`).
 *   - P2 termina a las 20:30 mientras P3/P4 empiezan a las 19:15 (falla `mini_bracket_orden_p3_p4:post-reduccion`).
 *   - P4 queda PENDIENTE en Cancha 2 > 1 cancha activa sin estar en partidosSinSlot (falla `modo_lluvia:post-reduccion`).
 * - Al restaurar de 1 a 2 canchas el viernes:
 *   - asignarHorariosModoLluviaMCF ubica P1 (18:00 C1), P2 (18:00 C2) y adelanta P_B a 19:15 C1,
 *     solapando Cancha 1 a las 19:15 con P3 (falla `cancha_sin_solapamiento:post-restauracion`).
 */
async function reproModoLluviaMiniBracketYColisiones(registrarResultado) {
  await limpiarDb();

  const org = await prisma.organizador.create({
    data: {
      nombre: 'Club Repro Lluvia MB',
      email: 'repro-lluvia-mb@padel.test',
      passwordHash: 'hash',
      cantidadCanchas: 2,
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
      nombre: 'Torneo Repro Lluvia MB',
      slug: 'torneo-repro-lluvia-mb',
      fecha: parseFechaLocal('2026-09-04'),
      estado: 'EN_CURSO',
      organizadorId: org.id,
    },
  });

  const cat = await prisma.categoria.create({
    data: { torneoId: torneo.id, nombre: '6ta', estado: 'EN_CURSO' },
  });

  const zonaA = await prisma.zona.create({
    data: { categoriaId: cat.id, nombre: 'Zona A', formato: 'MINI_BRACKET', clasifican: 3 },
  });
  const zonaB = await prisma.zona.create({
    data: { categoriaId: cat.id, nombre: 'Zona B', formato: 'ROUND_ROBIN', clasifican: 2 },
  });

  const parejas = [];
  for (let i = 1; i <= 6; i++) {
    const p = await prisma.pareja.create({
      data: { categoriaId: cat.id, jugador1: `J1_${i}`, jugador2: `J2_${i}`, orden: i },
    });
    parejas.push(p);
    await prisma.zonaPareja.create({
      data: { zonaId: i <= 4 ? zonaA.id : zonaB.id, parejaId: p.id },
    });
    if (i <= 4) {
      await prisma.slotPareja.createMany({
        data: [
          { parejaId: p.id, slotId: 'Viernes-18:00' },
          { parejaId: p.id, slotId: 'Viernes-19:15' },
        ],
      });
    } else {
      await prisma.slotPareja.create({
        data: { parejaId: p.id, slotId: 'Viernes-20:30' },
      });
    }
  }

  await zonaService.generarPartidosZonaHelper(prisma, cat.id, zonaA.id, 'MINI_BRACKET', 4, parejas.slice(0, 4));
  await zonaService.generarPartidosZonaHelper(prisma, cat.id, zonaB.id, 'ROUND_ROBIN', 2, parejas.slice(4, 6));

  await zonaService.asignarHorariosAutomatico(org.id, [cat.id]);

  // Reducir de 2 a 1 cancha el viernes (2026-09-04)
  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 1, null, '2026-09-04');

  const postReduccion = await prisma.partido.findMany({ where: { categoriaId: cat.id } });
  const diaOverride = canchasOverridesService.getCanchasDia(torneo.id, '2026-09-04', 2);
  const sinSlotMap = diaOverride?.partidosSinSlot || {};

  // 1. Chequear cancha_sin_solapamiento:post-reduccion
  let colisionReduccion = null;
  for (let i = 0; i < postReduccion.length; i++) {
    for (let j = i + 1; j < postReduccion.length; j++) {
      const a = postReduccion[i];
      const b = postReduccion[j];
      if (!a.fechaHora || !b.fechaHora || a.canchaNumero !== b.canchaNumero) continue;
      const sA = new Date(a.fechaHora).getTime();
      const sB = new Date(b.fechaHora).getTime();
      if (sA < sB + DURACION_MS && sA + DURACION_MS > sB) {
        colisionReduccion = `2 canchas->1, 1 cat, 6 parejas: Cancha ${a.canchaNumero} solapa partidos en ${new Date(sA).toISOString()}`;
      }
    }
  }
  registrarResultado('cancha_sin_solapamiento:post-reduccion', !colisionReduccion, colisionReduccion || 'OK');

  // 2. Chequear mini_bracket_orden_p3_p4:post-reduccion
  const zAPartidosRed = postReduccion.filter((p) => p.zonaId === zonaA.id);
  const p1Red = zAPartidosRed.find((p) => p.posicionEnRonda === 1);
  const p2Red = zAPartidosRed.find((p) => p.posicionEnRonda === 2);
  const p3Red = zAPartidosRed.find((p) => p.posicionEnRonda === 3);
  const minP3Start = Math.max(
    new Date(p1Red.fechaHora).getTime() + DURACION_MS,
    new Date(p2Red.fechaHora).getTime() + DURACION_MS
  );
  const p3Start = new Date(p3Red.fechaHora).getTime();
  registrarResultado(
    'mini_bracket_orden_p3_p4:post-reduccion',
    p3Start >= minP3Start,
    `2 canchas->1, 1 cat, 6 parejas: P3 empieza en ${new Date(p3Start).toISOString()} antes del fin de P2 (${new Date(minP3Start).toISOString()})`
  );

  // 3. Chequear modo_lluvia:post-reduccion (ningún PENDIENTE en cancha > 1 salvo partidosSinSlot)
  const enCanchaInactiva = postReduccion.find(
    (p) => p.estado === 'PENDIENTE' && p.fechaHora && p.canchaNumero > 1 && !sinSlotMap[p.id]
  );
  registrarResultado(
    'modo_lluvia:post-reduccion',
    !enCanchaInactiva,
    enCanchaInactiva
      ? `2 canchas->1, 1 cat, 6 parejas: Partido PENDIENTE (pos ${enCanchaInactiva.posicionEnRonda}) quedó en cancha ${enCanchaInactiva.canchaNumero} > 1 sin estar en partidosSinSlot`
      : 'OK'
  );

  // Restaurar de 1 a 2 canchas el viernes (2026-09-04)
  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 2, null, '2026-09-04');
  const postRestauracion = await prisma.partido.findMany({ where: { categoriaId: cat.id } });

  // 4. Chequear cancha_sin_solapamiento:post-restauracion
  let colisionRestauracion = null;
  for (let i = 0; i < postRestauracion.length; i++) {
    for (let j = i + 1; j < postRestauracion.length; j++) {
      const a = postRestauracion[i];
      const b = postRestauracion[j];
      if (!a.fechaHora || !b.fechaHora || a.canchaNumero !== b.canchaNumero) continue;
      const sA = new Date(a.fechaHora).getTime();
      const sB = new Date(b.fechaHora).getTime();
      if (sA < sB + DURACION_MS && sA + DURACION_MS > sB) {
        colisionRestauracion = `2 canchas->1->2, 1 cat, 6 parejas: Cancha ${a.canchaNumero} solapa P3 y Zona B en ${new Date(sA).toISOString()}`;
      }
    }
  }
  registrarResultado('cancha_sin_solapamiento:post-restauracion', !colisionRestauracion, colisionRestauracion || 'OK');
}

/**
 * CASO 4: Reproductor mínimo de:
 * - `modo_lluvia:post-restauracion`
 * - `mini_bracket_orden_p3_p4:post-restauracion`
 *
 * Configuración mínima: 2 canchas, 1 categoría, 4 parejas (1 zona MINI_BRACKET) en Sábado trasnoche.
 * - P1 (03:30 C1), P2 (03:30 C2), P3 (04:45 C1), P4 (04:45 C2) en Sábado trasnoche (límite dayLimitMs = 06:00).
 * - Al reducir Sábado (2026-09-05) de 2 a 1 cancha con P1 en estado FINALIZADO y el turno 04:45 de C1 ocupado,
 *   o iniciando Sábado a las 03:30 con 1 partido FINALIZADO en 04:45 C1: P2 no tiene hueco antes de las 06:00
 *   y queda con fechaHora = null, sinHorarioAsignado = true.
 * - Al restaurar Sábado (2026-09-05) a 2 canchas, como P2 tiene fechaHora = null,
 *   asignarHorariosModoLluviaMCF evalúa su día con refFecha (Viernes 2026-09-04 != 2026-09-05),
 *   por lo que P2 jamás se recupera:
 *   - Se pierde 1 partido agendado tras reducir y restaurar (`modo_lluvia:post-restauracion`).
 *   - P3 y P4 conservan horario (04:45) mientras P2 sigue sin horario (`mini_bracket_orden_p3_p4:post-restauracion`).
 */
async function reproSabadoRestauracionPerdidaYMiniBracket(registrarResultado) {
  await limpiarDb();

  const org = await prisma.organizador.create({
    data: {
      nombre: 'Club Repro Sabado Restore',
      email: 'repro-sab-restore@padel.test',
      passwordHash: 'hash',
      cantidadCanchas: 2,
      viernesInicio: '18:00',
      viernesFin: '22:00',
      sabadoInicio: '10:00',
      sabadoFin: '02:00',
      domingoInicio: '09:00',
      domingoFin: '22:00',
    },
  });

  const torneo = await prisma.torneo.create({
    data: {
      nombre: 'Torneo Repro Sabado Restore',
      slug: 'torneo-repro-sab-restore',
      fecha: parseFechaLocal('2026-09-04'),
      estado: 'EN_CURSO',
      organizadorId: org.id,
    },
  });

  const cat = await prisma.categoria.create({
    data: { torneoId: torneo.id, nombre: '6ta', estado: 'EN_CURSO' },
  });

  // Entre Sábado 10:00 y Domingo 06:00 (1200 min) entran máximo 16 partidos de 75 min en 1 cancha.
  // 5 zonas RR de 3 parejas (15 partidos) + 1 zona MINI_BRACKET de 4 parejas (P1, P2, P3, P4 en la noche del sábado).
  const slotsSabadoTemprano = [
    'Sabado-10:00', 'Sabado-11:15', 'Sabado-12:30', 'Sabado-13:45',
    'Sabado-15:00', 'Sabado-16:15', 'Sabado-17:30', 'Sabado-18:45',
    'Sabado-20:00', 'Sabado-21:15',
  ];

  let orden = 1;
  for (let zIdx = 1; zIdx <= 5; zIdx++) {
    const z = await prisma.zona.create({
      data: { categoriaId: cat.id, nombre: `Zona RR ${zIdx}`, formato: 'ROUND_ROBIN', clasifican: 2 },
    });
    const pZona = [];
    for (let i = 1; i <= 3; i++) {
      const p = await prisma.pareja.create({
        data: { categoriaId: cat.id, jugador1: `Z${zIdx}_1_${i}`, jugador2: `Z${zIdx}_2_${i}`, orden: orden++ },
      });
      pZona.push(p);
      await prisma.zonaPareja.create({ data: { zonaId: z.id, parejaId: p.id } });
      await prisma.slotPareja.createMany({
        data: slotsSabadoTemprano.map((slotId) => ({ parejaId: p.id, slotId })),
      });
    }
    await zonaService.generarPartidosZonaHelper(prisma, cat.id, z.id, 'ROUND_ROBIN', 3, pZona);
  }

  const zonaMB = await prisma.zona.create({
    data: { categoriaId: cat.id, nombre: 'Zona A', formato: 'MINI_BRACKET', clasifican: 3 },
  });
  const parejasMB = [];
  for (let i = 1; i <= 4; i++) {
    const pa = await prisma.pareja.create({
      data: { categoriaId: cat.id, jugador1: `MB1_${i}`, jugador2: `MB2_${i}`, orden: orden++ },
    });
    parejasMB.push(pa);
    await prisma.zonaPareja.create({ data: { zonaId: zonaMB.id, parejaId: pa.id } });
    await prisma.slotPareja.createMany({
      data: [
        { parejaId: pa.id, slotId: 'Sabado-22:30' },
        { parejaId: pa.id, slotId: 'Sabado-23:45' },
      ],
    });
  }
  await zonaService.generarPartidosZonaHelper(prisma, cat.id, zonaMB.id, 'MINI_BRACKET', 4, parejasMB);

  await zonaService.asignarHorariosAutomatico(org.id, [cat.id]);

  const antes = await prisma.partido.findMany({ where: { categoriaId: cat.id } });
  const agendadosAntes = antes.filter((p) => p.fechaHora && !p.sinHorarioAsignado).length;

  // Reducir de 2 a 1 cancha en Sábado (2026-09-05) y luego restaurar a 2 canchas
  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 1, null, '2026-09-05');
  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 2, null, '2026-09-05');

  const despues = await prisma.partido.findMany({ where: { categoriaId: cat.id } });
  const agendadosDespues = despues.filter((p) => p.fechaHora && !p.sinHorarioAsignado).length;

  registrarResultado(
    'modo_lluvia:post-restauracion',
    agendadosDespues >= agendadosAntes,
    `2 canchas->1->2 en Sábado, 1 cat, 19 parejas: agendados antes=${agendadosAntes}, después=${agendadosDespues} (P2 perdió fechaHora y cayó en refFecha Viernes)`
  );

  const zADespues = despues.filter((p) => p.zonaId === zonaMB.id);
  const p1 = zADespues.find((p) => p.posicionEnRonda === 1);
  const p2 = zADespues.find((p) => p.posicionEnRonda === 2);
  const p3 = zADespues.find((p) => p.posicionEnRonda === 3);
  const mbOk = Boolean(p3?.fechaHora && p1?.fechaHora && !p1.sinHorarioAsignado && p2?.fechaHora && !p2.sinHorarioAsignado);

  registrarResultado(
    'mini_bracket_orden_p3_p4:post-restauracion',
    mbOk,
    `2 canchas->1->2 en Sábado, 1 cat, 19 parejas: P3 tiene horario (${p3?.fechaHora?.toISOString()}) pero P2 quedó con sinHorarioAsignado=${p2?.sinHorarioAsignado}`
  );
}

/**
 * CASO 5: Reproductor mínimo de:
 * - `eliminatorias_descanso_y_post_zonas:post-inicio`
 * - `eliminatorias_descanso_y_post_zonas:post-reduccion`
 * - `eliminatorias_descanso_y_post_zonas:post-restauracion`
 *
 * Configuración mínima: 2 canchas, 1 categoría, 25 parejas (17 clasificados -> cuadro con Ronda 32).
 * - Las parejas tienen disponibilidad el sábado a las 22:00, por lo que hay partidos de zona el sábado a las 22:00.
 * - programarHorariosEliminatorias agenda Ronda 32 el sábado a las 20:45 (antes de que terminen las zonas).
 */
async function reproEliminatoriasAntesDeFinZonas(registrarResultado) {
  await limpiarDb();

  const org = await prisma.organizador.create({
    data: {
      nombre: 'Club Repro Elim 32',
      email: 'repro-elim32@padel.test',
      passwordHash: 'hash',
      cantidadCanchas: 2,
      viernesInicio: '18:00',
      viernesFin: '23:00',
      sabadoInicio: '09:00',
      sabadoFin: '23:30',
      domingoInicio: '09:00',
      domingoFin: '22:00',
    },
  });

  const torneo = await prisma.torneo.create({
    data: {
      nombre: 'Torneo Repro Elim 32',
      slug: 'torneo-repro-elim32',
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
    registrarResultado(
      `eliminatorias_descanso_y_post_zonas:${etapa}`,
      !elimAntes,
      elimAntes
        ? `2 canchas, 1 cat, 25 parejas: Ronda ${elimAntes.faseEliminatoria.ronda} empieza en ${new Date(elimAntes.fechaHora).toISOString()} antes del fin de zonas (${new Date(maxZonaEnd).toISOString()})`
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
 * TEST NUEVO (a): Pendiente de inicio de emergencia queda intacto tras reducir y restaurar.
 */
async function reproEmergenciaIntactoLluvia(registrarResultado) {
  await limpiarDb();

  const org = await prisma.organizador.create({
    data: {
      nombre: 'Club Emergencia Intacto',
      email: 'repro-emergencia-intacto@padel.test',
      passwordHash: 'hash',
      cantidadCanchas: 2,
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
      nombre: 'Torneo Emergencia Intacto',
      slug: 'torneo-emergencia-intacto',
      fecha: parseFechaLocal('2026-09-04'),
      estado: 'EN_CURSO',
      organizadorId: org.id,
    },
  });

  const cat = await prisma.categoria.create({
    data: { torneoId: torneo.id, nombre: '6ta', estado: 'EN_CURSO' },
  });

  const zonaA = await prisma.zona.create({
    data: { categoriaId: cat.id, nombre: 'Zona A', formato: 'ROUND_ROBIN', clasifican: 2 },
  });
  const zonaB = await prisma.zona.create({
    data: { categoriaId: cat.id, nombre: 'Zona B', formato: 'ROUND_ROBIN', clasifican: 2 },
  });

  const parejas = [];
  for (let i = 1; i <= 4; i++) {
    const p = await prisma.pareja.create({
      data: { categoriaId: cat.id, jugador1: `E1_${i}`, jugador2: `E2_${i}`, orden: i },
    });
    parejas.push(p);
    await prisma.zonaPareja.create({
      data: { zonaId: i <= 2 ? zonaA.id : zonaB.id, parejaId: p.id },
    });
  }

  const viernes18 = parseFechaLocal('2026-09-04');
  viernes18.setHours(18, 0, 0, 0);

  // Partido agendado en Cancha 2 el viernes
  await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      zonaId: zonaA.id,
      posicionEnRonda: 1,
      pareja1Id: parejas[0].id,
      pareja2Id: parejas[1].id,
      estado: 'PENDIENTE',
      fechaHora: viernes18,
      canchaNumero: 2,
      sinHorarioAsignado: false,
    },
  });

  // Partido pendiente de inicio de emergencia (sin horario, no está en partidosSinSlot)
  const pEmergencia = await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      zonaId: zonaB.id,
      posicionEnRonda: 1,
      pareja1Id: parejas[2].id,
      pareja2Id: parejas[3].id,
      estado: 'PENDIENTE',
      fechaHora: null,
      canchaNumero: null,
      sinHorarioAsignado: true,
    },
  });

  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 1, null, '2026-09-04');
  const postRed = await prisma.partido.findUnique({ where: { id: pEmergencia.id } });

  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 2, null, '2026-09-04');
  const postRest = await prisma.partido.findUnique({ where: { id: pEmergencia.id } });

  const intacto =
    postRed.fechaHora === null &&
    postRed.canchaNumero === null &&
    postRed.sinHorarioAsignado === true &&
    postRest.fechaHora === null &&
    postRest.canchaNumero === null &&
    postRest.sinHorarioAsignado === true;

  registrarResultado(
    'lluvia_emergencia_intacto:post-restauracion',
    intacto,
    intacto
      ? 'OK'
      : `Pendiente de emergencia fue alterado: postRed=${postRed.fechaHora}, postRest=${postRest.fechaHora}`
  );
}

/**
 * TEST NUEVO (b): Reducir 6->4 y luego 4->3 y restaurar recupera todos los partidos.
 */
async function reproReduccionEscalonada6a4a3YRestaurar(registrarResultado) {
  await limpiarDb();

  // Viernes 22:00 a 04:15 con sabadoInicio=04:15 -> dayLimitMs de Viernes = Sábado 04:15 (375 min = 5 turnos exactos de 75 min por cancha).
  // En 6 canchas entran hasta 30 partidos; en 4 canchas entran 20; en 3 canchas entran 15.
  // Con 24 zonas de 2 parejas = 24 partidos independientes:
  // - Inicio (6 canchas): 24 agendados.
  // - Reducir 6->4: 20 agendados, 4 en partidosSinSlot.
  // - Reducir 4->3: 15 agendados, 9 en partidosSinSlot (4 previos + 5 nuevos).
  // - Restaurar 3->6: 24 agendados, 0 en partidosSinSlot.
  const org = await prisma.organizador.create({
    data: {
      nombre: 'Club Escalona 6-4-3',
      email: 'repro-6-4-3@padel.test',
      passwordHash: 'hash',
      cantidadCanchas: 6,
      viernesInicio: '22:00',
      viernesFin: '04:15',
      sabadoInicio: '04:15',
      sabadoFin: '22:00',
      domingoInicio: '09:00',
      domingoFin: '22:00',
    },
  });

  const torneo = await prisma.torneo.create({
    data: {
      nombre: 'Torneo Escalona 6-4-3',
      slug: 'torneo-escalona-6-4-3',
      fecha: parseFechaLocal('2026-09-04'),
      estado: 'EN_CURSO',
      organizadorId: org.id,
    },
  });

  const cat = await prisma.categoria.create({
    data: { torneoId: torneo.id, nombre: '6ta', estado: 'EN_CURSO' },
  });

  const slotsVie = [
    'Viernes-22:00',
    'Viernes-23:15',
    'Viernes-00:30',
    'Viernes-01:45',
    'Viernes-03:00',
  ];
  let orden = 1;
  for (let zIdx = 1; zIdx <= 24; zIdx++) {
    const z = await prisma.zona.create({
      data: { categoriaId: cat.id, nombre: `Zona ${zIdx}`, formato: 'ROUND_ROBIN', clasifican: 2 },
    });
    const pZ = [];
    for (let i = 1; i <= 2; i++) {
      const p = await prisma.pareja.create({
        data: { categoriaId: cat.id, jugador1: `S${zIdx}_1_${i}`, jugador2: `S${zIdx}_2_${i}`, orden: orden++ },
      });
      pZ.push(p);
      await prisma.zonaPareja.create({ data: { zonaId: z.id, parejaId: p.id } });
      await prisma.slotPareja.createMany({
        data: slotsVie.map((slotId) => ({ parejaId: p.id, slotId })),
      });
    }
    await zonaService.generarPartidosZonaHelper(prisma, cat.id, z.id, 'ROUND_ROBIN', 2, pZ);
  }

  await zonaService.asignarHorariosAutomatico(org.id, [cat.id]);

  const inicial = await prisma.partido.findMany({ where: { categoriaId: cat.id } });
  const agendadosInicial = inicial.filter((p) => p.fechaHora && !p.sinHorarioAsignado).length;

  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 4, null, '2026-09-04');
  const ov4 = canchasOverridesService.getCanchasDia(torneo.id, '2026-09-04', 6);
  const sinSlot4Count = Object.keys(ov4.partidosSinSlot || {}).length;

  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 3, null, '2026-09-04');
  const ov3 = canchasOverridesService.getCanchasDia(torneo.id, '2026-09-04', 6);
  const sinSlot3Count = Object.keys(ov3.partidosSinSlot || {}).length;

  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 6, null, '2026-09-04');
  const finalPartidos = await prisma.partido.findMany({ where: { categoriaId: cat.id } });
  const agendadosFinal = finalPartidos.filter((p) => p.fechaHora && !p.sinHorarioAsignado).length;
  const ovRest = canchasOverridesService.getCanchasDia(torneo.id, '2026-09-04', 6);
  const sinSlotRestCount = Object.keys(ovRest.partidosSinSlot || {}).length;

  const ok =
    agendadosInicial === 24 &&
    sinSlot4Count === 4 &&
    sinSlot3Count === 9 &&
    agendadosFinal === 24 &&
    sinSlotRestCount === 0;

  registrarResultado(
    'lluvia_escalonada_6_4_3:post-restauracion',
    ok,
    ok
      ? 'OK'
      : `Esperado inicial=24, sinSlot4=4, sinSlot3=9, final=24, sinSlotRest=0; obtenido inicial=${agendadosInicial}, sinSlot4=${sinSlot4Count}, sinSlot3=${sinSlot3Count}, final=${agendadosFinal}, sinSlotRest=${sinSlotRestCount}`
  );
}

/**
 * TEST NUEVO (c): Caso cruzado — P3/P4 fijos en otra jornada y fin(P1/P2) nuevo queda mayor que su inicio -> desplazados.
 */
async function reproCasoCruzadoMiniBracketOtraJornada(registrarResultado) {
  await limpiarDb();

  const org = await prisma.organizador.create({
    data: {
      nombre: 'Club Caso Cruzado MB',
      email: 'repro-cruzado-mb@padel.test',
      passwordHash: 'hash',
      cantidadCanchas: 2,
      viernesInicio: '18:00',
      viernesFin: '22:00',
      sabadoInicio: '10:00',
      sabadoFin: '22:00',
      domingoInicio: '09:00',
      domingoFin: '22:00',
    },
  });

  const torneo = await prisma.torneo.create({
    data: {
      nombre: 'Torneo Caso Cruzado MB',
      slug: 'torneo-cruzado-mb',
      fecha: parseFechaLocal('2026-09-04'),
      estado: 'EN_CURSO',
      organizadorId: org.id,
    },
  });

  const cat = await prisma.categoria.create({
    data: { torneoId: torneo.id, nombre: '6ta', estado: 'EN_CURSO' },
  });

  const zona = await prisma.zona.create({
    data: { categoriaId: cat.id, nombre: 'Zona A', formato: 'MINI_BRACKET', clasifican: 3 },
  });

  const parejas = [];
  for (let i = 1; i <= 4; i++) {
    const p = await prisma.pareja.create({
      data: { categoriaId: cat.id, jugador1: `C1_${i}`, jugador2: `C2_${i}`, orden: i },
    });
    parejas.push(p);
    await prisma.zonaPareja.create({ data: { zonaId: zona.id, parejaId: p.id } });
  }

  // P1 y P2 en Sábado (2026-09-05) a las 10:00 (Canchas 1 y 2).
  // P3 y P4 fijos en otra jornada (Viernes 2026-09-04 a las 20:00, Canchas 1 y 2), cuyo inicio < fin(P1/P2).
  const sab10 = parseFechaLocal('2026-09-05');
  sab10.setHours(10, 0, 0, 0);
  const vie20 = parseFechaLocal('2026-09-04');
  vie20.setHours(20, 0, 0, 0);

  await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      zonaId: zona.id,
      posicionEnRonda: 1,
      pareja1Id: parejas[0].id,
      pareja2Id: parejas[3].id,
      estado: 'PENDIENTE',
      fechaHora: sab10,
      canchaNumero: 1,
      sinHorarioAsignado: false,
    },
  });

  await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      zonaId: zona.id,
      posicionEnRonda: 2,
      pareja1Id: parejas[1].id,
      pareja2Id: parejas[2].id,
      estado: 'PENDIENTE',
      fechaHora: sab10,
      canchaNumero: 2,
      sinHorarioAsignado: false,
    },
  });

  const p3 = await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      zonaId: zona.id,
      posicionEnRonda: 3,
      pareja1Id: null,
      pareja2Id: null,
      estado: 'PENDIENTE',
      fechaHora: vie20,
      canchaNumero: 1,
      sinHorarioAsignado: false,
    },
  });

  const p4 = await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      zonaId: zona.id,
      posicionEnRonda: 4,
      pareja1Id: null,
      pareja2Id: null,
      estado: 'PENDIENTE',
      fechaHora: vie20,
      canchaNumero: 2,
      sinHorarioAsignado: false,
    },
  });

  // Reducir Sábado (2026-09-05) de 2 a 1 cancha -> P1 y P2 se reprograman en Sábado (fin = 12:30 > vie20),
  // por lo que P3 y P4 (en otra jornada con inicio < fin nuevo de P1/P2) deben quedar desplazados.
  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 1, null, '2026-09-05');

  const p3Post = await prisma.partido.findUnique({ where: { id: p3.id } });
  const p4Post = await prisma.partido.findUnique({ where: { id: p4.id } });
  const ovSab = canchasOverridesService.getCanchasDia(torneo.id, '2026-09-05', 2);
  const sinSlot = ovSab.partidosSinSlot || {};

  const ok =
    p3Post.fechaHora === null &&
    p3Post.canchaNumero === null &&
    p3Post.sinHorarioAsignado === true &&
    Boolean(sinSlot[p3.id]) &&
    p4Post.fechaHora === null &&
    p4Post.canchaNumero === null &&
    p4Post.sinHorarioAsignado === true &&
    Boolean(sinSlot[p4.id]);

  registrarResultado(
    'lluvia_caso_cruzado_mb:post-reduccion',
    ok,
    ok
      ? 'OK'
      : `P3/P4 no fueron desplazados correctamente: p3.fechaHora=${p3Post.fechaHora}, p4.fechaHora=${p4Post.fechaHora}, sinSlot=${JSON.stringify(sinSlot)}`
  );
}

/**
 * TEST NUEVO (1): R1 FINALIZADO, P3/P4 ya tienen parejas definidas; al reducir canchas el mismo día,
 * P3/P4 no pueden empezar antes de max(fin P1, fin P2).
 */
async function reproMiniBracketP3P4ConParejasDefinidas(registrarResultado) {
  await limpiarDb();

  const org = await prisma.organizador.create({
    data: {
      nombre: 'Club MB P3P4 Con Parejas',
      email: 'repro-mb-p3p4-parejas@padel.test',
      passwordHash: 'hash',
      cantidadCanchas: 2,
      viernesInicio: '18:00',
      viernesFin: '23:30',
      sabadoInicio: '09:00',
      sabadoFin: '22:00',
      domingoInicio: '09:00',
      domingoFin: '22:00',
    },
  });

  const torneo = await prisma.torneo.create({
    data: {
      nombre: 'Torneo MB P3P4 Con Parejas',
      slug: 'torneo-mb-p3p4-parejas',
      fecha: parseFechaLocal('2026-09-04'),
      estado: 'EN_CURSO',
      organizadorId: org.id,
    },
  });

  const cat = await prisma.categoria.create({
    data: { torneoId: torneo.id, nombre: '6ta', estado: 'EN_CURSO' },
  });

  const zona = await prisma.zona.create({
    data: { categoriaId: cat.id, nombre: 'Zona A', formato: 'MINI_BRACKET', clasifican: 3 },
  });

  const parejas = [];
  for (let i = 1; i <= 4; i++) {
    const p = await prisma.pareja.create({
      data: { categoriaId: cat.id, jugador1: `M1_${i}`, jugador2: `M2_${i}`, orden: i },
    });
    parejas.push(p);
    await prisma.zonaPareja.create({ data: { zonaId: zona.id, parejaId: p.id } });
  }

  // P1 y P2 jugados (FINALIZADO) a las 19:15 (terminan 20:30). El turno de las 18:00 está libre.
  // P3 y P4 ya tienen parejas definidas (ganadores y perdedores de R1) y están agendados a las 20:30 en Canchas 1 y 2.
  const vie19_15 = parseFechaLocal('2026-09-04');
  vie19_15.setHours(19, 15, 0, 0);
  const vie20_30 = parseFechaLocal('2026-09-04');
  vie20_30.setHours(20, 30, 0, 0);

  await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      zonaId: zona.id,
      posicionEnRonda: 1,
      pareja1Id: parejas[0].id,
      pareja2Id: parejas[3].id,
      ganadorId: parejas[0].id,
      estado: 'FINALIZADO',
      fechaHora: vie19_15,
      canchaNumero: 1,
      sinHorarioAsignado: false,
    },
  });

  await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      zonaId: zona.id,
      posicionEnRonda: 2,
      pareja1Id: parejas[1].id,
      pareja2Id: parejas[2].id,
      ganadorId: parejas[1].id,
      estado: 'FINALIZADO',
      fechaHora: vie19_15,
      canchaNumero: 2,
      sinHorarioAsignado: false,
    },
  });

  const p3 = await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      zonaId: zona.id,
      posicionEnRonda: 3,
      pareja1Id: parejas[0].id,
      pareja2Id: parejas[1].id,
      estado: 'PENDIENTE',
      fechaHora: vie20_30,
      canchaNumero: 1,
      sinHorarioAsignado: false,
    },
  });

  const p4 = await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      zonaId: zona.id,
      posicionEnRonda: 4,
      pareja1Id: parejas[3].id,
      pareja2Id: parejas[2].id,
      estado: 'PENDIENTE',
      fechaHora: vie20_30,
      canchaNumero: 2,
      sinHorarioAsignado: false,
    },
  });

  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 1, null, '2026-09-04');

  const p3Post = await prisma.partido.findUnique({ where: { id: p3.id } });
  const p4Post = await prisma.partido.findUnique({ where: { id: p4.id } });
  const minAllowedMs = vie19_15.getTime() + DURACION_MS; // 20:30

  const p3StartMs = p3Post.fechaHora ? new Date(p3Post.fechaHora).getTime() : 0;
  const p4StartMs = p4Post.fechaHora ? new Date(p4Post.fechaHora).getTime() : 0;
  const ok = p3StartMs >= minAllowedMs && p4StartMs >= minAllowedMs;

  registrarResultado(
    'lluvia_mb_p3_p4_con_parejas:post-reduccion',
    ok,
    ok
      ? 'OK'
      : `P3 (${p3Post.fechaHora?.toISOString()}) o P4 (${p4Post.fechaHora?.toISOString()}) empezó antes del fin de R1 (${new Date(minAllowedMs).toISOString()})`
  );
}

/**
 * TEST NUEVO (2): Caso cruzado en reducción y restauración de viernes:
 * - P1 pierde horario el viernes al reducir canchas (queda en partidosSinSlot de viernes), mientras P3/P4 están en sábado.
 * - Al restaurar el viernes, P1 recupera horario y como max(fin P1, fin P2) queda después del inicio de P3/P4 en sábado,
 *   P3 y P4 se desplazan.
 */
async function reproRestaurarViernesDesplazaP3P4Sabado(registrarResultado) {
  await limpiarDb();

  // Viernes 22:00 a 01:45 con sabadoInicio=01:45 -> dayLimitMs de Viernes = Sábado 01:45 (3 slots de 75m por cancha: 22:00, 23:15, 00:30).
  const org = await prisma.organizador.create({
    data: {
      nombre: 'Club Restaurar Viernes Cruzado',
      email: 'repro-restaurar-viernes-cruzado@padel.test',
      passwordHash: 'hash',
      cantidadCanchas: 2,
      viernesInicio: '22:00',
      viernesFin: '01:45',
      sabadoInicio: '01:45',
      sabadoFin: '22:00',
      domingoInicio: '09:00',
      domingoFin: '22:00',
    },
  });

  const torneo = await prisma.torneo.create({
    data: {
      nombre: 'Torneo Restaurar Viernes Cruzado',
      slug: 'torneo-restaurar-viernes-cruzado',
      fecha: parseFechaLocal('2026-09-04'),
      estado: 'EN_CURSO',
      organizadorId: org.id,
    },
  });

  const cat = await prisma.categoria.create({
    data: { torneoId: torneo.id, nombre: '6ta', estado: 'EN_CURSO' },
  });

  const zonaFija = await prisma.zona.create({
    data: { categoriaId: cat.id, nombre: 'Zona Fija', formato: 'ROUND_ROBIN', clasifican: 2 },
  });
  const zonaMB = await prisma.zona.create({
    data: { categoriaId: cat.id, nombre: 'Zona MB', formato: 'MINI_BRACKET', clasifican: 3 },
  });

  const parejasFijas = [];
  for (let i = 1; i <= 6; i++) {
    const p = await prisma.pareja.create({
      data: { categoriaId: cat.id, jugador1: `F1_${i}`, jugador2: `F2_${i}`, orden: i },
    });
    parejasFijas.push(p);
    await prisma.zonaPareja.create({ data: { zonaId: zonaFija.id, parejaId: p.id } });
  }

  const parejasMB = [];
  for (let i = 1; i <= 4; i++) {
    const p = await prisma.pareja.create({
      data: { categoriaId: cat.id, jugador1: `MB1_${i}`, jugador2: `MB2_${i}`, orden: 10 + i },
    });
    parejasMB.push(p);
    await prisma.zonaPareja.create({ data: { zonaId: zonaMB.id, parejaId: p.id } });
  }

  // Ocupar los 3 turnos de Cancha 1 el Viernes (22:00, 23:15, 00:30) con partidos FINALIZADO
  const turnosVie = [
    new Date(2026, 8, 4, 22, 0, 0, 0),
    new Date(2026, 8, 4, 23, 15, 0, 0),
    new Date(2026, 8, 5, 0, 30, 0, 0),
  ];
  for (let idx = 0; idx < 3; idx++) {
    await prisma.partido.create({
      data: {
        categoriaId: cat.id,
        zonaId: zonaFija.id,
        posicionEnRonda: idx + 1,
        pareja1Id: parejasFijas[idx * 2].id,
        pareja2Id: parejasFijas[idx * 2 + 1].id,
        ganadorId: parejasFijas[idx * 2].id,
        estado: 'FINALIZADO',
        fechaHora: turnosVie[idx],
        canchaNumero: 1,
        sinHorarioAsignado: false,
      },
    });
  }

  // P1 y P2 en Viernes (22:00 y 23:15) Cancha 2 (PENDIENTE).
  // Al reducir Viernes a 1 cancha, ambos pierden horario y entran a partidosSinSlot de Viernes,
  // mientras P3 y P4 siguen en Sábado 10:00.
  const vie22 = new Date(2026, 8, 4, 22, 0, 0, 0);
  const vie23_15 = new Date(2026, 8, 4, 23, 15, 0, 0);
  const sab10 = new Date(2026, 8, 5, 10, 0, 0, 0);
  const sab12 = new Date(2026, 8, 5, 12, 0, 0, 0);

  const p1 = await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      zonaId: zonaMB.id,
      posicionEnRonda: 1,
      pareja1Id: parejasMB[0].id,
      pareja2Id: parejasMB[3].id,
      estado: 'PENDIENTE',
      fechaHora: vie22,
      canchaNumero: 2,
      sinHorarioAsignado: false,
    },
  });

  const p2 = await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      zonaId: zonaMB.id,
      posicionEnRonda: 2,
      pareja1Id: parejasMB[1].id,
      pareja2Id: parejasMB[2].id,
      estado: 'PENDIENTE',
      fechaHora: vie23_15,
      canchaNumero: 2,
      sinHorarioAsignado: false,
    },
  });

  const p3 = await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      zonaId: zonaMB.id,
      posicionEnRonda: 3,
      pareja1Id: null,
      pareja2Id: null,
      estado: 'PENDIENTE',
      fechaHora: sab10,
      canchaNumero: 1,
      sinHorarioAsignado: false,
    },
  });

  const p4 = await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      zonaId: zonaMB.id,
      posicionEnRonda: 4,
      pareja1Id: null,
      pareja2Id: null,
      estado: 'PENDIENTE',
      fechaHora: sab10,
      canchaNumero: 2,
      sinHorarioAsignado: false,
    },
  });

  // 1) Reducir Viernes (2026-09-04) a 1 cancha -> P1 y P2 quedan en partidosSinSlot de Viernes, P3/P4 siguen en Sábado 10:00
  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 1, null, '2026-09-04');
  const p1Red = await prisma.partido.findUnique({ where: { id: p1.id } });
  const p2Red = await prisma.partido.findUnique({ where: { id: p2.id } });
  const p3Red = await prisma.partido.findUnique({ where: { id: p3.id } });
  const p4Red = await prisma.partido.findUnique({ where: { id: p4.id } });
  const ovVieRed = canchasOverridesService.getCanchasDia(torneo.id, '2026-09-04', 2);

  const okReduccion =
    p1Red.fechaHora === null &&
    p2Red.fechaHora === null &&
    Boolean(ovVieRed.partidosSinSlot?.[p1.id]) &&
    Boolean(ovVieRed.partidosSinSlot?.[p2.id]) &&
    p3Red.fechaHora !== null &&
    !p3Red.sinHorarioAsignado &&
    p4Red.fechaHora !== null &&
    !p4Red.sinHorarioAsignado;

  // Reubicar P2 en Sábado 12:00 (fin 13:15 > Sábado 10:00) antes de restaurar Viernes
  await prisma.partido.update({
    where: { id: p2.id },
    data: { fechaHora: sab12, canchaNumero: 1, sinHorarioAsignado: false },
  });

  // 2) Restaurar Viernes (2026-09-04) a 2 canchas -> P1 recupera horario en Viernes y como max(fin P1, fin P2) > inicio(P3/P4), P3 y P4 se desplazan
  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 2, null, '2026-09-04');
  const p1Rest = await prisma.partido.findUnique({ where: { id: p1.id } });
  const p3Rest = await prisma.partido.findUnique({ where: { id: p3.id } });
  const p4Rest = await prisma.partido.findUnique({ where: { id: p4.id } });

  const okRestauracion =
    p1Rest.fechaHora !== null &&
    !p1Rest.sinHorarioAsignado &&
    p3Rest.fechaHora === null &&
    p3Rest.canchaNumero === null &&
    p3Rest.sinHorarioAsignado === true &&
    p4Rest.fechaHora === null &&
    p4Rest.canchaNumero === null &&
    p4Rest.sinHorarioAsignado === true;

  registrarResultado(
    'lluvia_restaurar_viernes_desplaza_p3_p4_sabado:post-restauracion',
    okReduccion && okRestauracion,
    okReduccion && okRestauracion
      ? 'OK'
      : `okReduccion=${okReduccion}, okRestauracion=${okRestauracion} (p1Rest=${p1Rest.fechaHora}, p3Rest=${p3Rest.fechaHora}, p4Rest=${p4Rest.fechaHora})`
  );
}

/**
 * TEST NUEVO (4): Restauración sin diaKey con partidos desplazados en múltiples días:
 * - Se generan desplazados en Viernes y en Sábado en sendos overrides.
 * - Se llama a reprogramarPorReduccionCanchas(org.id, torneo.id, null) sin diaKey.
 * - Se inspecciona qué pasa con los desplazados de cada jornada.
 */
async function reproRestauracionSinDiaKeyMultiDia(registrarResultado) {
  await limpiarDb();

  // Club con 2 canchas:
  // Viernes 22:00 a 01:45 (dayLimitMs = Sábado 01:45) -> 3 slots por cancha (22:00, 23:15, 00:30)
  // Sábado 01:45 a 05:30 (dayLimitMs = Domingo 05:30) -> 3 slots por cancha (01:45, 03:00, 04:15)
  const org = await prisma.organizador.create({
    data: {
      nombre: 'Club MultiDia Sin DiaKey',
      email: 'repro-sin-diakey-multidia@padel.test',
      passwordHash: 'hash',
      cantidadCanchas: 2,
      viernesInicio: '22:00',
      viernesFin: '01:45',
      sabadoInicio: '01:45',
      sabadoFin: '05:30',
      domingoInicio: '05:30',
      domingoFin: '22:00',
    },
  });

  const torneo = await prisma.torneo.create({
    data: {
      nombre: 'Torneo MultiDia Sin DiaKey',
      slug: 'torneo-sin-diakey-multidia',
      fecha: parseFechaLocal('2026-09-04'),
      estado: 'EN_CURSO',
      organizadorId: org.id,
    },
  });

  const cat = await prisma.categoria.create({
    data: { torneoId: torneo.id, nombre: '6ta', estado: 'EN_CURSO' },
  });

  const zonaVie = await prisma.zona.create({
    data: { categoriaId: cat.id, nombre: 'Zona Vie', formato: 'ROUND_ROBIN', clasifican: 2 },
  });
  const zonaSab = await prisma.zona.create({
    data: { categoriaId: cat.id, nombre: 'Zona Sab', formato: 'ROUND_ROBIN', clasifican: 2 },
  });

  const parejas = [];
  for (let i = 1; i <= 16; i++) {
    const p = await prisma.pareja.create({
      data: { categoriaId: cat.id, jugador1: `J1_${i}`, jugador2: `J2_${i}`, orden: i },
    });
    parejas.push(p);
  }

  // Ocupar los 3 turnos de Cancha 1 el Viernes con FINALIZADO (22:00, 23:15, 00:30)
  const turnosVie = [
    new Date(2026, 8, 4, 22, 0, 0, 0),
    new Date(2026, 8, 4, 23, 15, 0, 0),
    new Date(2026, 8, 5, 0, 30, 0, 0),
  ];
  for (let idx = 0; idx < 3; idx++) {
    await prisma.partido.create({
      data: {
        categoriaId: cat.id,
        zonaId: zonaVie.id,
        posicionEnRonda: idx + 1,
        pareja1Id: parejas[idx * 2].id,
        pareja2Id: parejas[idx * 2 + 1].id,
        ganadorId: parejas[idx * 2].id,
        estado: 'FINALIZADO',
        fechaHora: turnosVie[idx],
        canchaNumero: 1,
        sinHorarioAsignado: false,
      },
    });
  }

  // PENDIENTES en Cancha 2 Viernes (22:00 y 23:15)
  const pViePend1 = await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      zonaId: zonaVie.id,
      posicionEnRonda: 4,
      pareja1Id: parejas[6].id,
      pareja2Id: parejas[7].id,
      estado: 'PENDIENTE',
      fechaHora: turnosVie[0],
      canchaNumero: 2,
      sinHorarioAsignado: false,
    },
  });
  const pViePend2 = await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      zonaId: zonaVie.id,
      posicionEnRonda: 5,
      pareja1Id: parejas[0].id,
      pareja2Id: parejas[7].id,
      estado: 'PENDIENTE',
      fechaHora: turnosVie[1],
      canchaNumero: 2,
      sinHorarioAsignado: false,
    },
  });

  // Ocupar los 3 turnos de Cancha 1 el Sábado con FINALIZADO (01:45, 03:00, 04:15)
  const turnosSab = [
    new Date(2026, 8, 5, 1, 45, 0, 0),
    new Date(2026, 8, 5, 3, 0, 0, 0),
    new Date(2026, 8, 5, 4, 15, 0, 0),
  ];
  for (let idx = 0; idx < 3; idx++) {
    await prisma.partido.create({
      data: {
        categoriaId: cat.id,
        zonaId: zonaSab.id,
        posicionEnRonda: idx + 1,
        pareja1Id: parejas[8 + idx * 2].id,
        pareja2Id: parejas[8 + idx * 2 + 1].id,
        ganadorId: parejas[8 + idx * 2].id,
        estado: 'FINALIZADO',
        fechaHora: turnosSab[idx],
        canchaNumero: 1,
        sinHorarioAsignado: false,
      },
    });
  }

  // PENDIENTES en Cancha 2 Sábado (01:45 y 03:00)
  const pSabPend1 = await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      zonaId: zonaSab.id,
      posicionEnRonda: 4,
      pareja1Id: parejas[14].id,
      pareja2Id: parejas[15].id,
      estado: 'PENDIENTE',
      fechaHora: turnosSab[0],
      canchaNumero: 2,
      sinHorarioAsignado: false,
    },
  });
  const pSabPend2 = await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      zonaId: zonaSab.id,
      posicionEnRonda: 5,
      pareja1Id: parejas[8].id,
      pareja2Id: parejas[15].id,
      estado: 'PENDIENTE',
      fechaHora: turnosSab[1],
      canchaNumero: 2,
      sinHorarioAsignado: false,
    },
  });

  // 1. Reducir Viernes (2026-09-04) a 1 cancha -> Cancha 1 llena, pViePend1 y pViePend2 entran a partidosSinSlot de Viernes
  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 1, null, '2026-09-04');
  const ovVie = canchasOverridesService.getCanchasDia(torneo.id, '2026-09-04', 2);
  const desplazadosVieIds = Object.keys(ovVie.partidosSinSlot || {});

  // 2. Override en Sábado (2026-09-05) a 1 cancha con 2 partidos desplazados en partidosSinSlot
  await prisma.partido.update({
    where: { id: pSabPend1.id },
    data: { fechaHora: null, canchaNumero: null, sinHorarioAsignado: true },
  });
  await prisma.partido.update({
    where: { id: pSabPend2.id },
    data: { fechaHora: null, canchaNumero: null, sinHorarioAsignado: true },
  });
  await canchasOverridesService.setOverrideDia(
    torneo.id,
    '2026-09-05',
    1,
    turnosSab[0],
    {
      [pSabPend1.id]: 'Sin cancha activa libre disponible en ese horario',
      [pSabPend2.id]: 'Sin cancha activa libre disponible en ese horario',
    }
  );
  await prisma.torneo.update({
    where: { id: torneo.id },
    data: { overrideActivoDesde: turnosSab[0], canchasDisponiblesOverride: 1 },
  });
  const ovSab = canchasOverridesService.getCanchasDia(torneo.id, '2026-09-05', 2);
  const desplazadosSabIds = Object.keys(ovSab.partidosSinSlot || {});

  console.log(`[MultiDia Test] Desplazados Viernes: ${desplazadosVieIds.length}, Desplazados Sábado: ${desplazadosSabIds.length}`);

  // 3. Restaurar sin diaKey (ruta legacy / general):
  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, null);

  // 4. Analizar estado de los partidos desplazados de cada jornada tras la restauración sin diaKey:
  const partidosViePost = await prisma.partido.findMany({ where: { id: { in: desplazadosVieIds } } });
  const partidosSabPost = await prisma.partido.findMany({ where: { id: { in: desplazadosSabIds } } });

  const vieRecuperados = partidosViePost.filter((p) => p.fechaHora !== null && !p.sinHorarioAsignado).length;
  const sabRecuperados = partidosSabPost.filter((p) => p.fechaHora !== null && !p.sinHorarioAsignado).length;

  const overridesRestantes = await prisma.overrideCanchasDia.findMany({ where: { torneoId: torneo.id } });

  console.log(`[MultiDia Test] Tras restaurar sin diaKey:`);
  console.log(`  - Viernes recuperados: ${vieRecuperados}/${desplazadosVieIds.length}`);
  console.log(`  - Sábado recuperados: ${sabRecuperados}/${desplazadosSabIds.length}`);
  console.log(`  - Overrides restantes en DB: ${overridesRestantes.length}`);

  const todosRecuperados = vieRecuperados === desplazadosVieIds.length && sabRecuperados === desplazadosSabIds.length;

  registrarResultado(
    'lluvia_restauracion_sin_diakey_multidia:post-restauracion',
    todosRecuperados,
    todosRecuperados
      ? 'OK'
      : `PERDIDA_PARTIDOS: vieRecuperados=${vieRecuperados}/${desplazadosVieIds.length}, sabRecuperados=${sabRecuperados}/${desplazadosSabIds.length}, overridesRestantes=${overridesRestantes.length}`
  );
}

async function runAllRepros() {
  await ensureTestDb();
  resetTestDb();
  await canchasOverridesService.loadFromDb();

  console.log('='.repeat(85));
  console.log('🔬 REPRODUCTORES DETERMINÍSTICOS MÍNIMOS (SIN PRNG)');
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
    await reproModoLluviaMiniBracketYColisiones(registrarResultado);
    await reproSabadoRestauracionPerdidaYMiniBracket(registrarResultado);
    await reproEliminatoriasAntesDeFinZonas(registrarResultado);
    await reproEmergenciaIntactoLluvia(registrarResultado);
    await reproReduccionEscalonada6a4a3YRestaurar(registrarResultado);
    await reproCasoCruzadoMiniBracketOtraJornada(registrarResultado);
    await reproMiniBracketP3P4ConParejasDefinidas(registrarResultado);
    await reproRestaurarViernesDesplazaP3P4Sabado(registrarResultado);
    await reproRestauracionSinDiaKeyMultiDia(registrarResultado);
  } finally {
    await limpiarDb();
    await prisma.$disconnect();
  }

  console.table(
    resultados.map(({ invariante, etapa, estado }) => ({ invariante, etapa, estado }))
  );

  let fallas = 0;
  for (const r of resultados) {
    if (r.estado === 'FAIL') {
      fallas++;
      console.error(`❌ [${r.invariante}:${r.etapa}] -> ${r.detalle}`);
    }
  }

  if (fallas > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runAllRepros().catch((err) => {
    console.error('❌ Error fatal:', err);
    process.exit(1);
  });
}

module.exports = { runAllRepros };
