const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const disponibilidadService = require('../src/services/disponibilidad.service');
const { JWT_SECRET, PORT } = require('../src/config/env');

const BASE_URL = `http://localhost:${PORT || 3001}/api`;

async function main() {
  console.log('🧪 =============================================================');
  console.log('🧪 TEST: VERIFICACIÓN DE AUTORIZACIÓN (IDOR) EN DISPONIBILIDAD');
  console.log('🧪 =============================================================\n');

  const ts = Date.now();
  const passwordHash = await bcrypt.hash('123456', 10);

  // 1. Crear Organizador A y su torneo/pareja
  const orgA = await prisma.organizador.create({
    data: {
      nombre: 'Club A',
      email: `orgA-${ts}@test.com`,
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
      nombre: 'Torneo Club A',
      slug: `torneo-a-${ts}`,
      organizadorId: orgA.id,
    },
  });

  const catA = await prisma.categoria.create({
    data: {
      nombre: '4ta',
      torneoId: torneoA.id,
    },
  });

  const parejaA = await prisma.pareja.create({
    data: {
      categoriaId: catA.id,
      jugador1: 'Juan Ponce',
      jugador2: 'Carlos Leone',
      orden: 1,
    },
  });

  // 2. Crear Organizador B
  const orgB = await prisma.organizador.create({
    data: {
      nombre: 'Club B',
      email: `orgB-${ts}@test.com`,
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
      nombre: 'Torneo Club B',
      slug: `torneo-b-${ts}`,
      organizadorId: orgB.id,
    },
  });

  const catB = await prisma.categoria.create({
    data: {
      nombre: '4ta',
      torneoId: torneoB.id,
    },
  });

  const parejaB = await prisma.pareja.create({
    data: {
      categoriaId: catB.id,
      jugador1: 'Luis Morales',
      jugador2: 'Pedro Diaz',
      orden: 1,
    },
  });

  console.log(`✓ Creados Organizador A (${orgA.email}) y Organizador B (${orgB.email})`);
  console.log(`  Pareja A (del Club A): ${parejaA.id}`);
  console.log(`  Pareja B (del Club B): ${parejaB.id}\n`);

  // ─── PARTE 1: Pruebas a nivel de Servicio ──────────────────────────
  console.log('--- 1. Pruebas directas de Servicio ---');

  // 1.1 Org A lee y modifica su propia pareja -> DEBE FUNCIONAR
  await disponibilidadService.setDisponibilidad(orgA.id, parejaA.id, ['Viernes-14:00']);
  const slotsA = await disponibilidadService.getDisponibilidad(orgA.id, parejaA.id);
  console.log('✓ Organizador A asignó y leyó slots de Pareja A correctamente:', slotsA);

  // 1.2 Org B intenta leer Pareja A -> DEBE LANZAR 403
  try {
    await disponibilidadService.getDisponibilidad(orgB.id, parejaA.id);
    throw new Error('FALLO DE SEGURIDAD: Org B pudo leer disponibilidad de Pareja A');
  } catch (err) {
    if (err.statusCode === 403) {
      console.log('✓ [403 Bloqueado] Org B NO pudo leer Pareja A:', err.message);
    } else {
      throw err;
    }
  }

  // 1.3 Org B intenta modificar Pareja A -> DEBE LANZAR 403
  try {
    await disponibilidadService.setDisponibilidad(orgB.id, parejaA.id, ['Viernes-16:00']);
    throw new Error('FALLO DE SEGURIDAD: Org B pudo modificar disponibilidad de Pareja A');
  } catch (err) {
    if (err.statusCode === 403) {
      console.log('✓ [403 Bloqueado] Org B NO pudo modificar Pareja A:', err.message);
    } else {
      throw err;
    }
  }

  // 1.4 Org B intenta setDisponibilidadDoble involucrando Pareja A ajena -> DEBE LANZAR 403
  try {
    await disponibilidadService.setDisponibilidadDoble(orgB.id, parejaA.id, ['Viernes-18:00'], parejaB.id, ['Viernes-18:00']);
    throw new Error('FALLO DE SEGURIDAD: Org B pudo ejecutar setDisponibilidadDoble sobre Pareja A');
  } catch (err) {
    if (err.statusCode === 403) {
      console.log('✓ [403 Bloqueado] Org B NO pudo hacer resolución doble sobre Pareja A:', err.message);
    } else {
      throw err;
    }
  }

  // 1.5 ID inexistente -> DEBE LANZAR 404
  try {
    await disponibilidadService.getDisponibilidad(orgA.id, 'id-inexistente-1234');
    throw new Error('FALLO: id inexistente no retornó 404');
  } catch (err) {
    if (err.statusCode === 404) {
      console.log('✓ [404 Correcto] Pareja inexistente retorna 404:', err.message);
    } else {
      throw err;
    }
  }

  // ─── PARTE 2: Pruebas a nivel de API HTTP con JWT ───────────────────
  console.log('\n--- 2. Pruebas vía API HTTP (/api/parejas) con Tokens JWT ---');

  const tokenA = jwt.sign({ id: orgA.id, email: orgA.email }, JWT_SECRET, { expiresIn: '1h' });
  const tokenB = jwt.sign({ id: orgB.id, email: orgB.email }, JWT_SECRET, { expiresIn: '1h' });

  // 2.1 GET /api/parejas/:id/disponibilidad con Token B sobre Pareja A
  const resGetB = await fetch(`${BASE_URL}/parejas/${parejaA.id}/disponibilidad`, {
    headers: { Authorization: `Bearer ${tokenB}` },
  });
  const dataGetB = await resGetB.json();
  console.log(`HTTP GET Pareja A con Token B: Status ${resGetB.status}`, dataGetB);
  if (resGetB.status !== 403) {
    throw new Error(`FALLO DE SEGURIDAD HTTP: Se esperaba 403 pero se recibió ${resGetB.status}`);
  }

  // 2.2 PUT /api/parejas/:id/disponibilidad con Token B sobre Pareja A
  const resPutB = await fetch(`${BASE_URL}/parejas/${parejaA.id}/disponibilidad`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${tokenB}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ slots: ['Viernes-15:00'] }),
  });
  const dataPutB = await resPutB.json();
  console.log(`HTTP PUT Pareja A con Token B: Status ${resPutB.status}`, dataPutB);
  if (resPutB.status !== 403) {
    throw new Error(`FALLO DE SEGURIDAD HTTP: Se esperaba 403 pero se recibió ${resPutB.status}`);
  }

  // 2.3 PUT /api/parejas/:id/disponibilidad con Token A sobre Pareja A -> 200 OK
  const resPutA = await fetch(`${BASE_URL}/parejas/${parejaA.id}/disponibilidad`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${tokenA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ slots: ['Viernes-14:00', 'Viernes-15:15'] }),
  });
  const dataPutA = await resPutA.json();
  console.log(`HTTP PUT Pareja A con Token A (legítimo): Status ${resPutA.status}`, dataPutA);
  if (resPutA.status !== 200) {
    throw new Error(`FALLO HTTP: Se esperaba 200 pero se recibió ${resPutA.status}`);
  }

  // 3. Limpieza de datos de prueba
  await prisma.slotPareja.deleteMany({ where: { parejaId: { in: [parejaA.id, parejaB.id] } } });
  await prisma.pareja.deleteMany({ where: { id: { in: [parejaA.id, parejaB.id] } } });
  await prisma.categoria.deleteMany({ where: { id: { in: [catA.id, catB.id] } } });
  await prisma.torneo.deleteMany({ where: { id: { in: [torneoA.id, torneoB.id] } } });
  await prisma.organizador.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });

  console.log('\n🎉 ¡TODOS LOS TESTS DE AUTORIZACIÓN (IDOR) PASARON EXITOSAMENTE!');
}

main()
  .catch((e) => {
    console.error('❌ Error en test de autorización:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
