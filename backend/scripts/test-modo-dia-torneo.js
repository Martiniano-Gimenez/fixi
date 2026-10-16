const { ensureTestDb } = require('./utils/testEnvGuard');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const prisma = new PrismaClient();

const organizadorService = require('../src/services/organizador.service');
const zonaService = require('../src/services/zona.service');
const torneoService = require('../src/services/torneo.service');
const partidoService = require('../src/services/partido.service');
const { parseFechaLocal, getDiaCalendarioConTrasnoche } = require('../src/utils/dateUtils');
const canchasOverridesService = require('../src/services/canchasOverrides.service');
const assert = require('assert');

async function testModoDiaTorneo() {
  await ensureTestDb();
  console.log('🧪 Iniciando test automatizado de Modo Día de Torneo...');
  await canchasOverridesService.loadFromDb();

  async function limpiarPiloto() {
    const existingPiloto = await prisma.organizador.findUnique({ where: { email: 'piloto@padel.com' } });
    if (existingPiloto) {
      const torneos = await prisma.torneo.findMany({ where: { organizadorId: existingPiloto.id } });
      const torneoIds = torneos.map((t) => t.id);
      const categorias = await prisma.categoria.findMany({ where: { torneoId: { in: torneoIds } } });
      const categoriaIds = categorias.map((c) => c.id);
      
      await prisma.setPartido.deleteMany({ where: { partido: { categoriaId: { in: categoriaIds } } } });
      await prisma.partido.deleteMany({ where: { categoriaId: { in: categoriaIds } } });
      await prisma.faseEliminatoria.deleteMany({ where: { categoriaId: { in: categoriaIds } } });
      await prisma.zonaPareja.deleteMany({ where: { zona: { categoriaId: { in: categoriaIds } } } });
      await prisma.zona.deleteMany({ where: { categoriaId: { in: categoriaIds } } });
      await prisma.slotPareja.deleteMany({ where: { pareja: { categoriaId: { in: categoriaIds } } } });
      await prisma.pareja.deleteMany({ where: { categoriaId: { in: categoriaIds } } });
      await prisma.categoria.deleteMany({ where: { id: { in: categoriaIds } } });
      await prisma.overrideCanchasDia.deleteMany({ where: { torneoId: { in: torneoIds } } });
      await prisma.torneo.deleteMany({ where: { id: { in: torneoIds } } });
      await prisma.organizador.delete({ where: { id: existingPiloto.id } });
    }
  }

  // 1. Limpiar datos previos del test piloto si existieran
  await limpiarPiloto();

  try {
  // 2. Crear Organizador con 6 canchas (4 techadas, 2 aire libre)
  const passwordHash = await bcrypt.hash('123456', 10);
  const organizador = await prisma.organizador.create({
    data: {
      nombre: 'Club Piloto 6 Canchas',
      email: 'piloto@padel.com',
      passwordHash,
      cantidadCanchas: 6,
      viernesInicio: '18:00',
      viernesFin: '02:00',
      sabadoInicio: '09:00',
      sabadoFin: '22:00',
    },
  });
  console.log('✅ Organizador creado con 6 canchas');

  // 3. Crear Torneo (Próximo viernes desde hoy)
  const now = new Date();
  let offsetToFriday = 5 - now.getDay();
  if (offsetToFriday < 0) offsetToFriday += 7;
  
  const fechaTorneo = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetToFriday, 12, 0, 0);
  const torneo = await torneoService.createTorneo(organizador.id, {
    nombre: 'Torneo Piloto Lluvia',
    fecha: fechaTorneo.toISOString(),
  });
  console.log(`✅ Torneo creado: ${torneo.nombre} (ID: ${torneo.id})`);

  // 4. Crear 2 Categorías (4ta y 6ta) con 6 parejas cada una (total 12 parejas, 6 partidos de zona)
  const cat4ta = await prisma.categoria.create({
    data: { torneoId: torneo.id, nombre: '4ta Libres', estado: 'BORRADOR' },
  });
  const cat6ta = await prisma.categoria.create({
    data: { torneoId: torneo.id, nombre: '6ta Libres', estado: 'BORRADOR' },
  });

  const nombres = [
    ['P1 A', 'P1 B'], ['P2 A', 'P2 B'], ['P3 A', 'P3 B'],
    ['P4 A', 'P4 B'], ['P5 A', 'P5 B'], ['P6 A', 'P6 B'],
  ];

  for (let i = 0; i < nombres.length; i++) {
    await prisma.pareja.create({
      data: { categoriaId: cat4ta.id, jugador1: nombres[i][0], jugador2: nombres[i][1], orden: i + 1 },
    });
    await prisma.pareja.create({
      data: { categoriaId: cat6ta.id, jugador1: `6ta ${nombres[i][0]}`, jugador2: `6ta ${nombres[i][1]}`, orden: i + 1 },
    });
  }
  console.log('✅ 12 parejas creadas en 4ta y 6ta');

  // 5. Iniciar categorías y asignar horarios sobre las 6 canchas
  await zonaService.iniciarCategoria(organizador.id, cat4ta.id);
  await zonaService.iniciarCategoria(organizador.id, cat6ta.id);
  await zonaService.asignarHorariosAutomatico(organizador.id, [cat4ta.id, cat6ta.id]);

  await prisma.torneo.update({
    where: { id: torneo.id },
    data: { estado: 'EN_CURSO' },
  });
  console.log('✅ Torneo y categorías iniciados con asignación de horarios en 6 canchas');

  // 6. Test GET /en-vivo inicial
  let estadoEnVivo = await organizadorService.getEstadoEnVivo(organizador.id, torneo.id);
  console.log(`✅ Estado inicial en vivo: ${estadoEnVivo.canchasActivas} canchas activas de ${estadoEnVivo.canchasClub} total`);
  if (estadoEnVivo.canchasActivas !== 6 || estadoEnVivo.canchas.length !== 6) {
    throw new Error(`Error: se esperaban 6 canchas activas, se obtuvieron ${estadoEnVivo.canchasActivas}`);
  }

  // 7. Simular que un partido en Cancha 1 está EN_CURSO y otro en Cancha 2 está FINALIZADO
  const partidosCat4ta = await prisma.partido.findMany({
    where: { categoriaId: cat4ta.id },
    orderBy: { fechaHora: 'asc' },
  });

  const pEnCurso = partidosCat4ta[0];
  const pFinalizado = partidosCat4ta[1];

  await prisma.partido.update({
    where: { id: pEnCurso.id },
    data: { canchaNumero: 1 },
  });
  // Usar el nuevo servicio updateEstado para marcar EN_CURSO
  await partidoService.updateEstado(organizador.id, pEnCurso.id, 'EN_CURSO');

  await prisma.partido.update({
    where: { id: pFinalizado.id },
    data: { estado: 'FINALIZADO', canchaNumero: 2 },
  });
  console.log('✅ Partidos configurados: 1 EN_CURSO (vía updateEstado) en Cancha 1, 1 FINALIZADO en Cancha 2');

  // 8. Test Reducción a 4 canchas (MODO LLUVIA)
  console.log('🌧️ Ejecutando reducción de canchas a 4 (Modo Lluvia)...');
  
  const resReduccion = await organizadorService.reprogramarPorReduccionCanchas(organizador.id, torneo.id, 4, pEnCurso.fechaHora);
  console.log(`✅ Resultado reprogramación: ${resReduccion.message}`);
  console.log(`   - Partidos reprogramados: ${resReduccion.reprogramacion.partidosReprogramados}`);
  console.log(`   - Partidos sin cambio: ${resReduccion.reprogramacion.partidosSinCambio}`);
  console.log(`   - Partidos sin horario nuevo: ${resReduccion.reprogramacion.partidosSinHorarioNuevo}`);

  // Verificar estado post-reducción
  estadoEnVivo = await organizadorService.getEstadoEnVivo(organizador.id, torneo.id);
  if (estadoEnVivo.canchasActivas !== 4) {
    throw new Error(`Error: se esperaban 4 canchas activas, se obtuvo ${estadoEnVivo.canchasActivas}`);
  }

  // Verificar que ninguna cancha activa > 4 tiene partidos pendientes
  const partidosPendientesPost = await prisma.partido.findMany({
    where: {
      categoria: { torneoId: torneo.id },
      estado: 'PENDIENTE',
    },
  });

  for (const p of partidosPendientesPost) {
    if (p.canchaNumero && p.canchaNumero > 4) {
      throw new Error(`Error: Partido pendiente ${p.id} quedó asignado a cancha inhabilitada ${p.canchaNumero}`);
    }
  }
  console.log('✅ Verificado: Ningún partido pendiente quedó en canchas 5 o 6');

  // Verificar que el partido EN_CURSO y el FINALIZADO no cambiaron
  const pEnCursoPost = await prisma.partido.findUnique({ where: { id: pEnCurso.id } });
  const pFinalizadoPost = await prisma.partido.findUnique({ where: { id: pFinalizado.id } });
  if (pEnCursoPost.estado !== 'EN_CURSO' || pEnCursoPost.canchaNumero !== 1) {
    throw new Error('Error: Partido EN_CURSO fue modificado');
  }
  if (pFinalizadoPost.estado !== 'FINALIZADO' || pFinalizadoPost.canchaNumero !== 2) {
    throw new Error('Error: Partido FINALIZADO fue modificado');
  }
  console.log('✅ Verificado: Partidos EN_CURSO y FINALIZADO se mantuvieron intactos');

  // 9. Test de Bloqueo: Si ponemos un partido EN_CURSO en Cancha 4 (vía updateEstado) e intentamos reducir a 3
  await prisma.partido.update({
    where: { id: partidosCat4ta[2].id },
    data: { canchaNumero: 4 },
  });
  await partidoService.updateEstado(organizador.id, partidosCat4ta[2].id, 'EN_CURSO');

  console.log('🔒 Probando bloqueo al reducir cuando hay partido EN_CURSO en cancha afectada...');
  try {
    await organizadorService.reprogramarPorReduccionCanchas(organizador.id, torneo.id, 3, pEnCurso.fechaHora);
    throw new Error('FALLÓ EL TEST: Debería haber bloqueado la reducción a 3');
  } catch (err) {
    if (err.statusCode === 400 && err.message.includes('partido en curso en la Cancha 4')) {
      console.log(`✅ Bloqueo correcto verificado: "${err.message}"`);
    } else {
      throw err;
    }
  }

  // 9b. Test de Revertir a PENDIENTE (vía updateEstado)
  console.log('🔄 Probando reversión de estado EN_CURSO a PENDIENTE...');
  const resRevertir = await partidoService.updateEstado(organizador.id, partidosCat4ta[2].id, 'PENDIENTE');
  if (resRevertir.partido.estado !== 'PENDIENTE') {
    throw new Error('FALLÓ EL TEST: No se pudo revertir el partido a PENDIENTE');
  }
  console.log(`✅ Reversión exitosa: ${resRevertir.message}`);

  // 9c. Test Validación: No permitir updateEstado en partido FINALIZADO
  try {
    await partidoService.updateEstado(organizador.id, pFinalizado.id, 'EN_CURSO');
    throw new Error('FALLÓ EL TEST: Debería haber bloqueado modificar un partido FINALIZADO');
  } catch (err) {
    if (err.statusCode === 400 && err.message.includes('No se puede modificar el estado de un partido finalizado')) {
      console.log(`✅ Validación partido FINALIZADO verificada: "${err.message}"`);
    } else {
      throw err;
    }
  }

  // 10. Test Validaciones: Override 0 y Override > 6
  try {
    await organizadorService.reprogramarPorReduccionCanchas(organizador.id, torneo.id, 0);
    throw new Error('FALLÓ EL TEST: Debería haber fallado con 0 canchas');
  } catch (err) {
    console.log(`✅ Validación 0 canchas verificada: "${err.message}"`);
  }

  try {
    await organizadorService.reprogramarPorReduccionCanchas(organizador.id, torneo.id, 8);
    throw new Error('FALLÓ EL TEST: Debería haber fallado con 8 canchas (> 6)');
  } catch (err) {
    console.log(`✅ Validación superación de canchas del club verificada: "${err.message}"`);
  }

  // 11. Test Restaurar canchas (null)
  console.log('☀️ Probando restauración de todas las canchas...');
  const resRestaurar = await organizadorService.reprogramarPorReduccionCanchas(organizador.id, torneo.id, null);
  if (resRestaurar.canchasActivas !== 6 || resRestaurar.reprogramacion.ejecutada !== true) {
    throw new Error('Error al restaurar canchas: se esperaba reprogramación ejecutada');
  }
  console.log(`✅ Restauración exitosa: ${resRestaurar.message}`);

  // Verificar que al restaurar, se ejecutó la reprogramación
  const partidosPendientesRestaurados = await prisma.partido.findMany({
    where: {
      categoria: { torneoId: torneo.id },
      estado: 'PENDIENTE',
    },
  });
  const canchasUsadas = new Set(partidosPendientesRestaurados.map((p) => p.canchaNumero).filter(Boolean));
  console.log('🏟️ Canchas utilizadas por partidos pendientes tras restaurar:', Array.from(canchasUsadas));
  console.log('✅ Verificado: Al restaurar canchas, la reprogramación se ejecutó exitosamente.');

  // =======================================================================
  // 12. Test Límite Real: Activar Modo Lluvia en ventana de trasnoche
  // =======================================================================
  console.log('\n🌙 Probando Modo Lluvia en horario de trasnoche...');
  // Tomamos un partido pendiente cualquiera y lo forzamos a estar en horario de trasnoche (ej. Sábado 01:00 AM, lógicamente Viernes)
  const pTrasnoche = partidosCat4ta[3]; 
  const dTrasnoche = new Date(fechaTorneo);
  dTrasnoche.setDate(dTrasnoche.getDate() + 1); // Sábado
  dTrasnoche.setHours(1, 0, 0, 0); // 01:00 AM del Sábado

  await prisma.partido.update({
    where: { id: pTrasnoche.id },
    data: { 
      estado: 'PENDIENTE', 
      canchaNumero: 5, 
      fechaHora: dTrasnoche,
      sinHorarioAsignado: false
    },
  });

  // Simulamos activar lluvia a las 23:30 del Viernes
  const dLluviaTrasnoche = new Date(fechaTorneo);
  dLluviaTrasnoche.setHours(23, 30, 0, 0);

  console.log('🌧️ Ejecutando reducción de canchas a 4 (Modo Lluvia en Trasnoche)...');
  const resTrasnoche = await organizadorService.reprogramarPorReduccionCanchas(organizador.id, torneo.id, 4, dLluviaTrasnoche);
  console.log(`✅ Resultado reprogramación trasnoche: ${resTrasnoche.message}`);
  
  if (resTrasnoche.reprogramacion.partidosReprogramados === 0) {
    throw new Error('FALLÓ EL TEST: El partido de trasnoche (Sábado 01:00 AM) no fue reprogramado a pesar de pertenecer lógicamente al Viernes.');
  }

  const pTrasnochePost = await prisma.partido.findUnique({ where: { id: pTrasnoche.id } });
  if (pTrasnochePost.canchaNumero > 4) {
    throw new Error(`FALLÓ EL TEST: El partido de trasnoche quedó en cancha inhabilitada: ${pTrasnochePost.canchaNumero}`);
  }
  console.log('✅ Partido de trasnoche (Sábado 01:00) fue correctamente reprogramado al reducir canchas!');

  // =======================================================================
  // 13. Test A: Aislamiento por día lógico en reducción (Opción B)
  // =======================================================================
  console.log('\n🎯 TEST A: Aislamiento por día lógico en reducción (Viernes no toca Sábado)...');
  
  // Primero restauramos a 6 canchas para tener el club completo
  await organizadorService.reprogramarPorReduccionCanchas(organizador.id, torneo.id, null);

  // Obtener partidos pendientes actuales
  const todosPartidosTorneo = await prisma.partido.findMany({
    where: { categoria: { torneoId: torneo.id } },
    orderBy: { id: 'asc' },
  });

  const horariosClubTest = {
    viernesInicio: organizador.viernesInicio,
    viernesFin: organizador.viernesFin,
    sabadoInicio: organizador.sabadoInicio,
    sabadoFin: organizador.sabadoFin,
  };

  // Asignar explícitamente 2 partidos al Sábado (uno en Cancha 5 y otro en Cancha 6)
  const dSabadoManana = new Date(fechaTorneo);
  dSabadoManana.setDate(dSabadoManana.getDate() + 1);
  dSabadoManana.setHours(10, 0, 0, 0); // Sábado 10:00 AM

  const dSabadoMediodia = new Date(fechaTorneo);
  dSabadoMediodia.setDate(dSabadoMediodia.getDate() + 1);
  dSabadoMediodia.setHours(11, 15, 0, 0); // Sábado 11:15 AM

  const pSabado1 = todosPartidosTorneo[0];
  const pSabado2 = todosPartidosTorneo[1];

  await prisma.partido.update({
    where: { id: pSabado1.id },
    data: {
      estado: 'PENDIENTE',
      fechaHora: dSabadoManana,
      canchaNumero: 5,
      sinHorarioAsignado: false,
    },
  });

  await prisma.partido.update({
    where: { id: pSabado2.id },
    data: {
      estado: 'PENDIENTE',
      fechaHora: dSabadoMediodia,
      canchaNumero: 6,
      sinHorarioAsignado: false,
    },
  });

  // Asignar el resto de los partidos al Viernes
  const dViernesTarde = new Date(fechaTorneo);
  dViernesTarde.setHours(19, 0, 0, 0);

  for (let i = 2; i < todosPartidosTorneo.length; i++) {
    const p = todosPartidosTorneo[i];
    if (p.estado === 'FINALIZADO') continue;
    const horaP = new Date(dViernesTarde.getTime() + (i - 2) * 45 * 60 * 1000);
    await prisma.partido.update({
      where: { id: p.id },
      data: {
        estado: 'PENDIENTE',
        fechaHora: horaP,
        canchaNumero: (i % 6) + 1,
        sinHorarioAsignado: false,
      },
    });
  }

  // Snapshot de los partidos del sábado antes de reducir canchas
  const snapshotSabado = [
    await prisma.partido.findUnique({ where: { id: pSabado1.id } }),
    await prisma.partido.findUnique({ where: { id: pSabado2.id } }),
  ];

  console.log(`📌 Snapshot Sábado: Partido 1 en Cancha ${snapshotSabado[0].canchaNumero} (${snapshotSabado[0].fechaHora.toISOString()})`);
  console.log(`📌 Snapshot Sábado: Partido 2 en Cancha ${snapshotSabado[1].canchaNumero} (${snapshotSabado[1].fechaHora.toISOString()})`);

  // Activar Modo Lluvia un Viernes (reducir a 4 canchas)
  const dViernesLluvia = new Date(fechaTorneo);
  dViernesLluvia.setHours(20, 0, 0, 0);

  const resReduccionViernes = await organizadorService.reprogramarPorReduccionCanchas(organizador.id, torneo.id, 4, dViernesLluvia);
  console.log(`✅ Reducción a 4 canchas ejecutada: ${resReduccionViernes.message}`);

  // Aserciones estrictas Test A:
  // 1. Partidos del sábado deben ser idénticos antes y después
  const pSabado1Post = await prisma.partido.findUnique({ where: { id: pSabado1.id } });
  const pSabado2Post = await prisma.partido.findUnique({ where: { id: pSabado2.id } });

  assert.strictEqual(
    pSabado1Post.fechaHora.getTime(),
    snapshotSabado[0].fechaHora.getTime(),
    'FALLÓ TEST A: El horario del partido de sábado fue modificado por el override del viernes'
  );
  assert.strictEqual(
    pSabado1Post.canchaNumero,
    snapshotSabado[0].canchaNumero,
    'FALLÓ TEST A: La cancha del partido de sábado fue modificada por el override del viernes'
  );
  assert.strictEqual(
    pSabado2Post.fechaHora.getTime(),
    snapshotSabado[1].fechaHora.getTime(),
    'FALLÓ TEST A: El horario del partido 2 de sábado fue modificado por el override del viernes'
  );
  assert.strictEqual(
    pSabado2Post.canchaNumero,
    snapshotSabado[1].canchaNumero,
    'FALLÓ TEST A: La cancha del partido 2 de sábado fue modificada por el override del viernes'
  );

  // 2. Partidos del sábado NO deben figurar en la lista de cambios
  const cambiosIds = (resReduccionViernes.reprogramacion.cambios || []).map((c) => c.partidoId);
  assert.ok(!cambiosIds.includes(pSabado1.id), 'FALLÓ TEST A: Partido de sábado apareció en cambios de la reducción');
  assert.ok(!cambiosIds.includes(pSabado2.id), 'FALLÓ TEST A: Partido de sábado 2 apareció en cambios de la reducción');

  // 3. Partidos pendientes del viernes deben estar en canchas <= 4
  const pendientesViernesPost = await prisma.partido.findMany({
    where: {
      categoria: { torneoId: torneo.id },
      estado: 'PENDIENTE',
      id: { notIn: [pSabado1.id, pSabado2.id] },
    },
  });
  for (const pv of pendientesViernesPost) {
    if (pv.canchaNumero) {
      assert.ok(pv.canchaNumero <= 4, `FALLÓ TEST A: Partido de viernes quedó en cancha inhabilitada: ${pv.canchaNumero}`);
    }
  }

  // 4. getEstadoEnVivo: Partidos del sábado en canchas 5/6 NO deben ser clasificados como 'partidosEnCanchaFantasma'
  const estadoEnVivoPostA = await organizadorService.getEstadoEnVivo(organizador.id, torneo.id);
  const fantasmaIds = estadoEnVivoPostA.partidosEnCanchaFantasma.map((p) => p.id);
  assert.ok(!fantasmaIds.includes(pSabado1.id), 'FALLÓ TEST A: Partido de sábado en cancha 5 marcado falsamente como cancha fantasma');
  assert.ok(!fantasmaIds.includes(pSabado2.id), 'FALLÓ TEST A: Partido de sábado en cancha 6 marcado falsamente como cancha fantasma');

  // 5. getEstadoEnVivo debe exponer overrideDiaKey correspondiente al viernes lógico
  const diaViernesEsperado = getDiaCalendarioConTrasnoche(dViernesLluvia, horariosClubTest).key;
  assert.strictEqual(
    estadoEnVivoPostA.torneo.overrideDiaKey,
    diaViernesEsperado,
    'FALLÓ TEST A: overrideDiaKey en getEstadoEnVivo no coincide con el día del override'
  );
  console.log('✅ TEST A PASÓ: Partidos del Sábado 100% inalterados, canchas 5 y 6 protegidas y canchas fantasma filtradas correctamente.');

  // =======================================================================
  // 14. Test B: Restauración simétrica y atomicidad
  // =======================================================================
  console.log('\n🎯 TEST B: Restauración simétrica (Sábado sigue intacto, Viernes se redistribuye)...');

  // Verificar explícitamente que todos los partidos pendientes del viernes fueron evaluados como candidatos por el scheduler
  const pendientesViernesCount = await prisma.partido.count({
    where: {
      categoria: { torneoId: torneo.id },
      estado: 'PENDIENTE',
      id: { notIn: [pSabado1.id, pSabado2.id] },
    },
  });
  const resRestauracionSimetrica = await organizadorService.reprogramarPorReduccionCanchas(organizador.id, torneo.id, null);
  console.log(`✅ Restauración ejecutada: ${resRestauracionSimetrica.message}`);

  const totalEvaluadosViernes = resRestauracionSimetrica.reprogramacion.partidosReprogramados + resRestauracionSimetrica.reprogramacion.partidosSinCambio;
  assert.strictEqual(
    totalEvaluadosViernes,
    pendientesViernesCount,
    `FALLÓ TEST B: Se esperaban ${pendientesViernesCount} partidos del viernes evaluados en el scheduler, se evaluaron ${totalEvaluadosViernes}`
  );
  console.log(`📊 Métricas de restauración: ${totalEvaluadosViernes} partidos pendientes del viernes evaluados en scheduler (${resRestauracionSimetrica.reprogramacion.partidosSinCambio} sin cambio de hora por saturación de descanso entre las 4 zonas), 2 partidos del sábado excluidos.`);

  const pSabado1PostB = await prisma.partido.findUnique({ where: { id: pSabado1.id } });
  const pSabado2PostB = await prisma.partido.findUnique({ where: { id: pSabado2.id } });

  assert.strictEqual(
    pSabado1PostB.fechaHora.getTime(),
    snapshotSabado[0].fechaHora.getTime(),
    'FALLÓ TEST B: La restauración modificó el horario del partido de sábado'
  );
  assert.strictEqual(
    pSabado1PostB.canchaNumero,
    snapshotSabado[0].canchaNumero,
    'FALLÓ TEST B: La restauración modificó la cancha del partido de sábado'
  );
  assert.strictEqual(
    pSabado2PostB.fechaHora.getTime(),
    snapshotSabado[1].fechaHora.getTime(),
    'FALLÓ TEST B: La restauración modificó el horario del partido 2 de sábado'
  );
  assert.strictEqual(
    pSabado2PostB.canchaNumero,
    snapshotSabado[1].canchaNumero,
    'FALLÓ TEST B: La restauración modificó la cancha del partido 2 de sábado'
  );

  // Verificar que el estado del torneo post restauración tiene overrideDiaKey en null
  const estadoEnVivoPostB = await organizadorService.getEstadoEnVivo(organizador.id, torneo.id);
  assert.strictEqual(estadoEnVivoPostB.torneo.canchasDisponiblesOverride, null);
  assert.strictEqual(estadoEnVivoPostB.torneo.overrideActivoDesde, null);
  assert.strictEqual(estadoEnVivoPostB.torneo.overrideDiaKey, null);
  console.log('✅ TEST B PASÓ: Restauración simétrica respetó el sábado, evaluó todos los partidos del viernes y reseteó overrideDiaKey limpiamente.');

  // =======================================================================
  // 15. Test C: Determinismo de partido sin fechaHora con el contrato nuevo:
  // - Un pendiente que no está en partidosSinSlot no se toca.
  // - Un partido que sí está en el mapa, al restaurar debe quedar agendado
  //   en el día del override sin depender de torneo.fecha ni del reloj del sistema.
  // =======================================================================
  console.log('\n🎯 TEST C: Contrato nuevo para partidos sin horario: no tocar pendientes fuera del mapa y agendar en el día del override a los que sí están...');

  // Tomamos un partido del viernes y lo forzamos a estado sin horario (NO está en el mapa partidosSinSlot)
  const pSinHorario = pendientesViernesPost[0];
  await prisma.partido.update({
    where: { id: pSinHorario.id },
    data: {
      estado: 'PENDIENTE',
      fechaHora: null,
      canchaNumero: null,
      sinHorarioAsignado: true,
    },
  });

  // Tomamos otro partido del viernes para que SÍ esté en el mapa partidosSinSlot
  const pEnMapa = pendientesViernesPost[1];
  await prisma.partido.update({
    where: { id: pEnMapa.id },
    data: {
      estado: 'PENDIENTE',
      fechaHora: null,
      canchaNumero: null,
      sinHorarioAsignado: true,
    },
  });

  const diaOverrideViernesEsperado = getDiaCalendarioConTrasnoche(dViernesLluvia, horariosClubTest).key;

  // Activar lluvia un viernes
  await organizadorService.reprogramarPorReduccionCanchas(organizador.id, torneo.id, 4, dViernesLluvia);

  // Registrar pEnMapa en el override del día viernes
  await canchasOverridesService.setOverrideDia(
    torneo.id,
    diaOverrideViernesEsperado,
    4,
    dViernesLluvia,
    { [pEnMapa.id]: 'Sin cancha activa libre disponible en ese horario' }
  );

  // 1. Verificación en reducción: pSinHorario (fuera de mapa) NO se toca
  const pSinHorarioPostRed = await prisma.partido.findUnique({ where: { id: pSinHorario.id } });
  assert.strictEqual(
    pSinHorarioPostRed.fechaHora,
    null,
    'FALLÓ TEST C: El partido sin horario fuera de partidosSinSlot fue modificado en reducción'
  );
  assert.strictEqual(pSinHorarioPostRed.sinHorarioAsignado, true);

  // Modificar torneo.fecha a un día arbitrario diferente (ej. Martes) para verificar que
  // la restauración del partido en mapa NO depende de torneo.fecha ni del reloj del sistema.
  const fechaTorneoOriginal = torneo.fecha;
  await prisma.torneo.update({
    where: { id: torneo.id },
    data: { fecha: new Date('2026-09-01T12:00:00.000Z') }, // Martes arbitrario
  });

  try {
    // Restaurar a 6 canchas para el día del override (Viernes)
    await organizadorService.reprogramarPorReduccionCanchas(organizador.id, torneo.id, null, dViernesLluvia);

    // 2. Verificación al restaurar:
    // - pSinHorario (fuera de mapa) sigue sin tocarse
    const pSinHorarioPostRest = await prisma.partido.findUnique({ where: { id: pSinHorario.id } });
    assert.strictEqual(
      pSinHorarioPostRest.fechaHora,
      null,
      'FALLÓ TEST C: El partido sin horario fuera de partidosSinSlot fue modificado en restauración'
    );
    assert.strictEqual(pSinHorarioPostRest.sinHorarioAsignado, true);

    // - pEnMapa (que sí estaba en partidosSinSlot) debe quedar agendado en el día del override (Viernes)
    const pEnMapaPost = await prisma.partido.findUnique({ where: { id: pEnMapa.id } });
    assert.ok(pEnMapaPost.fechaHora !== null, 'FALLÓ TEST C: El partido en partidosSinSlot no recibió fechaHora al restaurar');
    assert.strictEqual(pEnMapaPost.sinHorarioAsignado, false, 'FALLÓ TEST C: sinHorarioAsignado debería ser false al restaurar');

    const diaPartidoAsignado = getDiaCalendarioConTrasnoche(pEnMapaPost.fechaHora, horariosClubTest).key;
    assert.strictEqual(
      diaPartidoAsignado,
      diaOverrideViernesEsperado,
      `FALLÓ TEST C: El partido en mapa fue asignado a ${diaPartidoAsignado}, pero debe coincidir con el día del override (${diaOverrideViernesEsperado}), sin depender de torneo.fecha`
    );
    console.log(`✅ TEST C PASÓ: Partido fuera de mapa no se tocó; partido en mapa quedó agendado en el día del override (${diaOverrideViernesEsperado}) sin depender de torneo.fecha.`);
  } finally {
    // Restaurar torneo.fecha original para los tests siguientes
    await prisma.torneo.update({
      where: { id: torneo.id },
      data: { fecha: fechaTorneoOriginal },
    });
  }

  // =======================================================================
  // 16. Test Concurrencia y Atomicidad: Operaciones concurrentes durante reducción
  // =======================================================================
  console.log('\n🎯 TEST Concurrencia: Verificando que lecturas y escrituras simultáneas no produzcan lock timeout...');
  
  // Ejecutamos simultáneamente:
  // 1. Una lectura intensiva de getEstadoEnVivo (findMany con includes de categorías, zonas, parejas, sets)
  // 2. Una escritura transaccional de reprogramarPorReduccionCanchas (prisma.$transaction con scheduler MCF y update de torneo)
  // 3. Una mutación puntual de updateEstado sobre un partido
  const pTestConc = pendientesViernesPost[1];
  const t0 = Date.now();
  const [resRead, resReducir, resUpdateEstado] = await Promise.all([
    organizadorService.getEstadoEnVivo(organizador.id, torneo.id),
    organizadorService.reprogramarPorReduccionCanchas(organizador.id, torneo.id, 5, dViernesLluvia),
    partidoService.updateEstado(organizador.id, pTestConc.id, 'EN_CURSO'),
  ]);
  const duracionMs = Date.now() - t0;

  assert.ok(resRead.torneo !== null, 'Lectura getEstadoEnVivo falló durante concurrencia');
  assert.ok(resReducir.reprogramacion.ejecutada === true, 'Transacción de reducción falló durante concurrencia');
  assert.ok(resUpdateEstado.partido !== null, 'Escritura updateEstado falló durante concurrencia');
  console.log(`✅ TEST Concurrencia PASÓ en ${duracionMs}ms: getEstadoEnVivo (lectura), reprogramarPorReduccionCanchas (tx) y updateEstado (escritura) ejecutaron concurrentemente sin bloqueo.`);

  // =======================================================================
  // 17. Test D: Escenario Multi-Día sin restauración previa (Viernes lluvia -> Sábado lluvia)
  // =======================================================================
  console.log('\n🎯 TEST D: Escenario Multi-Día sin restauración previa (Viernes activa lluvia, no restaura, Sábado activa lluvia)...');

  // Restaurar previamente para partir de estado limpio
  await organizadorService.reprogramarPorReduccionCanchas(organizador.id, torneo.id, null);

  const partidosParaTestD = await prisma.partido.findMany({
    where: { categoria: { torneoId: torneo.id } },
    orderBy: { id: 'asc' },
  });

  const pD_Sabado1 = partidosParaTestD[0];
  const pD_Sabado2 = partidosParaTestD[1];

  const dSabadoMananaD = new Date(fechaTorneo);
  dSabadoMananaD.setDate(dSabadoMananaD.getDate() + 1);
  dSabadoMananaD.setHours(10, 0, 0, 0);

  const dSabadoMediodiaD = new Date(fechaTorneo);
  dSabadoMediodiaD.setDate(dSabadoMediodiaD.getDate() + 1);
  dSabadoMediodiaD.setHours(11, 15, 0, 0);

  // Asignar 2 partidos al sábado en Canchas 5 y 6
  await prisma.partido.update({
    where: { id: pD_Sabado1.id },
    data: {
      estado: 'PENDIENTE',
      fechaHora: dSabadoMananaD,
      canchaNumero: 5,
      sinHorarioAsignado: false,
    },
  });

  await prisma.partido.update({
    where: { id: pD_Sabado2.id },
    data: {
      estado: 'PENDIENTE',
      fechaHora: dSabadoMediodiaD,
      canchaNumero: 6,
      sinHorarioAsignado: false,
    },
  });

  // El resto de los partidos asignados al viernes en canchas 1 a 6
  const dViernesInicioD = new Date(fechaTorneo);
  dViernesInicioD.setHours(19, 0, 0, 0);
  for (let i = 2; i < partidosParaTestD.length; i++) {
    const p = partidosParaTestD[i];
    if (p.estado === 'FINALIZADO') continue;
    const horaP = new Date(dViernesInicioD.getTime() + (i - 2) * 45 * 60 * 1000);
    await prisma.partido.update({
      where: { id: p.id },
      data: {
        estado: 'PENDIENTE',
        fechaHora: horaP,
        canchaNumero: (i % 6) + 1,
        sinHorarioAsignado: false,
      },
    });
  }

  // PASO 1: Viernes 18:00 - Se activa Modo Lluvia (reducir a 4 canchas)
  const dViernesLluviaD = new Date(fechaTorneo);
  dViernesLluviaD.setHours(18, 0, 0, 0);
  const resReduccionViernesD = await organizadorService.reprogramarPorReduccionCanchas(
    organizador.id,
    torneo.id,
    4,
    dViernesLluviaD
  );
  console.log(`✅ Paso 1: Modo Lluvia Viernes activado (${resReduccionViernesD.message})`);

  // Verificar que en DB quedó persistido el timestamp del viernes
  const torneoPostViernes = await prisma.torneo.findUnique({ where: { id: torneo.id } });
  assert.strictEqual(
    torneoPostViernes.overrideActivoDesde.getTime(),
    dViernesLluviaD.getTime(),
    'FALLÓ TEST D: overrideActivoDesde no se persistió con el timestamp del viernes'
  );
  assert.strictEqual(
    torneoPostViernes.canchasDisponiblesOverride,
    4,
    'FALLÓ TEST D: canchasDisponiblesOverride no es 4 tras reducción del viernes'
  );

  // Snapshot de los partidos del viernes tras su reprogramación
  const partidosViernesSnapshot = await prisma.partido.findMany({
    where: {
      categoria: { torneoId: torneo.id },
      id: { notIn: [pD_Sabado1.id, pD_Sabado2.id] },
    },
  });

  // PASO 2: El organizador NUNCA restaura las canchas el viernes.
  // El torneo queda con overrideActivoDesde = Viernes 18:00 en DB.
  // Sábado por la mañana amanece lloviendo. El organizador activa Modo Lluvia el sábado a las 09:30 AM (reduce a 4 canchas).
  const dSabadoLluviaD = new Date(fechaTorneo);
  dSabadoLluviaD.setDate(dSabadoLluviaD.getDate() + 1);
  dSabadoLluviaD.setHours(9, 30, 0, 0);

  console.log('🌧️ Paso 2: Sábado por la mañana — Activando Modo Lluvia sin haber restaurado el viernes...');
  const resReduccionSabadoD = await organizadorService.reprogramarPorReduccionCanchas(
    organizador.id,
    torneo.id,
    4,
    dSabadoLluviaD
  );
  console.log(`✅ Resultado reprogramación sábado: ${resReduccionSabadoD.message}`);

  // ASERCIONES CRÍTICAS TEST D:
  // 1. La reprogramación de sábado DEBE haberse ejecutado (no descartada como no-op por tener la misma cantidad de canchas)
  assert.strictEqual(
    resReduccionSabadoD.reprogramacion.ejecutada,
    true,
    'FALLÓ TEST D: La reprogramación del sábado fue descartada erróneamente como no-op'
  );

  // 2. En la base de datos, overrideActivoDesde DEBE haberse actualizado a la fecha del SÁBADO (no retener el viernes)
  const torneoPostSabado = await prisma.torneo.findUnique({ where: { id: torneo.id } });
  assert.strictEqual(
    torneoPostSabado.overrideActivoDesde.getTime(),
    dSabadoLluviaD.getTime(),
    `FALLÓ TEST D: overrideActivoDesde en DB retuvo el timestamp viejo del viernes en vez de actualizar al sábado (${torneoPostSabado.overrideActivoDesde.toISOString()} vs ${dSabadoLluviaD.toISOString()})`
  );

  // 3. En getEstadoEnVivo, overrideDiaKey DEBE ser "sabado"
  const estadoEnVivoSabado = await organizadorService.getEstadoEnVivo(organizador.id, torneo.id);
  const diaSabadoEsperado = getDiaCalendarioConTrasnoche(dSabadoLluviaD, horariosClubTest).key;
  assert.strictEqual(
    estadoEnVivoSabado.torneo.overrideDiaKey,
    diaSabadoEsperado,
    `FALLÓ TEST D: overrideDiaKey en getEstadoEnVivo es ${estadoEnVivoSabado.torneo.overrideDiaKey}, se esperaba ${diaSabadoEsperado}`
  );

  // 4. Los partidos del sábado que estaban en canchas 5 y 6 DEBEN haber sido reprogramados a canchas <= 4
  const pD_Sabado1Post = await prisma.partido.findUnique({ where: { id: pD_Sabado1.id } });
  const pD_Sabado2Post = await prisma.partido.findUnique({ where: { id: pD_Sabado2.id } });
  assert.ok(
    pD_Sabado1Post.canchaNumero <= 4,
    `FALLÓ TEST D: Partido del sábado 1 quedó en cancha inhabilitada: ${pD_Sabado1Post.canchaNumero}`
  );
  assert.ok(
    pD_Sabado2Post.canchaNumero <= 4,
    `FALLÓ TEST D: Partido del sábado 2 quedó en cancha inhabilitada: ${pD_Sabado2Post.canchaNumero}`
  );

  // 5. Los partidos del viernes NO deben haber sido tocados por la activación del sábado
  for (const pViernesSnap of partidosViernesSnapshot) {
    const pActual = await prisma.partido.findUnique({ where: { id: pViernesSnap.id } });
    if (pViernesSnap.fechaHora) {
      assert.strictEqual(
        pActual.fechaHora.getTime(),
        pViernesSnap.fechaHora.getTime(),
        `FALLÓ TEST D: Partido del viernes ${pActual.id} fue modificado por el override del sábado`
      );
    }
    assert.strictEqual(
      pActual.canchaNumero,
      pViernesSnap.canchaNumero,
      `FALLÓ TEST D: Cancha del partido de viernes ${pActual.id} fue modificada por el override del sábado`
    );
  }

  // 6. Restauración final limpia el override por completo
  const resRestaurarD = await organizadorService.reprogramarPorReduccionCanchas(organizador.id, torneo.id, null);
  assert.strictEqual(resRestaurarD.canchasActivas, 6);
  const torneoFinal = await prisma.torneo.findUnique({ where: { id: torneo.id } });
  assert.strictEqual(torneoFinal.canchasDisponiblesOverride, null);
  assert.strictEqual(torneoFinal.overrideActivoDesde, null);

  // 7. Prueba con diaKey (simulando request real desde el tab activo del frontend sin mockTimestamp)
  const diaSabadoKey = getDiaCalendarioConTrasnoche(dSabadoLluviaD, horariosClubTest).key;
  const resDiaKey = await organizadorService.reprogramarPorReduccionCanchas(
    organizador.id,
    torneo.id,
    5,
    null, // mockTimestamp null
    diaSabadoKey
  );
  assert.strictEqual(resDiaKey.reprogramacion.ejecutada, true);
  assert.strictEqual(resDiaKey.reprogramacion.overrideDiaKey, diaSabadoKey);
  await organizadorService.reprogramarPorReduccionCanchas(organizador.id, torneo.id, null);

  console.log('✅ TEST D PASÓ: Activación multi-día sin restauración previa actualizó overrideActivoDesde al sábado, reprogramó partidos del sábado a canchas válidas y soportó diaKey del frontend.');

  // =======================================================================
  // 18. Test E: Partido EN_CURSO de día anterior no bloquea reducción del día actual
  // =======================================================================
  console.log('\n🎯 TEST E: Validación EN_CURSO aislada por jornada (partido colgado del viernes en Cancha 5 no bloquea reducción a 4 del sábado)...');

  // 1. Restauramos a 6 canchas para tener estado base
  await organizadorService.reprogramarPorReduccionCanchas(organizador.id, torneo.id, null);

  const partidosParaTestE = await prisma.partido.findMany({
    where: { categoria: { torneoId: torneo.id } },
    orderBy: { id: 'asc' },
  });

  const pViernesColgado = partidosParaTestE[2];
  const dViernesNoche = new Date(fechaTorneo);
  dViernesNoche.setHours(23, 0, 0, 0);

  // Simular un partido del viernes que quedó 'EN_CURSO' en Cancha 5 (ej. el organizador se fue a dormir sin cerrarlo)
  await prisma.partido.update({
    where: { id: pViernesColgado.id },
    data: {
      estado: 'EN_CURSO',
      canchaNumero: 5,
      fechaHora: dViernesNoche,
    },
  });

  // Simular activación de lluvia el sábado por la mañana reduciendo a 4 canchas
  const dSabadoLluviaE = new Date(fechaTorneo);
  dSabadoLluviaE.setDate(dSabadoLluviaE.getDate() + 1);
  dSabadoLluviaE.setHours(10, 0, 0, 0);

  // 2. Intentar reducir canchas a 4 para el sábado.
  // Con el fix de filtrado por día lógico, esto DEBE tener éxito (el partido EN_CURSO pertenece al viernes, no al sábado).
  const resReduccionSabadoE = await organizadorService.reprogramarPorReduccionCanchas(
    organizador.id,
    torneo.id,
    4,
    dSabadoLluviaE
  );
  assert.strictEqual(
    resReduccionSabadoE.canchasActivas,
    4,
    'FALLÓ TEST E: La reducción a 4 canchas del sábado fue bloqueada erróneamente por un EN_CURSO del viernes'
  );
  console.log('✅ Verificado: Partido EN_CURSO del viernes en Cancha 5 NO bloqueó la reducción a 4 canchas del sábado.');

  // 3. Contraprueba estricta: Si un partido del SÁBADO está EN_CURSO en Cancha 4 e intentamos reducir el sábado a 3 canchas,
  // la validación SÍ debe bloquear la acción.
  const pSabadoEnCurso = partidosParaTestE[0];
  const dSabadoMananaE = new Date(fechaTorneo);
  dSabadoMananaE.setDate(dSabadoMananaE.getDate() + 1);
  dSabadoMananaE.setHours(10, 0, 0, 0);

  await prisma.partido.update({
    where: { id: pSabadoEnCurso.id },
    data: {
      estado: 'EN_CURSO',
      canchaNumero: 4,
      fechaHora: dSabadoMananaE,
    },
  });

  let bloqueoExitoso = false;
  try {
    await organizadorService.reprogramarPorReduccionCanchas(
      organizador.id,
      torneo.id,
      3,
      dSabadoLluviaE
    );
  } catch (err) {
    if (err.statusCode === 400 && err.message.includes('Cancha 4')) {
      bloqueoExitoso = true;
      console.log(`✅ Verificado: Partido EN_CURSO del sábado en Cancha 4 bloqueó correctamente la reducción a 3 canchas ("${err.message}").`);
    } else {
      throw err;
    }
  }
  assert.ok(bloqueoExitoso, 'FALLÓ TEST E: No bloqueó la reducción cuando había un partido del mismo día EN_CURSO en cancha afectada');

  // Limpieza final de estados
  await prisma.partido.update({
    where: { id: pViernesColgado.id },
    data: { estado: 'FINALIZADO' },
  });
  await prisma.partido.update({
    where: { id: pSabadoEnCurso.id },
    data: { estado: 'PENDIENTE' },
  });
  await organizadorService.reprogramarPorReduccionCanchas(organizador.id, torneo.id, null);
  console.log('✅ TEST E PASÓ: Validación EN_CURSO scopeada con precisión a la jornada bajo lluvia.');

  console.log('\n🎉 TODOS LOS TESTS DE MODO DÍA DE TORNEO PASARON EXITOSAMENTE!');
  } finally {
    try {
      await limpiarPiloto();
      console.log('✓ Limpieza en finally completada para piloto@padel.com');
    } catch (e) {
      console.error('Error limpiando piloto en finally:', e);
    }
  }
}

testModoDiaTorneo()
  .catch((err) => {
    console.error('❌ Error en el test:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
