const { ensureTestDb } = require('./utils/testEnvGuard');
const { startTestServer } = require('./utils/testServer');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const torneoService = require('../src/services/torneo.service');
const { JWT_SECRET } = require('../src/config/env');

let serverInstance = null;

async function main() {
  await ensureTestDb();
  const { server, baseUrl } = await startTestServer();
  serverInstance = server;
  const BASE_URL = baseUrl;
  console.log('🧪 ==============================================================');
  console.log('🧪 TEST: REGRESIÓN DE GUARD DE FECHA DE TORNEO (ESTADO BORRADOR)');
  console.log('🧪 ==============================================================\n');

  const ts = Date.now();
  const passwordHash = await bcrypt.hash('123456', 10);

  // 1. Crear Organizadores y Torneos de prueba aislados
  const orgA = await prisma.organizador.create({
    data: {
      nombre: `Org A Guard Test ${ts}`,
      email: `orga-guard-${ts}@test.com`,
      passwordHash,
      cantidadCanchas: 2,
    },
  });

  const orgB = await prisma.organizador.create({
    data: {
      nombre: `Org B Guard Test ${ts}`,
      email: `orgb-guard-${ts}@test.com`,
      passwordHash,
      cantidadCanchas: 2,
    },
  });

  const tokenA = jwt.sign({ id: orgA.id, email: orgA.email }, JWT_SECRET, { expiresIn: '1h' });
  const tokenB = jwt.sign({ id: orgB.id, email: orgB.email }, JWT_SECRET, { expiresIn: '1h' });

  let torneoA = await prisma.torneo.create({
    data: {
      nombre: 'Torneo Guard Test',
      slug: `torneo-guard-${ts}`,
      organizadorId: orgA.id,
      estado: 'BORRADOR',
      fecha: new Date(2026, 7, 14, 12, 0, 0), // 14 de agosto de 2026
    },
  });

  try {
    // -------------------------------------------------------------
    // CASO 0: CREACIÓN: Validaciones de fecha obligatoria y válida
    // -------------------------------------------------------------
    console.log('--- 0. CREACIÓN: Validaciones de fecha obligatoria ---');

    // 0.1 Crear sin fecha (null) -> 400
    try {
      await torneoService.createTorneo(orgA.id, { nombre: 'Torneo Sin Fecha', fecha: null });
      throw new Error('FALLO: createTorneo debió lanzar error 400 al crear sin fecha');
    } catch (err) {
      if (err.statusCode !== 400 || !err.message.includes('obligatoria')) {
        throw new Error(`FALLO: Error inesperado al crear sin fecha: ${err.message} (status: ${err.statusCode})`);
      }
      console.log('  ✓ [createTorneo] Sin fecha rechazada con 400:', err.message);
    }

    // 0.2 Crear con fecha vacía ("") -> 400
    try {
      await torneoService.createTorneo(orgA.id, { nombre: 'Torneo Fecha Vacía', fecha: '   ' });
      throw new Error('FALLO: createTorneo debió lanzar error 400 con fecha en blanco');
    } catch (err) {
      if (err.statusCode !== 400 || !err.message.includes('obligatoria')) {
        throw new Error(`FALLO: Error inesperado con fecha vacía: ${err.message} (status: ${err.statusCode})`);
      }
      console.log('  ✓ [createTorneo] Fecha vacía rechazada con 400:', err.message);
    }

    // 0.3 Crear con fecha inválida -> 400
    try {
      await torneoService.createTorneo(orgA.id, { nombre: 'Torneo Fecha Inválida', fecha: 'fecha-invalida' });
      throw new Error('FALLO: createTorneo debió lanzar error 400 con fecha inválida');
    } catch (err) {
      if (err.statusCode !== 400 || !err.message.includes('válida')) {
        throw new Error(`FALLO: Error inesperado con fecha inválida: ${err.message} (status: ${err.statusCode})`);
      }
      console.log('  ✓ [createTorneo] Fecha inválida rechazada con 400:', err.message);
    }

    // 0.4 Crear con fecha válida -> OK y fecha guardada es el mediodía local
    const torneoValido = await torneoService.createTorneo(orgA.id, {
      nombre: 'Torneo Válido Test',
      fecha: '2026-10-09',
    });
    console.log('  ✓ [createTorneo] Torneo creado con fecha válida:', torneoValido.id);
    const dValida = new Date(torneoValido.fecha);
    if (
      dValida.getFullYear() !== 2026 ||
      dValida.getMonth() !== 9 || // Octubre (base 0)
      dValida.getDate() !== 9 ||
      dValida.getHours() !== 12 ||
      dValida.getMinutes() !== 0
    ) {
      throw new Error(`FALLO: La fecha guardada no es el mediodía local (12:00:00) del día elegido: ${dValida.toString()}`);
    }
    console.log('  ✓ [createTorneo] Fecha guardada confirmada al mediodía local:', dValida.toString());
    await prisma.torneo.delete({ where: { id: torneoValido.id } });

    // -------------------------------------------------------------
    // CASO 1: BORRADOR -> Edición de fecha y preservación
    // -------------------------------------------------------------
    console.log('\n--- 1. BORRADOR: Edición de fecha y validaciones ---');

    // 1.1 Cambiar fecha a 21 de agosto
    const resBorradorCambio = await torneoService.updateTorneo(orgA.id, torneoA.id, {
      fecha: '2026-08-21',
    });
    console.log('  ✓ [Service] Cambiar fecha en BORRADOR: OK (nueva fecha:', resBorradorCambio.fecha?.toISOString().slice(0, 10), ')');
    if (!resBorradorCambio.fecha || resBorradorCambio.fecha.getDate() !== 21) {
      throw new Error('FALLO: La fecha no se actualizó a 2026-08-21');
    }

    // 1.2 Editar solo el NOMBRE sin tocar la fecha -> OK y fecha preservada
    const resEditarSoloNombre = await torneoService.updateTorneo(orgA.id, torneoA.id, {
      nombre: 'Torneo Guard Test Nombre Modificado',
    });
    if (resEditarSoloNombre.nombre !== 'Torneo Guard Test Nombre Modificado') {
      throw new Error('FALLO: El nombre no se actualizó');
    }
    if (!resEditarSoloNombre.fecha || resEditarSoloNombre.fecha.getDate() !== 21) {
      throw new Error('FALLO: La fecha no se preservó al editar solo el nombre');
    }
    console.log('  ✓ [Service] Editar nombre sin tocar la fecha: OK (fecha preservada)');

    // 1.3 Editar fecha a vacío (null) en BORRADOR -> Debe lanzar 400
    try {
      await torneoService.updateTorneo(orgA.id, torneoA.id, {
        fecha: null,
      });
      throw new Error('FALLO: updateTorneo debió lanzar error 400 al vaciar fecha a null en BORRADOR');
    } catch (err) {
      if (err.statusCode !== 400 || !err.message.includes('obligatoria')) {
        throw new Error(`FALLO: Error inesperado al vaciar fecha en BORRADOR: ${err.message} (status: ${err.statusCode})`);
      }
      console.log('  ✓ [Service] Rechazo al vaciar fecha a null en BORRADOR (400):', err.message);
    }

    // 1.4 Editar fecha a string vacío ("") en BORRADOR -> Debe lanzar 400
    try {
      await torneoService.updateTorneo(orgA.id, torneoA.id, {
        fecha: '',
      });
      throw new Error('FALLO: updateTorneo debió lanzar error 400 al vaciar fecha a string vacío en BORRADOR');
    } catch (err) {
      if (err.statusCode !== 400 || !err.message.includes('obligatoria')) {
        throw new Error(`FALLO: Error inesperado al vaciar fecha con string vacío: ${err.message} (status: ${err.statusCode})`);
      }
      console.log('  ✓ [Service] Rechazo al vaciar fecha a string vacío en BORRADOR (400):', err.message);
    }

    // 1.5 Asignar fecha previa al inicio
    await torneoService.updateTorneo(orgA.id, torneoA.id, {
      fecha: '2026-08-14',
    });

    // -------------------------------------------------------------
    // CASO 2: EN_CURSO -> Bloqueo de fecha, preservación de nombre
    // -------------------------------------------------------------
    console.log('\n--- 2. EN_CURSO: Bloqueo de cambio de fecha ---');
    await prisma.torneo.update({
      where: { id: torneoA.id },
      data: { estado: 'EN_CURSO' },
    });

    // 2.1 Intentar cambiar fecha en EN_CURSO vía Service -> Debe lanzar 400
    try {
      await torneoService.updateTorneo(orgA.id, torneoA.id, {
        fecha: '2026-08-28',
      });
      throw new Error('FALLO: updateTorneo debió lanzar error 400 al cambiar fecha en EN_CURSO');
    } catch (err) {
      if (err.statusCode !== 400 || !err.message.includes('No se puede modificar la fecha')) {
        throw new Error(`FALLO: Error inesperado en service: ${err.message} (status: ${err.statusCode})`);
      }
      console.log('  ✓ [Service] Bloqueo cambio fecha en EN_CURSO (400):', err.message);
    }

    // 2.2 Intentar vaciar fecha (null) en EN_CURSO vía Service -> Debe lanzar 400
    try {
      await torneoService.updateTorneo(orgA.id, torneoA.id, {
        fecha: null,
      });
      throw new Error('FALLO: updateTorneo debió lanzar error 400 al vaciar fecha en EN_CURSO');
    } catch (err) {
      if (err.statusCode !== 400 || !err.message.includes('No se puede modificar la fecha')) {
        throw new Error(`FALLO: Error inesperado en service al vaciar fecha: ${err.message}`);
      }
      console.log('  ✓ [Service] Bloqueo vaciado de fecha en EN_CURSO (400):', err.message);
    }

    // 2.3 Enviar la MISMA fecha en EN_CURSO -> NO debe bloquear
    await torneoService.updateTorneo(orgA.id, torneoA.id, {
      fecha: '2026-08-14',
    });
    console.log('  ✓ [Service] Enviar la misma fecha en EN_CURSO: OK (no bloquea)');

    // 2.4 Cambiar solo el NOMBRE en EN_CURSO -> NO debe bloquear
    const resSoloNombre = await torneoService.updateTorneo(orgA.id, torneoA.id, {
      nombre: 'Torneo Guard Test Renombrado',
    });
    console.log('  ✓ [Service] Cambiar solo el nombre en EN_CURSO: OK (nombre actualizado:', resSoloNombre.nombre, ')');
    if (resSoloNombre.nombre !== 'Torneo Guard Test Renombrado') {
      throw new Error('FALLO: El nombre no se actualizó');
    }

    // 2.5 Prueba HTTP vía API endpoint PUT /api/torneos/:id
    const resHttpChangeDate = await fetch(`${BASE_URL}/torneos/${torneoA.id}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${tokenA}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fecha: '2026-08-28' }),
    });
    const dataHttpChangeDate = await resHttpChangeDate.json();
    console.log(`  ✓ [HTTP PUT] Intento cambio de fecha en EN_CURSO: Status ${resHttpChangeDate.status} - Mensaje: "${dataHttpChangeDate.error || dataHttpChangeDate.message}"`);
    if (resHttpChangeDate.status !== 400) {
      throw new Error(`FALLO HTTP: Se esperaba status 400 pero se recibió ${resHttpChangeDate.status}`);
    }

    // -------------------------------------------------------------
    // CASO 3: FINALIZADO -> Bloqueo de fecha
    // -------------------------------------------------------------
    console.log('\n--- 3. FINALIZADO: Bloqueo de cambio de fecha ---');
    await prisma.torneo.update({
      where: { id: torneoA.id },
      data: { estado: 'FINALIZADO' },
    });

    try {
      await torneoService.updateTorneo(orgA.id, torneoA.id, {
        fecha: '2026-09-04',
      });
      throw new Error('FALLO: updateTorneo debió lanzar error 400 al cambiar fecha en FINALIZADO');
    } catch (err) {
      if (err.statusCode !== 400 || !err.message.includes('No se puede modificar la fecha')) {
        throw new Error(`FALLO: Error inesperado en service en FINALIZADO: ${err.message}`);
      }
      console.log('  ✓ [Service] Bloqueo cambio fecha en FINALIZADO (400):', err.message);
    }

    // -------------------------------------------------------------
    // CASO 4: reiniciarTorneo -> Vuelve a BORRADOR y la fecha es editable
    // -------------------------------------------------------------
    console.log('\n--- 4. reiniciarTorneo: Vuelve a BORRADOR y fecha reactivada ---');
    await torneoService.reiniciarTorneo(orgA.id, torneoA.id);

    const torneoReiniciado = await prisma.torneo.findUnique({ where: { id: torneoA.id } });
    if (torneoReiniciado.estado !== 'BORRADOR') {
      throw new Error(`FALLO: El torneo debió volver a BORRADOR pero tiene estado ${torneoReiniciado.estado}`);
    }
    console.log('  ✓ Estado verificado post-reinicio:', torneoReiniciado.estado);

    const resPostReinicio = await torneoService.updateTorneo(orgA.id, torneoA.id, {
      fecha: '2026-09-18',
    });
    console.log('  ✓ [Service] Edición de fecha post-reinicio: OK (fecha:', resPostReinicio.fecha?.toISOString().slice(0, 10), ')');
    if (!resPostReinicio.fecha || resPostReinicio.fecha.getDate() !== 18) {
      throw new Error('FALLO: No se pudo editar la fecha tras reiniciar el torneo');
    }

    // -------------------------------------------------------------
    // CASO 5: MULTITENANT -> Acceso cruzado denegado
    // -------------------------------------------------------------
    console.log('\n--- 5. Multitenant: Organizador ajeno no puede editar ---');

    // 5.1 Service: Org B intentando editar Torneo A -> 403 Forbidden
    try {
      await torneoService.updateTorneo(orgB.id, torneoA.id, { fecha: '2026-09-25' });
      throw new Error('FALLO: Org B debió ser rechazado al intentar editar torneo de Org A');
    } catch (err) {
      if (err.statusCode !== 403) {
        throw new Error(`FALLO: Se esperaba 403 en multitenant service, recibido ${err.statusCode}`);
      }
      console.log('  ✓ [Service] Multitenant: Org B rechazado con 403:', err.message);
    }

    // 5.2 HTTP: Org B con token B sobre Torneo A -> 403 Forbidden
    const resHttpMultitenant = await fetch(`${BASE_URL}/torneos/${torneoA.id}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${tokenB}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fecha: '2026-09-25' }),
    });
    console.log(`  ✓ [HTTP PUT] Multitenant: Token B sobre Torneo A rechazado con Status ${resHttpMultitenant.status}`);
    if (resHttpMultitenant.status !== 403) {
      throw new Error(`FALLO HTTP: Se esperaba 403 pero se recibió ${resHttpMultitenant.status}`);
    }

  } finally {
    // Limpieza de datos de prueba
    console.log('\n🧹 Limpiando datos de prueba...');
    await prisma.torneo.deleteMany({ where: { organizadorId: { in: [orgA.id, orgB.id] } } });
    await prisma.organizador.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
    console.log('🧹 Limpieza finalizada.');
  }

  console.log('\n🎉 ¡TODOS LOS TESTS DEL GUARD DE FECHA PASARON EXITOSAMENTE!');
}

main()
  .catch((e) => {
    console.error('❌ Error en test de guard de fecha:', e);
    process.exit(1);
  })
  .finally(async () => {
    if (serverInstance) {
      await new Promise((resolve) => serverInstance.close(resolve));
    }
    await prisma.$disconnect();
    process.exit(0);
  });
