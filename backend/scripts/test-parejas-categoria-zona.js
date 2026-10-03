const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { JWT_SECRET, PORT } = require('../src/config/env');

const BASE_URL = `http://localhost:${PORT || 3001}/api`;

async function main() {
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
    zonaId: null,
    parejaB1Id: null,
    parejaB2Id: null,
    parejaI1Id: null,
    parejaI2Id: null,
    partidoId: null,
  };

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
      if (!Array.isArray(zp.zona?.partidos) || zp.zona.partidos.length !== 1) {
        throw new Error(`Esperado 1 partido en la zona, recibidos ${zp.zona?.partidos?.length}`);
      }
      const partido = zp.zona.partidos[0];
      if (partido.estado !== 'FINALIZADO') {
        throw new Error(`Estado de partido esperado FINALIZADO, recibido ${partido.estado}`);
      }
      // Verificar filtro de partidos de la pareja
      const partidosPareja = zp.zona.partidos.filter((match) => match.pareja1Id === p.id || match.pareja2Id === p.id);
      const jugados = partidosPareja.filter((match) => match.estado === 'FINALIZADO').length;
      if (partidosPareja.length !== 1 || jugados !== 1) {
        throw new Error(`Progreso esperado 1/1 jugados para pareja ${p.id}, recibido ${jugados}/${partidosPareja.length}`);
      }
    }
    console.log('  ✅ Categoría iniciada: zona "Zona A" y progreso 1/1 jugados correctamente verificados.');

    // ─── CASO 3: Multitenant (Organizador ajeno debe recibir 403) ────
    console.log('\n▶ CASO 3: Intento de acceso de Organizador B a categoría de Organizador A...');
    const resForbidden = await fetch(`${BASE_URL}/categorias/${catIniciada.id}/parejas`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    if (resForbidden.status !== 403) {
      throw new Error(`Esperado HTTP 403 para organizador ajeno, recibido ${resForbidden.status}`);
    }
    console.log('  ✅ Multitenant verificado: Organizador B recibió HTTP 403 Forbidden correctamente.');

    console.log('\n🎉 TODOS LOS CASOS DE REGRESIÓN PASARON EXITOSAMENTE!');
  } finally {
    console.log('\n🧹 Limpiando datos de prueba...');
    try {
      if (createdIds.partidoId) {
        await prisma.partido.deleteMany({ where: { id: createdIds.partidoId } });
      }
      if (createdIds.zonaId) {
        await prisma.zonaPareja.deleteMany({ where: { zonaId: createdIds.zonaId } });
        await prisma.zona.deleteMany({ where: { id: createdIds.zonaId } });
      }
      if (createdIds.catBorradorId || createdIds.catIniciadaId) {
        await prisma.pareja.deleteMany({
          where: { categoriaId: { in: [createdIds.catBorradorId, createdIds.catIniciadaId].filter(Boolean) } },
        });
        await prisma.categoria.deleteMany({
          where: { id: { in: [createdIds.catBorradorId, createdIds.catIniciadaId].filter(Boolean) } },
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
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('\n❌ ERROR EN EL TEST:', err.message);
  process.exit(1);
});
