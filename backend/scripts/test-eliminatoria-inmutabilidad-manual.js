'use strict';

/**
 * test-eliminatoria-inmutabilidad-manual.js
 *
 * Suite oficial de invariantes de cruces manuales en eliminatorias:
 * 1. R32 con horario manual no es pisado al re-ejecutar programarHorariosEliminatorias.
 * 2. R32 con horario manual no es pisado tras reducción por lluvia y restauración de canchas.
 * 3. Cruce manual en cancha activa en domingo sobrevive a la reducción por lluvia.
 * 4. (a) Cruce manual en cancha CERRADA por lluvia en domingo se reubica, pierde la marca y aparece en cambios.
 * 5. (b) Cruces automáticos siguen adelantándose (compactación) al restaurar canchas.
 * 6. (c) Ciclo de vida de la marca horarioManual (true en asignación manual, false al quitar horario y en sincronizarCuadro).
 */

require('./utils/testEnvGuard');
const { ensureTestDb } = require('./utils/testEnvGuard');
const { resetTestDb } = require('./reset-test-db');
const prisma = require('../src/lib/prisma');
const zonaService = require('../src/services/zona.service');
const { parseFechaLocal } = require('../src/utils/dateUtils');
const { generarEliminatoria, sincronizarCuadro } = require('../src/services/faseEliminatoria.service');
const { programarHorariosEliminatorias } = require('../src/services/eliminatoriaScheduler.service');
const organizadorService = require('../src/services/organizador.service');
const partidoService = require('../src/services/partido.service');
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

/**
 * CASO 1: Cruce R32 manual no es pisado al re-ejecutar programarHorariosEliminatorias
 */
