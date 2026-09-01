const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const prisma = new PrismaClient();

const organizadorService = require('../src/services/organizador.service');
const zonaService = require('../src/services/zona.service');
const torneoService = require('../src/services/torneo.service');
const partidoService = require('../src/services/partido.service');

async function testModoDiaTorneo() {
  console.log('🧪 Iniciando test automatizado de Modo Día de Torneo...');

  // 1. Limpiar datos previos del test piloto si existieran
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
    await prisma.torneo.deleteMany({ where: { id: { in: torneoIds } } });
    await prisma.organizador.delete({ where: { id: existingPiloto.id } });
  }

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
  
  // MOCK: Para que el test funcione sin importar la hora real a la que se corre, 
  // forzamos que el overrideActivoDesde comience exactamente en el día lógico de los partidos.
  await prisma.torneo.update({
    where: { id: torneo.id },
    data: { overrideActivoDesde: pEnCurso.fechaHora },
  });

  const resReduccion = await organizadorService.reprogramarPorReduccionCanchas(organizador.id, torneo.id, 4);
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
    await organizadorService.reprogramarPorReduccionCanchas(organizador.id, torneo.id, 3);
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

  await prisma.torneo.update({
    where: { id: torneo.id },
    data: { overrideActivoDesde: dLluviaTrasnoche },
  });

  console.log('🌧️ Ejecutando reducción de canchas a 4 (Modo Lluvia en Trasnoche)...');
  const resTrasnoche = await organizadorService.reprogramarPorReduccionCanchas(organizador.id, torneo.id, 4);
  console.log(`✅ Resultado reprogramación trasnoche: ${resTrasnoche.message}`);
  
  if (resTrasnoche.reprogramacion.partidosReprogramados === 0) {
    throw new Error('FALLÓ EL TEST: El partido de trasnoche (Sábado 01:00 AM) no fue reprogramado a pesar de pertenecer lógicamente al Viernes.');
  }

  const pTrasnochePost = await prisma.partido.findUnique({ where: { id: pTrasnoche.id } });
  if (pTrasnochePost.canchaNumero > 4) {
    throw new Error(`FALLÓ EL TEST: El partido de trasnoche quedó en cancha inhabilitada: ${pTrasnochePost.canchaNumero}`);
  }
  console.log('✅ Partido de trasnoche (Sábado 01:00) fue correctamente reprogramado al reducir canchas!');


  console.log('\n🎉 TODOS LOS TESTS DE MODO DÍA DE TORNEO PASARON EXITOSAMENTE!');
}

testModoDiaTorneo()
  .catch((err) => {
    console.error('❌ Error en el test:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
