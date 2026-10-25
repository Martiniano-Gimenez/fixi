const { ensureTestDb } = require('./utils/testEnvGuard');
const { startTestServer } = require('./utils/testServer');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const disponibilidadService = require('../src/services/disponibilidad.service');
const { JWT_SECRET } = require('../src/config/env');

let serverInstance = null;

async function main() {
  await ensureTestDb();
  const { server, baseUrl } = await startTestServer();
  serverInstance = server;
  const BASE_URL = baseUrl;
  console.log('🧪 =============================================================');
  console.log('🧪 TEST: REGRESIÓN GUARD DISPONIBILIDAD (BORRADOR vs NO-BORRADOR)');
  console.log('🧪 =============================================================\n');

  const ts = Date.now();
  const passwordHash = await bcrypt.hash('123456', 10);

  // 1. Crear Organizador A y B con sus categorías y parejas
  const orgA = await prisma.organizador.create({
    data: {
      nombre: 'Club Test Guard A',
      email: `guardA-${ts}@test.com`,
      passwordHash,
      cantidadCanchas: 2,
      viernesInicio: '14:00',
      viernesFin: '22:00',
      sabadoInicio: '09:00',
      sabadoFin: '22:00',
    },
  });

  const torneoA = await prisma.torneo.create({
    data: {
      nombre: 'Torneo Guard A',
      slug: `torneo-guard-a-${ts}`,
      organizadorId: orgA.id,
      estado: 'BORRADOR',
    },
  });

  const catA = await prisma.categoria.create({
    data: {
      nombre: '4ta Guard',
      torneoId: torneoA.id,
      estado: 'BORRADOR',
    },
  });

  const parejaA1 = await prisma.pareja.create({
    data: {
      categoriaId: catA.id,
      jugador1: 'A1_Jugador1',
      jugador2: 'A1_Jugador2',
      orden: 1,
    },
  });

  const parejaA2 = await prisma.pareja.create({
    data: {
      categoriaId: catA.id,
      jugador1: 'A2_Jugador1',
      jugador2: 'A2_Jugador2',
      orden: 2,
    },
  });

  // Organizador B ajeno
  const orgB = await prisma.organizador.create({
    data: {
      nombre: 'Club Test Guard B',
      email: `guardB-${ts}@test.com`,
      passwordHash,
      cantidadCanchas: 2,
      viernesInicio: '14:00',
      viernesFin: '22:00',
      sabadoInicio: '09:00',
      sabadoFin: '22:00',
    },
  });

  const torneoB = await prisma.torneo.create({
    data: {
      nombre: 'Torneo Guard B',
      slug: `torneo-guard-b-${ts}`,
      organizadorId: orgB.id,
      estado: 'BORRADOR',
    },
  });

  const catB = await prisma.categoria.create({
    data: {
      nombre: '4ta Guard B',
      torneoId: torneoB.id,
      estado: 'BORRADOR',
    },
  });

  const parejaB1 = await prisma.pareja.create({
    data: {
      categoriaId: catB.id,
      jugador1: 'B1_Jugador1',
      jugador2: 'B1_Jugador2',
      orden: 1,
    },
  });

  const tokenA = jwt.sign({ id: orgA.id, email: orgA.email }, JWT_SECRET, { expiresIn: '1h' });
  const tokenB = jwt.sign({ id: orgB.id, email: orgB.email }, JWT_SECRET, { expiresIn: '1h' });

  let exitCode = 0;

  try {
    // ─── FASE 1: BORRADOR (Edición Permitida) ─────────────────────────
    console.log('--- FASE 1: BORRADOR (Operaciones deben ser exitosas 200 OK) ---');

    // 1.1 setDisponibilidad simple (Service)
    const resServ1 = await disponibilidadService.setDisponibilidad(orgA.id, parejaA1.id, ['Viernes-14:00', 'Viernes-14:15']);
    if (resServ1.length !== 2) throw new Error('Fallo setDisponibilidad en BORRADOR a nivel servicio');
    console.log('✓ 1.1 setDisponibilidad a nivel service en BORRADOR exitoso:', resServ1);

    // 1.2 setDisponibilidad HTTP
    const httpPutBorrador = await fetch(`${BASE_URL}/parejas/${parejaA1.id}/disponibilidad`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ slots: ['Viernes-14:00', 'Viernes-14:15', 'Viernes-14:30'] }),
    });
    if (httpPutBorrador.status !== 200) throw new Error(`HTTP PUT esperado 200 en BORRADOR, recibido: ${httpPutBorrador.status}`);
    const dataPutBorrador = await httpPutBorrador.json();
    console.log(`✓ 1.2 HTTP PUT /api/parejas/:id/disponibilidad en BORRADOR -> 200 OK (${dataPutBorrador.length} slots)`);

    // 1.3 setDisponibilidadDoble HTTP
    const httpDobleBorrador = await fetch(`${BASE_URL}/parejas/disponibilidad-doble`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parejaId1: parejaA1.id,
        slotsToAdd1: ['Viernes-15:00'],
        parejaId2: parejaA2.id,
        slotsToAdd2: ['Viernes-15:00'],
      }),
    });
    if (httpDobleBorrador.status !== 200) throw new Error(`HTTP PUT doble esperado 200 en BORRADOR, recibido: ${httpDobleBorrador.status}`);
    console.log('✓ 1.3 HTTP PUT /api/parejas/disponibilidad-doble en BORRADOR -> 200 OK');

    // 1.4 removerDisponibilidadDoble HTTP
    const httpRemoverBorrador = await fetch(`${BASE_URL}/parejas/disponibilidad-doble/remover`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parejaId1: parejaA1.id,
        slotsToRemove1: ['Viernes-15:00'],
        parejaId2: parejaA2.id,
        slotsToRemove2: ['Viernes-15:00'],
      }),
    });
    if (httpRemoverBorrador.status !== 200) throw new Error(`HTTP POST remover esperado 200 en BORRADOR, recibido: ${httpRemoverBorrador.status}`);
    console.log('✓ 1.4 HTTP POST /api/parejas/disponibilidad-doble/remover en BORRADOR -> 200 OK');

    // ─── FASE 2: EN_CURSO (Edición Bloqueada 400, Lectura Permitida 200) ───
    console.log('\n--- FASE 2: EN_CURSO (Edición bloqueada HTTP 400, Lectura permitida) ---');
    await prisma.categoria.update({ where: { id: catA.id }, data: { estado: 'EN_CURSO' } });

    // 2.1 setDisponibilidad simple debe rechazar con 400
    const httpPutEnCurso = await fetch(`${BASE_URL}/parejas/${parejaA1.id}/disponibilidad`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ slots: ['Viernes-16:00'] }),
    });
    const errPutEnCurso = await httpPutEnCurso.json();
    if (httpPutEnCurso.status !== 400) throw new Error(`Esperado 400 en EN_CURSO, recibido: ${httpPutEnCurso.status}`);
    if (!errPutEnCurso.error.includes('reprogramá el partido')) throw new Error(`Mensaje inesperado: ${errPutEnCurso.error}`);
    console.log('✓ 2.1 HTTP PUT disponibilidad en EN_CURSO -> 400 Bloqueado:', errPutEnCurso.error);

    // 2.2 setDisponibilidadDoble debe rechazar con 400
    const httpDobleEnCurso = await fetch(`${BASE_URL}/parejas/disponibilidad-doble`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parejaId1: parejaA1.id,
        slotsToAdd1: ['Viernes-16:00'],
        parejaId2: parejaA2.id,
        slotsToAdd2: ['Viernes-16:00'],
      }),
    });
    const errDobleEnCurso = await httpDobleEnCurso.json();
    if (httpDobleEnCurso.status !== 400) throw new Error(`Esperado 400 en doble EN_CURSO, recibido: ${httpDobleEnCurso.status}`);
    console.log('✓ 2.2 HTTP PUT disponibilidad-doble en EN_CURSO -> 400 Bloqueado:', errDobleEnCurso.error);

    // 2.3 removerDisponibilidadDoble debe rechazar con 400
    const httpRemoverEnCurso = await fetch(`${BASE_URL}/parejas/disponibilidad-doble/remover`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parejaId1: parejaA1.id,
        slotsToRemove1: ['Viernes-14:00'],
        parejaId2: parejaA2.id,
        slotsToRemove2: ['Viernes-14:00'],
      }),
    });
    const errRemoverEnCurso = await httpRemoverEnCurso.json();
    if (httpRemoverEnCurso.status !== 400) throw new Error(`Esperado 400 en remover EN_CURSO, recibido: ${httpRemoverEnCurso.status}`);
    console.log('✓ 2.3 HTTP POST disponibilidad-doble/remover en EN_CURSO -> 400 Bloqueado:', errRemoverEnCurso.error);

    // 2.4 Lectura GET en EN_CURSO debe seguir funcionando (para vista solo lectura)
    const httpGetEnCurso = await fetch(`${BASE_URL}/parejas/${parejaA1.id}/disponibilidad`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    if (httpGetEnCurso.status !== 200) throw new Error(`Esperado 200 en GET EN_CURSO, recibido: ${httpGetEnCurso.status}`);
    const dataGetEnCurso = await httpGetEnCurso.json();
    console.log(`✓ 2.4 HTTP GET disponibilidad en EN_CURSO -> 200 OK (devuelve ${dataGetEnCurso.length} slots declarados)`);

    // 2.5 Multitenant en EN_CURSO debe devolver 403 (prioridad de autorización)
    const httpPutEnCursoAjeno = await fetch(`${BASE_URL}/parejas/${parejaA1.id}/disponibilidad`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokenB}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ slots: ['Viernes-18:00'] }),
    });
    if (httpPutEnCursoAjeno.status !== 403) throw new Error(`Esperado 403 para organizador ajeno en EN_CURSO, recibido: ${httpPutEnCursoAjeno.status}`);
    console.log('✓ 2.5 HTTP PUT de Organizador B sobre Pareja A en EN_CURSO -> 403 Forbidden preservado');

    // ─── FASE 3: FINALIZADO (Edición Bloqueada 400, Lectura Permitida 200) ──
    console.log('\n--- FASE 3: FINALIZADO (Edición bloqueada HTTP 400, Lectura permitida) ---');
    await prisma.categoria.update({ where: { id: catA.id }, data: { estado: 'FINALIZADO' } });

    // 3.1 setDisponibilidad simple debe rechazar con 400
    const httpPutFin = await fetch(`${BASE_URL}/parejas/${parejaA1.id}/disponibilidad`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ slots: ['Viernes-18:00'] }),
    });
    if (httpPutFin.status !== 400) throw new Error(`Esperado 400 en FINALIZADO, recibido: ${httpPutFin.status}`);
    console.log('✓ 3.1 HTTP PUT disponibilidad en FINALIZADO -> 400 Bloqueado');

    // 3.2 setDisponibilidadDoble debe rechazar con 400
    const httpDobleFin = await fetch(`${BASE_URL}/parejas/disponibilidad-doble`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parejaId1: parejaA1.id,
        slotsToAdd1: ['Viernes-18:00'],
        parejaId2: parejaA2.id,
        slotsToAdd2: ['Viernes-18:00'],
      }),
    });
    if (httpDobleFin.status !== 400) throw new Error(`Esperado 400 en doble FINALIZADO, recibido: ${httpDobleFin.status}`);
    console.log('✓ 3.2 HTTP PUT disponibilidad-doble en FINALIZADO -> 400 Bloqueado');

    // 3.3 removerDisponibilidadDoble debe rechazar con 400
    const httpRemoverFin = await fetch(`${BASE_URL}/parejas/disponibilidad-doble/remover`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parejaId1: parejaA1.id,
        slotsToRemove1: ['Viernes-14:00'],
        parejaId2: parejaA2.id,
        slotsToRemove2: ['Viernes-14:00'],
      }),
    });
    if (httpRemoverFin.status !== 400) throw new Error(`Esperado 400 en remover FINALIZADO, recibido: ${httpRemoverFin.status}`);
    console.log('✓ 3.3 HTTP POST disponibilidad-doble/remover en FINALIZADO -> 400 Bloqueado');

    // 3.4 Lectura GET en FINALIZADO debe seguir funcionando
    const httpGetFin = await fetch(`${BASE_URL}/parejas/${parejaA1.id}/disponibilidad`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    if (httpGetFin.status !== 200) throw new Error(`Esperado 200 en GET FINALIZADO, recibido: ${httpGetFin.status}`);
    console.log('✓ 3.4 HTTP GET disponibilidad en FINALIZADO -> 200 OK');

    // 3.5 Multitenant en FINALIZADO -> 403
    const httpPutFinAjeno = await fetch(`${BASE_URL}/parejas/${parejaA1.id}/disponibilidad`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokenB}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ slots: ['Viernes-18:00'] }),
    });
    if (httpPutFinAjeno.status !== 403) throw new Error(`Esperado 403 en FINALIZADO para ajeno, recibido: ${httpPutFinAjeno.status}`);
    console.log('✓ 3.5 HTTP PUT Organizador B en FINALIZADO -> 403 Forbidden preservado');

    console.log('\n🎉 ¡TODAS LAS VALIDACIONES DE REGRESIÓN DE DISPONIBILIDAD PASARON EXITOSAMENTE!');
  } catch (err) {
    // Sin este catch, el process.exit(0) del finally tapaba cualquier falla de la suite
    console.error('❌ Error en test-disponibilidad-guard:', err);
    exitCode = 1;
  } finally {
    // Limpieza de datos de prueba
    await prisma.slotPareja.deleteMany({ where: { parejaId: { in: [parejaA1.id, parejaA2.id, parejaB1.id] } } });
    await prisma.pareja.deleteMany({ where: { id: { in: [parejaA1.id, parejaA2.id, parejaB1.id] } } });
    await prisma.categoria.deleteMany({ where: { id: { in: [catA.id, catB.id] } } });
    await prisma.torneo.deleteMany({ where: { id: { in: [torneoA.id, torneoB.id] } } });
    await prisma.organizador.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
    if (serverInstance) {
      await new Promise((resolve) => serverInstance.close(resolve));
    }
    await prisma.$disconnect();
    process.exit(exitCode);
  }
}

main().catch((err) => {
  console.error('❌ Error en test-disponibilidad-guard:', err);
  process.exit(1);
});