async function testR32ManualPostScheduler() {
  await limpiarDb();

  const org = await prisma.organizador.create({
    data: {
      nombre: 'Club Test R32 Post Scheduler',
      email: 'r32-post-scheduler@padel.test',
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
      nombre: 'Torneo Test R32 Post Scheduler',
      slug: 'torneo-r32-post-scheduler',
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

  // Asignar todas las zonas el viernes
  const baseFriday = zonaService.proximaFechaPorDia('Viernes', parseFechaLocal('2026-09-04'));
  const partidosZona = await prisma.partido.findMany({
    where: { categoriaId: cat.id, zonaId: { not: null } },
  });
  for (const pz of partidosZona) {
    await prisma.partido.update({
      where: { id: pz.id },
      data: {
        fechaHora: new Date(baseFriday.getTime() + 18 * 60 * 60 * 1000),
        canchaNumero: 1,
        sinHorarioAsignado: false,
      },
    });
  }

  const partidoR32 = await prisma.partido.findFirst({
    where: {
      categoriaId: cat.id,
      faseEliminatoria: { ronda: { gte: 32 } },
      esBye: false,
    },
  });

  const baseSaturday = zonaService.proximaFechaPorDia('Sabado', parseFechaLocal('2026-09-04'));
  const horaManual = new Date(baseSaturday.getTime() + (22 * 60 + 30) * 60 * 1000);
  const canchaManual = 2;

  await partidoService.asignarHorarioManual(org.id, partidoR32.id, {
    fechaHora: horaManual,
    canchaNumero: canchaManual,
  });

  // Re-ejecutar scheduler
  await programarHorariosEliminatorias(org.id, torneo.id);

  const despues = await prisma.partido.findUnique({ where: { id: partidoR32.id } });
  const horaCoincide = despues.fechaHora && new Date(despues.fechaHora).getTime() === horaManual.getTime();
  const canchaCoincide = despues.canchaNumero === canchaManual;
  const manualCoincide = despues.horarioManual === true;

  if (!horaCoincide || !canchaCoincide || !manualCoincide) {
    throw new Error(
      `Caso 1 Falló: R32 manual sobreescrito o perdió marca. esperado ${horaManual.toISOString()} C${canchaManual} manual:true, recibido ${despues.fechaHora ? new Date(despues.fechaHora).toISOString() : null} C${despues.canchaNumero} manual:${despues.horarioManual}`
    );
  }

  console.log('✅ Caso 1 PASS: R32 manual conservó horario, cancha y horarioManual:true tras programarHorariosEliminatorias.');
}

/**
 * CASO 2: Cruce R32 manual no es pisado tras reducción por lluvia y restauración de canchas
 */
async function testR32ManualPostRestauracion() {
  await limpiarDb();

  const org = await prisma.organizador.create({
    data: {
      nombre: 'Club Test R32 Restauracion',
      email: 'r32-restauracion@padel.test',
      passwordHash: 'hash',
      cantidadCanchas: 4,
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
      nombre: 'Torneo Test R32 Restauracion',
      slug: 'torneo-r32-restauracion',
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

  const baseFriday = zonaService.proximaFechaPorDia('Viernes', parseFechaLocal('2026-09-04'));
  const partidosZona = await prisma.partido.findMany({
    where: { categoriaId: cat.id, zonaId: { not: null } },
  });
  for (const pz of partidosZona) {
    await prisma.partido.update({
      where: { id: pz.id },
      data: {
        fechaHora: new Date(baseFriday.getTime() + 18 * 60 * 60 * 1000),
        canchaNumero: 1,
        sinHorarioAsignado: false,
      },
    });
  }

  const partidoR32 = await prisma.partido.findFirst({
    where: {
      categoriaId: cat.id,
      faseEliminatoria: { ronda: { gte: 32 } },
      esBye: false,
    },
  });

  const baseSaturday = zonaService.proximaFechaPorDia('Sabado', parseFechaLocal('2026-09-04'));
  const horaManual = new Date(baseSaturday.getTime() + (22 * 60 + 30) * 60 * 1000);
  const canchaManual = 3;

  await partidoService.asignarHorarioManual(org.id, partidoR32.id, {
    fechaHora: horaManual,
    canchaNumero: canchaManual,
  });

  const baseSunday = zonaService.proximaFechaPorDia('Domingo', parseFechaLocal('2026-09-04'));
  await canchasOverridesService.setOverrideDia(torneo.id, '2026-09-06', 2, baseSunday);
  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 4, null, null);

  const despues = await prisma.partido.findUnique({ where: { id: partidoR32.id } });
  const horaCoincide = despues.fechaHora && new Date(despues.fechaHora).getTime() === horaManual.getTime();
  const canchaCoincide = despues.canchaNumero === canchaManual;
  const manualCoincide = despues.horarioManual === true;

  if (!horaCoincide || !canchaCoincide || !manualCoincide) {
    throw new Error(
      `Caso 2 Falló: R32 manual sobreescrito tras restauración. esperado ${horaManual.toISOString()} C${canchaManual} manual:true, recibido ${despues.fechaHora ? new Date(despues.fechaHora).toISOString() : null} C${despues.canchaNumero} manual:${despues.horarioManual}`
    );
  }

  console.log('✅ Caso 2 PASS: R32 manual conservó horario y cancha tras reducción y restauración de canchas.');
}

/**
 * CASO 3: Cruce manual en cancha activa en domingo sobrevive a la reducción por lluvia
 */
async function testEliminatoriaManualLluviaCanchaActiva() {
  await limpiarDb();

  const org = await prisma.organizador.create({
    data: {
      nombre: 'Club Test Cancha Activa',
      email: 'cancha-activa@padel.test',
      passwordHash: 'hash',
      cantidadCanchas: 4,
      viernesInicio: '15:00',
      viernesFin: '23:00',
      sabadoInicio: '09:00',
      sabadoFin: '24:00',
      domingoInicio: '08:00',
      domingoFin: '22:00',
    },
  });

  const torneo = await prisma.torneo.create({
    data: {
      nombre: 'Torneo Test Cancha Activa',
      slug: 'torneo-cancha-activa',
      fecha: parseFechaLocal('2026-09-04'),
      estado: 'BORRADOR',
      organizadorId: org.id,
    },
  });

  const cat = await prisma.categoria.create({
    data: { torneoId: torneo.id, nombre: '5ta', estado: 'BORRADOR' },
  });

  for (let i = 1; i <= 24; i++) {
    await prisma.pareja.create({
      data: { categoriaId: cat.id, jugador1: `J1_${i}`, jugador2: `J2_${i}`, orden: i },
    });
  }

  await zonaService.iniciarCategoria(org.id, cat.id);
  await prisma.torneo.update({ where: { id: torneo.id }, data: { estado: 'EN_CURSO' } });
  await generarEliminatoria(org.id, cat.id);
  await programarHorariosEliminatorias(org.id, torneo.id);

  const partidosOctavos = await prisma.partido.findMany({
    where: {
      categoriaId: cat.id,
      faseEliminatoria: { ronda: 16 },
      esBye: false,
    },
    orderBy: { posicionEnRonda: 'asc' },
  });

  const pActiva = partidosOctavos[0];
  const baseSunday = zonaService.proximaFechaPorDia('Domingo', parseFechaLocal('2026-09-04'));
  const horaManual = new Date(baseSunday.getTime() + (10 * 60 + 30) * 60 * 1000);

  await partidoService.asignarHorarioManual(org.id, pActiva.id, {
    fechaHora: horaManual,
    canchaNumero: 1,
  });

  // Reducción por lluvia en Domingo a 2 canchas (Cancha 1 sigue activa)
  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 2, null, '2026-09-06');

  const despues = await prisma.partido.findUnique({ where: { id: pActiva.id } });
  const activaSobrevive =
    despues.fechaHora &&
    new Date(despues.fechaHora).getTime() === horaManual.getTime() &&
    despues.canchaNumero === 1 &&
    despues.horarioManual === true;

  if (!activaSobrevive) {
    throw new Error(
      `Caso 3 Falló: Cruce manual en cancha activa fue alterado. esperado ${horaManual.toISOString()} C1 manual:true, recibido ${despues.fechaHora ? new Date(despues.fechaHora).toISOString() : null} C${despues.canchaNumero} manual:${despues.horarioManual}`
    );
  }

  console.log('✅ Caso 3 PASS: Cruce manual en cancha activa sobrevive a la reducción y mantiene horarioManual:true.');
}

/**
 * CASO 4: (a) Cruce manual en cancha CERRADA por lluvia en domingo se reubica,
 * pierde la marca y aparece en reprogramacion.cambios
 */
async function testEliminatoriaManualLluviaCanchaCerradaReubicadaYPierdeMarca() {
  await limpiarDb();

  const org = await prisma.organizador.create({
    data: {
      nombre: 'Club Test Cancha Cerrada',
      email: 'cancha-cerrada@padel.test',
      passwordHash: 'hash',
      cantidadCanchas: 4,
      viernesInicio: '15:00',
      viernesFin: '23:00',
      sabadoInicio: '09:00',
      sabadoFin: '24:00',
      domingoInicio: '08:00',
      domingoFin: '22:00',
    },
  });

  const torneo = await prisma.torneo.create({
    data: {
      nombre: 'Torneo Test Cancha Cerrada',
      slug: 'torneo-cancha-cerrada',
      fecha: parseFechaLocal('2026-09-04'),
      estado: 'BORRADOR',
      organizadorId: org.id,
    },
  });

  const cat = await prisma.categoria.create({
    data: { torneoId: torneo.id, nombre: '5ta', estado: 'BORRADOR' },
  });

  for (let i = 1; i <= 24; i++) {
    await prisma.pareja.create({
      data: { categoriaId: cat.id, jugador1: `J1_${i}`, jugador2: `J2_${i}`, orden: i },
    });
  }

  await zonaService.iniciarCategoria(org.id, cat.id);
  await prisma.torneo.update({ where: { id: torneo.id }, data: { estado: 'EN_CURSO' } });
  await generarEliminatoria(org.id, cat.id);
  await programarHorariosEliminatorias(org.id, torneo.id);

  const partidosOctavos = await prisma.partido.findMany({
    where: {
      categoriaId: cat.id,
      faseEliminatoria: { ronda: 16 },
      esBye: false,
    },
    orderBy: { posicionEnRonda: 'asc' },
  });

  const pCerrada = partidosOctavos[1];
  const baseSunday = zonaService.proximaFechaPorDia('Domingo', parseFechaLocal('2026-09-04'));
  const horaManual = new Date(baseSunday.getTime() + (10 * 60 + 30) * 60 * 1000);

  // Asignar en Cancha 4 (que cerrará cuando reduzcamos a 2 canchas)
  await partidoService.asignarHorarioManual(org.id, pCerrada.id, {
    fechaHora: horaManual,
    canchaNumero: 4,
  });

  const antes = await prisma.partido.findUnique({ where: { id: pCerrada.id } });
  if (antes.horarioManual !== true || antes.canchaNumero !== 4) {
    throw new Error('Fallo en setup: el partido no quedó configurado en C4 manual.');
  }

  // Reducción por lluvia en Domingo a 2 canchas
  const reprogResult = await organizadorService.reprogramarPorReduccionCanchas(
    org.id,
    torneo.id,
    2,
    null,
    '2026-09-06'
  );

  const despues = await prisma.partido.findUnique({ where: { id: pCerrada.id } });

  // Verificar que la cancha ya no es 4 (fue reubicado en cancha activa <= 2 o quedó sin horario)
  const canchaReubicada = despues.canchaNumero !== 4 && (despues.canchaNumero === null || despues.canchaNumero <= 2);
  // Verificar que perdió la marca horarioManual
  const marcaLimpia = despues.horarioManual === false;
  // Verificar que aparece en cambios del resultado
  const cambios = reprogResult?.reprogramacion?.cambios || [];
  const cambioCerrada = cambios.find((c) => c.partidoId === pCerrada.id);

  if (!canchaReubicada) {
    throw new Error(`Caso 4 Falló: cruce en cancha cerrada no fue reubicado, permanece en C${despues.canchaNumero}`);
  }
  if (!marcaLimpia) {
    throw new Error(`Caso 4 Falló: cruce reubicado debe tener horarioManual: false, recibido: ${despues.horarioManual}`);
  }
  if (!cambioCerrada) {
    throw new Error(`Caso 4 Falló: cruce reubicado debe aparecer en reprogramacion.cambios, pero no se encontró en lista de ${cambios.length} cambios.`);
  }

  if (cambioCerrada.antes.canchaNumero !== 4) {
    throw new Error(`Caso 4 Falló: cambioCerrada.antes.canchaNumero debe ser 4, recibido: ${cambioCerrada.antes.canchaNumero}`);
  }

  console.log('✅ Caso 4 PASS: Cruce en cancha cerrada se reubica, pierde horarioManual (pasa a false) y aparece en cambios.');
}

/**
 * CASO 5: (b) Cruces automáticos siguen adelantándose (compactación) al restaurar canchas
 */
async function testEliminatoriaAutomaticaCompactacionRestauracion() {
  await limpiarDb();

  const org = await prisma.organizador.create({
    data: {
      nombre: 'Club Test Compactacion',
      email: 'compactacion@padel.test',
      passwordHash: 'hash',
      cantidadCanchas: 4,
      viernesInicio: '15:00',
      viernesFin: '23:00',
      sabadoInicio: '09:00',
      sabadoFin: '24:00',
      domingoInicio: '08:00',
      domingoFin: '22:00',
    },
  });

  const torneo = await prisma.torneo.create({
    data: {
      nombre: 'Torneo Test Compactacion',
      slug: 'torneo-compactacion',
      fecha: parseFechaLocal('2026-09-04'),
      estado: 'BORRADOR',
      organizadorId: org.id,
    },
  });

  const cat = await prisma.categoria.create({
    data: { torneoId: torneo.id, nombre: '4ta', estado: 'BORRADOR' },
  });

  // 16 parejas -> Octavos (8 partidos) y Cuartos (4 partidos)
  for (let i = 1; i <= 16; i++) {
    await prisma.pareja.create({
      data: { categoriaId: cat.id, jugador1: `J1_${i}`, jugador2: `J2_${i}`, orden: i },
    });
  }

  await zonaService.iniciarCategoria(org.id, cat.id);
  await prisma.torneo.update({ where: { id: torneo.id }, data: { estado: 'EN_CURSO' } });
  await generarEliminatoria(org.id, cat.id);

  // Reducir domingo a 2 canchas: con 2 canchas los turnos se reparten en 2 canchas
  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 2, null, '2026-09-06');

  const todosConLluvia = await prisma.partido.findMany({
    where: { categoriaId: cat.id, faseEliminatoriaId: { not: null }, esBye: false },
    select: { id: true, fechaHora: true, canchaNumero: true, horarioManual: true, faseEliminatoria: { select: { ronda: true } } },
    orderBy: [{ faseEliminatoria: { ronda: 'desc' } }, { fechaHora: 'asc' }],
  });

  // Restaurar a 4 canchas: los turnos se compactan hacia adelante gracias a más canchas disponibles
  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 4, null, '2026-09-06');

  const todosRestaurados = await prisma.partido.findMany({
    where: { categoriaId: cat.id, faseEliminatoriaId: { not: null }, esBye: false },
    select: { id: true, fechaHora: true, canchaNumero: true, horarioManual: true, faseEliminatoria: { select: { ronda: true } } },
    orderBy: [{ faseEliminatoria: { ronda: 'desc' } }, { fechaHora: 'asc' }],
  });

  // Verificar que los partidos postergados por reducción de canchas se adelantan (compactación) al restaurar
  // 1. En Octavos: el 3er partido estaba a las 12:15 UTC con lluvia y se adelanta a las 11:00 UTC al restaurar
  const octavosTardioConLluvia = todosConLluvia[2];
  const octavosTardioRestaurado = todosRestaurados.find((p) => p.id === octavosTardioConLluvia.id);
  const horaOctavosLluvia = new Date(octavosTardioConLluvia.fechaHora).getTime();
  const horaOctavosRestaurado = new Date(octavosTardioRestaurado.fechaHora).getTime();

  // 2. En Cuartos: los partidos 3 y 4 estaban a las 16:00 UTC con lluvia y se compactan a las 14:45 UTC al restaurar
  const cuartosTardioConLluvia = todosConLluvia.find(
    (p) => p.faseEliminatoria.ronda === 8 && new Date(p.fechaHora).getTime() > new Date(todosConLluvia[3].fechaHora).getTime()
  );
  const cuartosTardioRestaurado = todosRestaurados.find((p) => p.id === cuartosTardioConLluvia.id);
  const horaCuartosLluvia = new Date(cuartosTardioConLluvia.fechaHora).getTime();
  const horaCuartosRestaurado = new Date(cuartosTardioRestaurado.fechaHora).getTime();

  if (horaOctavosRestaurado >= horaOctavosLluvia) {
    throw new Error(
      `Caso 5 Falló: Octavos automático no se adelantó al restaurar canchas. lluvia=${new Date(horaOctavosLluvia).toISOString()}, restaurado=${new Date(horaOctavosRestaurado).toISOString()}`
    );
  }
  if (horaCuartosRestaurado >= horaCuartosLluvia) {
    throw new Error(
      `Caso 5 Falló: Cuartos automático no se compactó al restaurar canchas. lluvia=${new Date(horaCuartosLluvia).toISOString()}, restaurado=${new Date(horaCuartosRestaurado).toISOString()}`
    );
  }
  if (octavosTardioRestaurado.horarioManual !== false || cuartosTardioRestaurado.horarioManual !== false) {
    throw new Error('Caso 5 Falló: Los cruces automáticos compactados deben conservar horarioManual: false');
  }

  console.log(`✅ Caso 5 PASS: Cruces automáticos se compactaron hacia adelante al restaurar canchas (Octavos: ${new Date(horaOctavosLluvia).toISOString()} -> ${new Date(horaOctavosRestaurado).toISOString()}; Cuartos: ${new Date(horaCuartosLluvia).toISOString()} -> ${new Date(horaCuartosRestaurado).toISOString()}) conservando horarioManual:false.`);
}

/**
 * CASO 6: (c) Ciclo de vida de la marca horarioManual:
 * - asignarHorarioManual pone true.
 * - updateFechaHora(null) limpia horarioManual: false, canchaNumero: null, sinHorarioAsignado: true.
 * - sincronizarCuadro regenera cruces nuevos naciendo en false.
 */
async function testHorarioManualCicloDeVida() {
  await limpiarDb();

  const org = await prisma.organizador.create({
    data: {
      nombre: 'Club Test Ciclo Vida',
      email: 'ciclo-vida@padel.test',
      passwordHash: 'hash',
      cantidadCanchas: 3,
      viernesInicio: '15:00',
      viernesFin: '23:00',
      sabadoInicio: '09:00',
      sabadoFin: '24:00',
      domingoInicio: '08:00',
      domingoFin: '22:00',
    },
  });

  const torneo = await prisma.torneo.create({
    data: {
      nombre: 'Torneo Test Ciclo Vida',
      slug: 'torneo-ciclo-vida',
      fecha: parseFechaLocal('2026-09-04'),
      estado: 'BORRADOR',
      organizadorId: org.id,
    },
  });

  const cat = await prisma.categoria.create({
    data: { torneoId: torneo.id, nombre: '7ma', estado: 'BORRADOR' },
  });

  for (let i = 1; i <= 8; i++) {
    await prisma.pareja.create({
      data: { categoriaId: cat.id, jugador1: `J1_${i}`, jugador2: `J2_${i}`, orden: i },
    });
  }

  await zonaService.iniciarCategoria(org.id, cat.id);
  await prisma.torneo.update({ where: { id: torneo.id }, data: { estado: 'EN_CURSO' } });
  await generarEliminatoria(org.id, cat.id);

  const p = await prisma.partido.findFirst({
    where: { categoriaId: cat.id, faseEliminatoriaId: { not: null }, esBye: false },
  });

  // 1. Cruce nuevo nace en false
  if (p.horarioManual !== false) {
    throw new Error(`Cruce recién creado debe nacer con horarioManual: false, recibido: ${p.horarioManual}`);
  }

  // 2. asignarHorarioManual pone true
  const baseSunday = zonaService.proximaFechaPorDia('Domingo', parseFechaLocal('2026-09-04'));
  const targetDate = new Date(baseSunday.getTime() + 10 * 60 * 60 * 1000);
  await partidoService.asignarHorarioManual(org.id, p.id, {
    fechaHora: targetDate,
    canchaNumero: 1,
  });

  const postAsignar = await prisma.partido.findUnique({ where: { id: p.id } });
  if (postAsignar.horarioManual !== true) {
    throw new Error(`asignarHorarioManual debe poner horarioManual: true, recibido: ${postAsignar.horarioManual}`);
  }

  // 3. updateFechaHora(null) limpia a false
  await partidoService.updateFechaHora(org.id, p.id, null);
  const postQuitar = await prisma.partido.findUnique({ where: { id: p.id } });
  if (postQuitar.horarioManual !== false || postQuitar.fechaHora !== null || postQuitar.sinHorarioAsignado !== true || postQuitar.canchaNumero !== null) {
    throw new Error(
      `updateFechaHora(null) debe resetear horarioManual: false, fechaHora: null, sinHorarioAsignado: true. Recibido: manual=${postQuitar.horarioManual}, fechaHora=${postQuitar.fechaHora}, sinHorario=${postQuitar.sinHorarioAsignado}`
    );
  }

  // 4. Asignar nuevamente y verificar que sincronizarCuadro regenera cruces nuevos en false
  await partidoService.asignarHorarioManual(org.id, p.id, {
    fechaHora: targetDate,
    canchaNumero: 1,
  });
  const postReasignar = await prisma.partido.findUnique({ where: { id: p.id } });
  if (postReasignar.horarioManual !== true) {
    throw new Error('Fallo al reasignar horario manual.');
  }

  await sincronizarCuadro(org.id, cat.id);

  const partidosSincronizados = await prisma.partido.findMany({
    where: { categoriaId: cat.id, faseEliminatoriaId: { not: null } },
  });
  for (const part of partidosSincronizados) {
    if (part.horarioManual !== false) {
      throw new Error(`sincronizarCuadro debe crear cruces con horarioManual: false. Partido ${part.id} tiene: ${part.horarioManual}`);
    }
  }

  console.log('✅ Caso 6 PASS: Ciclo de vida completo verificado (nace en false -> true -> false al quitar -> false en sincronizarCuadro).');
}

const DURACION_MS = 75 * 60 * 1000;

/**
 * CASO 7 (Caso 4): R32 con horario válido en sábado + lluvia en domingo + restauración en domingo.
 */
async function testR32SabadoLluviaDomingo() {
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
  if (
    r32PostRed.fechaHora?.getTime() !== fechaSabado22.getTime() ||
    r32PostRed.canchaNumero !== 3 ||
    r32PostRed.sinHorarioAsignado !== false
  ) {
    throw new Error(`R32 mutó en domingo a fecha=${r32PostRed.fechaHora?.toISOString()}, cancha=${r32PostRed.canchaNumero}`);
  }

  // 2. Restauración en domingo a 4 canchas
  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 4, null, '2026-09-06');
  const r32PostRest = await prisma.partido.findUnique({ where: { id: r32.id } });
  if (
    r32PostRest.fechaHora?.getTime() !== fechaSabado22.getTime() ||
    r32PostRest.canchaNumero !== 3 ||
    r32PostRest.sinHorarioAsignado !== false
  ) {
    throw new Error(`R32 mutó en restauración a fecha=${r32PostRest.fechaHora?.toISOString()}, cancha=${r32PostRest.canchaNumero}`);
  }

  console.log('✅ Caso 7 PASS: R32 sábado con horario válido intacto tras lluvia y restauración en domingo.');
}

/**
 * CASO 8 (Caso 5): R32 con horario válido en sábado intacto tras lluvia en domingo con zona incompleta.
 */
async function testR32SabadoLluviaDomingoZonaIncompleta() {
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
  if (
    r32PostRed.fechaHora?.getTime() !== fechaSabado22.getTime() ||
    r32PostRed.canchaNumero !== 3 ||
    r32PostRed.sinHorarioAsignado !== false
  ) {
    throw new Error(`R32 mutó en domingo a fecha=${r32PostRed.fechaHora?.toISOString()}, cancha=${r32PostRed.canchaNumero}`);
  }

  // 2. Restauración en domingo a 4 canchas
  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 4, null, '2026-09-06');
  const r32PostRest = await prisma.partido.findUnique({ where: { id: r32.id } });
  if (
    r32PostRest.fechaHora?.getTime() !== fechaSabado22.getTime() ||
    r32PostRest.canchaNumero !== 3 ||
    r32PostRest.sinHorarioAsignado !== false
  ) {
    throw new Error(`R32 mutó en restauración a fecha=${r32PostRest.fechaHora?.toISOString()}, cancha=${r32PostRest.canchaNumero}`);
  }

  console.log('✅ Caso 8 PASS: R32 sábado con horario válido intacto tras lluvia en domingo con zona incompleta.');
}

