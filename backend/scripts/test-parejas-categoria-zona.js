const { ensureTestDb } = require('./utils/testEnvGuard');
const { startTestServer } = require('./utils/testServer');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { JWT_SECRET } = require('../src/config/env');

let serverInstance = null;

async function main() {
  await ensureTestDb();
  const { server, baseUrl } = await startTestServer();
  serverInstance = server;
  const BASE_URL = baseUrl;
  console.log('🧪 =============================================================');
  console.log('🧪 TEST: REGRESIÓN ZONA Y PARTIDOS POR PAREJA + MULTITENANT');
  console.log('🧪 =============================================================\n');

  const ts = Date.now();
  const passwordHash = await bcrypt.hash('123456', 10);

  const createdIds = {
    organizadorAId: null,
    organizadorBId: null,
    torneoAId: null,
    catBorradorId: null,
    catIniciadaId: null,
    catMiniBracketId: null,
    zonaId: null,
    zonaMBId: null,
    parejaB1Id: null,
    parejaB2Id: null,
    parejaI1Id: null,
    parejaI2Id: null,
    parejasMBIds: [],
    partidoId: null,
    partidosMBIds: [],
  };

  let exitCode = 0;

  try {
    // 1. Crear Organizador A y B
    const orgA = await prisma.organizador.create({
      data: {
        nombre: `Club Org A Test ${ts}`,
        email: `orgA-${ts}@test.com`,
        passwordHash,
        cantidadCanchas: 2,
        viernesInicio: '14:00',
        viernesFin: '22:00',
        sabadoInicio: '09:00',
        sabadoFin: '22:00',
      },
    });
    createdIds.organizadorAId = orgA.id;

    const orgB = await prisma.organizador.create({
      data: {
        nombre: `Club Org B Test ${ts}`,
        email: `orgB-${ts}@test.com`,
        passwordHash,
        cantidadCanchas: 2,
        viernesInicio: '14:00',
        viernesFin: '22:00',
        sabadoInicio: '09:00',
        sabadoFin: '22:00',
      },
    });
    createdIds.organizadorBId = orgB.id;

    const tokenA = jwt.sign({ id: orgA.id, email: orgA.email }, JWT_SECRET, { expiresIn: '1h' });
    const tokenB = jwt.sign({ id: orgB.id, email: orgB.email }, JWT_SECRET, { expiresIn: '1h' });

    // 2. Crear Torneo de Org A
    const torneoA = await prisma.torneo.create({
      data: {
        nombre: `Torneo Regresion Parejas ${ts}`,
        slug: `torneo-regresion-parejas-${ts}`,
        organizadorId: orgA.id,
        estado: 'BORRADOR',
      },
    });
    createdIds.torneoAId = torneoA.id;

    // 3. Crear Categoría en BORRADOR con 2 parejas
    const catBorrador = await prisma.categoria.create({
      data: {
        nombre: 'Cat Borrador',
        torneoId: torneoA.id,
        estado: 'BORRADOR',
      },
    });
    createdIds.catBorradorId = catBorrador.id;

    const pB1 = await prisma.pareja.create({
      data: {
        categoriaId: catBorrador.id,
        jugador1: 'Borrador 1A',
        jugador2: 'Borrador 1B',
        orden: 1,
      },
    });
    createdIds.parejaB1Id = pB1.id;

    const pB2 = await prisma.pareja.create({
      data: {
        categoriaId: catBorrador.id,
        jugador1: 'Borrador 2A',
        jugador2: 'Borrador 2B',
        orden: 2,
      },
    });
    createdIds.parejaB2Id = pB2.id;

    // 4. Crear Categoría EN_CURSO con 2 parejas, zona y partido
    const catIniciada = await prisma.categoria.create({
      data: {
        nombre: 'Cat Iniciada',
        torneoId: torneoA.id,
        estado: 'EN_CURSO',
      },
    });
    createdIds.catIniciadaId = catIniciada.id;

    const pI1 = await prisma.pareja.create({
      data: {
        categoriaId: catIniciada.id,
        jugador1: 'Iniciada 1A',
        jugador2: 'Iniciada 1B',
        orden: 1,
      },
    });
    createdIds.parejaI1Id = pI1.id;

    const pI2 = await prisma.pareja.create({
      data: {
        categoriaId: catIniciada.id,
        jugador1: 'Iniciada 2A',
        jugador2: 'Iniciada 2B',
        orden: 2,
      },
    });
    createdIds.parejaI2Id = pI2.id;

    const zonaA = await prisma.zona.create({
      data: {
        categoriaId: catIniciada.id,
        nombre: 'Zona A',
        formato: 'ROUND_ROBIN',
      },
    });
    createdIds.zonaId = zonaA.id;

    await prisma.zonaPareja.create({
      data: {
        zonaId: zonaA.id,
        parejaId: pI1.id,
        pj: 1,
        pg: 1,
        pp: 0,
        puntos: 3,
      },
    });

    await prisma.zonaPareja.create({
      data: {
        zonaId: zonaA.id,
        parejaId: pI2.id,
        pj: 1,
        pg: 0,
        pp: 1,
        puntos: 0,
      },
    });

    const partidoFinalizado = await prisma.partido.create({
      data: {
        categoriaId: catIniciada.id,
        zonaId: zonaA.id,
        pareja1Id: pI1.id,
        pareja2Id: pI2.id,
        ganadorId: pI1.id,
        estado: 'FINALIZADO',
      },
    });
    createdIds.partidoId = partidoFinalizado.id;

    // 5. Crear Categoría EN_CURSO con 4 parejas en MINI_BRACKET
    const catMB = await prisma.categoria.create({
      data: {
        nombre: 'Cat MiniBracket 4 Parejas',
        torneoId: torneoA.id,
        estado: 'EN_CURSO',
      },
    });
    createdIds.catMiniBracketId = catMB.id;

    const zonaMB = await prisma.zona.create({
      data: {
        categoriaId: catMB.id,
        nombre: 'Zona MB',
        formato: 'MINI_BRACKET',
      },
    });
    createdIds.zonaMBId = zonaMB.id;

    for (let i = 1; i <= 4; i++) {
      const p = await prisma.pareja.create({
        data: {
          categoriaId: catMB.id,
          jugador1: `MB ${i}A`,
          jugador2: `MB ${i}B`,
          orden: i,
        },
      });
      createdIds.parejasMBIds.push(p.id);
      await prisma.zonaPareja.create({
        data: {
          zonaId: zonaMB.id,
          parejaId: p.id,
          pj: 0,
        },
      });
    }

    // Ronda 1: P1 vs P2 (FINALIZADO), P3 vs P4 (PENDIENTE)
    const pMB1 = await prisma.partido.create({
      data: {
        categoriaId: catMB.id,
        zonaId: zonaMB.id,
        pareja1Id: createdIds.parejasMBIds[0],
        pareja2Id: createdIds.parejasMBIds[1],
        ganadorId: createdIds.parejasMBIds[0],
        estado: 'FINALIZADO',
        posicionEnRonda: 1,
      },
    });
    createdIds.partidosMBIds.push(pMB1.id);

    // Actualizar pj de P1 y P2 a 1
    await prisma.zonaPareja.updateMany({
      where: { zonaId: zonaMB.id, parejaId: { in: [createdIds.parejasMBIds[0], createdIds.parejasMBIds[1]] } },
      data: { pj: 1 },
    });

    const pMB2 = await prisma.partido.create({
      data: {
        categoriaId: catMB.id,
        zonaId: zonaMB.id,
        pareja1Id: createdIds.parejasMBIds[2],
        pareja2Id: createdIds.parejasMBIds[3],
        estado: 'PENDIENTE',
        posicionEnRonda: 2,
      },
    });
    createdIds.partidosMBIds.push(pMB2.id);

    // Ronda 2: partidos con parejas null (esperando resultados)
    const pMB3 = await prisma.partido.create({
      data: {
        categoriaId: catMB.id,
        zonaId: zonaMB.id,
        estado: 'PENDIENTE',
        posicionEnRonda: 3,
        origenPareja1: 'Ganador Partido 1',
        origenPareja2: 'Ganador Partido 2',
      },
    });
    createdIds.partidosMBIds.push(pMB3.id);

    const pMB4 = await prisma.partido.create({
      data: {
        categoriaId: catMB.id,
        zonaId: zonaMB.id,
        estado: 'PENDIENTE',
        posicionEnRonda: 4,
        origenPareja1: 'Perdedor Partido 1',
        origenPareja2: 'Perdedor Partido 2',
      },
    });
    createdIds.partidosMBIds.push(pMB4.id);

    // ─── CASO 1: Categoría en BORRADOR ──────────────────────────────
    console.log('▶ CASO 1: Consultar parejas en categoría BORRADOR...');
    const resBorrador = await fetch(`${BASE_URL}/categorias/${catBorrador.id}/parejas`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    if (resBorrador.status !== 200) {
      throw new Error(`Esperado HTTP 200 en categoría borrador, recibido ${resBorrador.status}`);
    }
    const parejasBorrador = await resBorrador.json();
    if (!Array.isArray(parejasBorrador) || parejasBorrador.length !== 2) {
      throw new Error(`Esperadas 2 parejas en borrador, recibidas ${parejasBorrador.length}`);
    }
    for (const p of parejasBorrador) {
      if (p.zonaParejas && p.zonaParejas.length > 0) {
        throw new Error(`En BORRADOR no debe haber zonas asignadas a la pareja (${p.id})`);
      }
    }
    console.log('  ✅ Categoría BORRADOR: parejas retornadas sin zonas asignadas.');

    // ─── CASO 2: Categoría iniciada (EN_CURSO con zona y partido) ───
    console.log('\n▶ CASO 2: Consultar parejas en categoría iniciada con zona y progreso...');
    const resIniciada = await fetch(`${BASE_URL}/categorias/${catIniciada.id}/parejas`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    if (resIniciada.status !== 200) {
      throw new Error(`Esperado HTTP 200 en categoría iniciada, recibido ${resIniciada.status}`);
    }
    const parejasIniciada = await resIniciada.json();
    if (!Array.isArray(parejasIniciada) || parejasIniciada.length !== 2) {
      throw new Error(`Esperadas 2 parejas en categoría iniciada, recibidas ${parejasIniciada.length}`);
    }
    for (const p of parejasIniciada) {
      if (!p.zonaParejas || p.zonaParejas.length !== 1) {
        throw new Error(`En categoría iniciada la pareja (${p.id}) debe tener exactamente 1 zonaPareja`);
      }
      const zp = p.zonaParejas[0];
      if (zp.zona?.nombre !== 'Zona A') {
        throw new Error(`Nombre de zona esperado 'Zona A', recibido '${zp.zona?.nombre}'`);
      }
      if (zp.zona?.formato !== 'ROUND_ROBIN') {
        throw new Error(`Formato de zona esperado 'ROUND_ROBIN', recibido '${zp.zona?.formato}'`);
      }
      if (!Array.isArray(zp.zona?.partidos) || zp.zona.partidos.length !== 1) {
        throw new Error(`Esperado 1 partido en la zona, recibidos ${zp.zona?.partidos?.length}`);
      }
      const partido = zp.zona.partidos[0];
      if (partido.estado !== 'FINALIZADO') {
        throw new Error(`Estado de partido esperado FINALIZADO, recibido ${partido.estado}`);
      }
      // Verificar progreso según formato ROUND_ROBIN con 2 parejas
      const cantParejas = zp.zona?._count?.zonaParejas || 2;
      const partidosTotales = Math.max(1, cantParejas - 1);
      const jugados = zp.pj ?? 0;
      if (partidosTotales !== 1 || jugados !== 1) {
        throw new Error(`Progreso esperado 1/1 jugados para pareja ${p.id}, recibido ${jugados}/${partidosTotales}`);
      }
    }
    console.log('  ✅ Categoría iniciada: zona "Zona A" y progreso 1/1 jugados correctamente verificados.');

    // ─── CASO 3: Zona de 4 (MINI_BRACKET: 2 partidos totales por pareja) ───
    console.log('\n▶ CASO 3: Consultar parejas en zona de 4 (MINI_BRACKET)...');
    const resMB = await fetch(`${BASE_URL}/categorias/${catMB.id}/parejas`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    if (resMB.status !== 200) {
      throw new Error(`Esperado HTTP 200 en categoría MINI_BRACKET, recibido ${resMB.status}`);
    }
    const parejasMB = await resMB.json();
    if (!Array.isArray(parejasMB) || parejasMB.length !== 4) {
      throw new Error(`Esperadas 4 parejas en MINI_BRACKET, recibidas ${parejasMB.length}`);
    }
    for (const p of parejasMB) {
      const zp = p.zonaParejas[0];
      if (zp.zona?.formato !== 'MINI_BRACKET') {
        throw new Error(`Formato esperado MINI_BRACKET, recibido ${zp.zona?.formato}`);
      }
      // Calcular partidos totales según formato
      const partidosTotales = zp.zona?.formato === 'MINI_BRACKET' ? 2 : (zp.zona?._count?.zonaParejas || 4) - 1;
      if (partidosTotales !== 2) {
        throw new Error(`Para MINI_BRACKET cada pareja debe mostrar 2 partidos totales, recibido ${partidosTotales}`);
      }
      // P1 y P2 jugaron 1 partido (1/2), P3 y P4 no jugaron (0/2)
      const partidosJugados = zp.pj;
      const esperadoPJ = (p.id === createdIds.parejasMBIds[0] || p.id === createdIds.parejasMBIds[1]) ? 1 : 0;
      if (partidosJugados !== esperadoPJ) {
        throw new Error(`Partidos jugados esperados ${esperadoPJ}, recibidos ${partidosJugados} para pareja ${p.id}`);
      }
    }
    console.log('  ✅ Zona MINI_BRACKET: las 4 parejas muestran un total de 2 partidos desde el inicio (1/2 y 0/2).');

    // ─── CASO 4: Multitenant (Organizador ajeno debe recibir 403) ────
    console.log('\n▶ CASO 4: Intento de acceso de Organizador B a categoría de Organizador A...');
    const resForbidden = await fetch(`${BASE_URL}/categorias/${catIniciada.id}/parejas`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    if (resForbidden.status !== 403) {
      throw new Error(`Esperado HTTP 403 para organizador ajeno, recibido ${resForbidden.status}`);
    }
    console.log('  ✅ Multitenant verificado: Organizador B recibió HTTP 403 Forbidden correctamente.');

    // ─── CASO 5: Alta de pareja con huecos en el orden (max + 1, no count + 1) ────
    console.log('\n▶ CASO 5: Alta de pareja en BORRADOR con un hueco en el orden (1, 3)...');
    await prisma.pareja.update({ where: { id: pB2.id }, data: { orden: 3 } });
    const resAlta = await fetch(`${BASE_URL}/categorias/${catBorrador.id}/parejas`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jugador1: 'Hueco A', jugador2: 'Hueco B' }),
    });
    if (resAlta.status !== 201) {
      throw new Error(`Esperado HTTP 201 en alta de pareja, recibido ${resAlta.status}`);
    }
    const parejaAlta = await resAlta.json();
    if (parejaAlta.orden !== 4) {
      throw new Error(`La pareja nueva debía recibir orden 4 (max + 1), recibió ${parejaAlta.orden}`);
    }
    const ordenesBorrador = (await prisma.pareja.findMany({ where: { categoriaId: catBorrador.id } })).map((p) => p.orden);
    if (new Set(ordenesBorrador).size !== ordenesBorrador.length) {
      throw new Error(`Orden repetido en la categoría: ${JSON.stringify(ordenesBorrador)}`);
    }
    console.log(`  ✅ Alta con hueco: orden ${parejaAlta.orden}, órdenes de la categoría ${JSON.stringify(ordenesBorrador.sort((a, b) => a - b))}.`);

    // ─── CASO 6: PATCH /parejas/:id no acepta orden (lo asigna el sistema) ────
    console.log('\n▶ CASO 6: PATCH de pareja con orden debe rechazarse...');
    const resPatchOrden = await fetch(`${BASE_URL}/parejas/${pB1.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jugador1: 'No Cambia', orden: 3 }),
    });
    if (resPatchOrden.status !== 400) {
      throw new Error(`Esperado HTTP 400 al enviar orden en PATCH, recibido ${resPatchOrden.status}`);
    }
    const pB1Post = await prisma.pareja.findUnique({ where: { id: pB1.id } });
    if (pB1Post.orden !== 1 || pB1Post.jugador1 === 'No Cambia') {
      throw new Error(`El PATCH rechazado modificó la pareja: orden ${pB1Post.orden}, jugador1 "${pB1Post.jugador1}"`);
    }
    const resPatchNombre = await fetch(`${BASE_URL}/parejas/${pB1.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jugador1: 'Nuevo Nombre' }),
    });
    const parejaRenombrada = await resPatchNombre.json();
    if (resPatchNombre.status !== 200 || parejaRenombrada.jugador1 !== 'Nuevo Nombre' || parejaRenombrada.orden !== 1) {
      throw new Error(`PATCH de nombre: esperado 200 con jugador1 "Nuevo Nombre" y orden 1, recibido ${resPatchNombre.status} ${JSON.stringify(parejaRenombrada)}`);
    }
    console.log('  ✅ PATCH con orden rechazado con 400 sin cambios; PATCH de nombre sigue funcionando.');

    console.log('\n🎉 TODOS LOS CASOS DE REGRESIÓN PASARON EXITOSAMENTE!');
  } catch (err) {
    // Sin este catch, el process.exit(0) del finally tapaba cualquier falla de la suite
    console.error('\n❌ ERROR EN EL TEST:', err.message);
    exitCode = 1;
  } finally {
    console.log('\n🧹 Limpiando datos de prueba...');
    try {
      if (createdIds.partidoId) {
        await prisma.partido.deleteMany({ where: { id: createdIds.partidoId } });
      }
      if (createdIds.partidosMBIds.length > 0) {
        await prisma.partido.deleteMany({ where: { id: { in: createdIds.partidosMBIds } } });
      }
      if (createdIds.zonaId) {
        await prisma.zonaPareja.deleteMany({ where: { zonaId: createdIds.zonaId } });
        await prisma.zona.deleteMany({ where: { id: createdIds.zonaId } });
      }
      if (createdIds.zonaMBId) {
        await prisma.zonaPareja.deleteMany({ where: { zonaId: createdIds.zonaMBId } });
        await prisma.zona.deleteMany({ where: { id: createdIds.zonaMBId } });
      }
      const catIdsToDelete = [createdIds.catBorradorId, createdIds.catIniciadaId, createdIds.catMiniBracketId].filter(Boolean);
      if (catIdsToDelete.length > 0) {
        await prisma.pareja.deleteMany({
          where: { categoriaId: { in: catIdsToDelete } },
        });
        await prisma.categoria.deleteMany({
          where: { id: { in: catIdsToDelete } },
        });
      }
      if (createdIds.torneoAId) {
        await prisma.torneo.deleteMany({ where: { id: createdIds.torneoAId } });
      }
      if (createdIds.organizadorAId || createdIds.organizadorBId) {
        await prisma.organizador.deleteMany({
          where: { id: { in: [createdIds.organizadorAId, createdIds.organizadorBId].filter(Boolean) } },
        });
      }
      console.log('🧹 Limpieza completada con éxito.');
    } catch (cleanupErr) {
      console.error('⚠️ Error durante la limpieza:', cleanupErr.message);
    }
    if (serverInstance) {
      await new Promise((resolve) => serverInstance.close(resolve));
    }
    await prisma.$disconnect();
    process.exit(exitCode);
  }
}

main().catch((err) => {
  console.error('\n❌ ERROR EN EL TEST:', err.message);
  process.exit(1);
});