/**
 * CASO 9 (Caso a): R32 manual y auto en sábado intactos con lluvia de domingo (R32 en cancha cerrada el domingo).
 */
async function testR32ManualYAutoSabadoLluviaDomingoCanchaCerrada() {
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

  if (
    p1Red.fechaHora?.getTime() !== fechaSabado22.getTime() ||
    p1Red.canchaNumero !== 3 ||
    p1Red.sinHorarioAsignado !== false ||
    p2Red.fechaHora?.getTime() !== fechaSabado22.getTime() ||
    p2Red.canchaNumero !== 4 ||
    p2Red.horarioManual !== true ||
    p2Red.sinHorarioAsignado !== false
  ) {
    throw new Error('R32 manual o auto mutaron tras reducción de domingo');
  }

  // 2. Restauración en domingo a 4 canchas
  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 4, null, '2026-09-06');
  const p1Rest = await prisma.partido.findUnique({ where: { id: r32Matches[0].id } });
  const p2Rest = await prisma.partido.findUnique({ where: { id: r32Matches[1].id } });

  if (
    p1Rest.fechaHora?.getTime() !== fechaSabado22.getTime() ||
    p1Rest.canchaNumero !== 3 ||
    p1Rest.sinHorarioAsignado !== false ||
    p2Rest.fechaHora?.getTime() !== fechaSabado22.getTime() ||
    p2Rest.canchaNumero !== 4 ||
    p2Rest.horarioManual !== true ||
    p2Rest.sinHorarioAsignado !== false
  ) {
    throw new Error('R32 manual o auto mutaron tras restauración de domingo');
  }

  console.log('✅ Caso 9 PASS: R32 manual y auto en sábado intactos con lluvia de domingo (cancha cerrada en domingo).');
}

/**
 * CASO 10 (Caso b): Octavos en adelante SÍ se reubican con lluvia de domingo y se compactan al restaurar.
 */
async function testOctavosSeReubicanLluviaDomingo() {
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

  if (!partidosRed.every((p) => p.canchaNumero <= 2) || partidosRed.length === 0) {
    throw new Error('Octavos no se reubicaron dentro de las 2 canchas activas en reducción');
  }

  // Restauración domingo a 4 canchas
  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 4, null, '2026-09-06');
  const partidosRest = await prisma.partido.findMany({
    where: { categoriaId: cat.id, faseEliminatoriaId: { not: null }, fechaHora: { not: null }, sinHorarioAsignado: false },
  });

  if (!partidosRest.some((p) => p.canchaNumero > 2)) {
    throw new Error('Octavos no se expandieron a canchas 3 o 4 tras restaurar');
  }

  console.log('✅ Caso 10 PASS: Octavos en adelante SÍ se reubican con lluvia de domingo y se compactan al restaurar.');
}

/**
 * CASO 11 (Caso c): R32 recién generado con zonas incompletas queda pendiente.
 */
async function testR32RecienGeneradoZonasIncompletasQuedaPendiente() {
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

  await programarHorariosEliminatorias(org.id, torneo.id, cat.id);

  const r32Matches = await prisma.partido.findMany({
    where: { categoriaId: cat.id, faseEliminatoria: { ronda: 32 }, esBye: false },
  });

  if (!r32Matches.every((p) => p.sinHorarioAsignado === true && p.fechaHora === null) || r32Matches.length === 0) {
    throw new Error('Algún R32 recibió horario a pesar de zonas incompletas');
  }

  console.log('✅ Caso 11 PASS: R32 recién generado con zonas incompletas queda pendiente.');
}

/**
 * CASO 12 (Caso d): Restauración global sin diaKey con overrides de sábado y domingo: la iteración de domingo no modifica ningún R32 del sábado.
 */
async function testRestauracionGlobalSinDiaKeyNoModificaR32() {
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
  if (
    r32Post.fechaHora?.getTime() !== fechaSabado22.getTime() ||
    r32Post.canchaNumero !== 3 ||
    r32Post.sinHorarioAsignado !== false
  ) {
    throw new Error('R32 mutó tras restauración global sin diaKey');
  }

  console.log('✅ Caso 12 PASS: Restauración global sin diaKey con overrides de sábado y domingo no modifica R32 de sábado.');
}

/**
 * CASO 13 (Equivalencia): Con un R32 con horario válido, los Octavos en adelante quedan
 * idénticos corriendo con soloDomingo: true que con la corrida completa.
 */
async function testEquivalenciaSoloDomingo() {
  await limpiarDb();

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
  if (r32PostB.fechaHora?.getTime() !== fechaSabado22.getTime() || r32PostB.canchaNumero !== 3) {
    throw new Error('R32 mutó en corrida con soloDomingo: true');
  }

  const partidosB = await prisma.partido.findMany({
    where: { categoriaId: catB.id, faseEliminatoria: { ronda: { lt: 32 } } },
    include: { faseEliminatoria: true },
    orderBy: [{ faseEliminatoria: { ronda: 'desc' } }, { posicionEnRonda: 'asc' }],
  });

  if (partidosA.length !== partidosB.length) {
    throw new Error(`Cantidad distinta de partidos de domingo: A=${partidosA.length}, B=${partidosB.length}`);
  }

  for (let i = 0; i < partidosA.length; i++) {
    const pA = partidosA[i];
    const pB = partidosB[i];
    const tA = pA.fechaHora ? new Date(pA.fechaHora).getTime() : null;
    const tB = pB.fechaHora ? new Date(pB.fechaHora).getTime() : null;
    if (tA !== tB || pA.canchaNumero !== pB.canchaNumero || pA.sinHorarioAsignado !== pB.sinHorarioAsignado) {
      throw new Error(`Diferencia en Ronda ${pA.faseEliminatoria.ronda} Pos ${pA.posicionEnRonda}: A=(t=${pA.fechaHora?.toISOString()}, c=${pA.canchaNumero}) vs B=(t=${pB.fechaHora?.toISOString()}, c=${pB.canchaNumero})`);
    }
  }

  console.log('✅ Caso 13 PASS: Equivalencia soloDomingo: partidos de domingo idénticos a corrida completa.');
}

async function run() {
  await ensureTestDb();
  resetTestDb();
  await canchasOverridesService.loadFromDb();

  console.log('='.repeat(80));
  console.log('🧪 SUITE: INMUTABILIDAD Y CICLO DE VIDA DE CRUCES MANUALES EN ELIMINATORIAS');
  console.log('='.repeat(80));

  await testR32ManualPostScheduler();
  await testR32ManualPostRestauracion();
  await testEliminatoriaManualLluviaCanchaActiva();
  await testEliminatoriaManualLluviaCanchaCerradaReubicadaYPierdeMarca();
  await testEliminatoriaAutomaticaCompactacionRestauracion();
  await testHorarioManualCicloDeVida();
  await testR32SabadoLluviaDomingo();
  await testR32SabadoLluviaDomingoZonaIncompleta();
  await testR32ManualYAutoSabadoLluviaDomingoCanchaCerrada();
  await testOctavosSeReubicanLluviaDomingo();
  await testR32RecienGeneradoZonasIncompletasQuedaPendiente();
  await testRestauracionGlobalSinDiaKeyNoModificaR32();
  await testEquivalenciaSoloDomingo();

  await limpiarDb();
  await prisma.$disconnect();
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error('Error en test-eliminatoria-inmutabilidad-manual.js:', e);
      process.exit(1);
    });
}

module.exports = { run };
