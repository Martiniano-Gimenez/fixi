'use strict';

const prisma = require('../../src/lib/prisma');
const { requireConfirmarDev, crearBackupDevDb } = require('./devUtils');

async function main() {
  requireConfirmarDev('setup-test-mobile.js');

  const args = process.argv.slice(2);
  const orgArg = args.find((a) => a.startsWith('--organizadorId='));
  const organizadorId = orgArg ? orgArg.split('=')[1].trim() : null;

  if (!organizadorId) {
    console.error('❌ Parámetro obligatorio faltante: --organizadorId=<id>');
    console.error('Por seguridad se eliminó el fallback findFirst(). Debes especificar el organizador destino.');
    process.exit(1);
  }

  const org = await prisma.organizador.findUnique({ where: { id: organizadorId } });
  if (!org) {
    console.error(`❌ No se encontró ningún organizador con id="${organizadorId}".`);
    process.exit(1);
  }

  crearBackupDevDb();

  // Delete previous test tournament if exists
  const existing = await prisma.torneo.findUnique({
    where: { slug: 'test-mobile-posiciones' }
  });
  if (existing) {
    await prisma.torneo.delete({ where: { id: existing.id } });
    console.log('Deleted old test tournament');
  }

  // Create tournament
  const torneo = await prisma.torneo.create({
    data: {
      nombre: 'Torneo Verificación Mobile',
      slug: 'test-mobile-posiciones',
      estado: 'EN_CURSO',
      fecha: new Date('2026-10-15'),
      organizadorId: org.id,
    }
  });

  // Category 1: Pruebas Mobile
  const cat1 = await prisma.categoria.create({
    data: {
      torneoId: torneo.id,
      nombre: 'Pruebas Mobile',
      estado: 'EN_CURSO',
    }
  });

  // Parejas for Cat 1
  const p1 = await prisma.pareja.create({ data: { categoriaId: cat1.id, jugador1: 'Maximiliano', jugador2: 'Maximiliano', orden: 1 } });
  const p2 = await prisma.pareja.create({ data: { categoriaId: cat1.id, jugador1: 'González de la Vega', jugador2: 'Montes de Oca', orden: 2 } });
  const p3 = await prisma.pareja.create({ data: { categoriaId: cat1.id, jugador1: 'Martínez', jugador2: 'López', orden: 3 } });
  const p4 = await prisma.pareja.create({ data: { categoriaId: cat1.id, jugador1: 'Fernández', jugador2: 'Rodríguez', orden: 4 } });

  // Zona A - 2 Dígitos
  const zonaA = await prisma.zona.create({
    data: {
      categoriaId: cat1.id,
      nombre: 'Zona A',
      formato: 'ROUND_ROBIN',
      clasifican: 2,
    }
  });

  await prisma.zonaPareja.createMany({
    data: [
      { zonaId: zonaA.id, parejaId: p1.id, posicion: 1, pj: 4, pg: 4, pp: 0, sf: 14, sc: 2, gf: 54, gc: 22, puntos: 12 }, // DS: +12, PTS: 12
      { zonaId: zonaA.id, parejaId: p2.id, posicion: 2, pj: 4, pg: 2, pp: 2, sf: 5, sc: 5, gf: 40, gc: 38, puntos: 6 },
      { zonaId: zonaA.id, parejaId: p3.id, posicion: 3, pj: 4, pg: 1, pp: 3, sf: 3, sc: 7, gf: 20, gc: 35, puntos: 3 }, // DG: -15
      { zonaId: zonaA.id, parejaId: p4.id, posicion: 4, pj: 4, pg: 0, pp: 4, sf: 0, sc: 8, gf: 14, gc: 48, puntos: 0 },
    ]
  });

  // Zona B - Sin Jugar
  const p5 = await prisma.pareja.create({ data: { categoriaId: cat1.id, jugador1: 'Ponce', jugador2: 'Leone', orden: 5 } });
  const p6 = await prisma.pareja.create({ data: { categoriaId: cat1.id, jugador1: 'Suarez', jugador2: 'Blanco', orden: 6 } });
  const p7 = await prisma.pareja.create({ data: { categoriaId: cat1.id, jugador1: 'Díaz', jugador2: 'Romero', orden: 7 } });

  const zonaB = await prisma.zona.create({
    data: {
      categoriaId: cat1.id,
      nombre: 'Zona B',
      formato: 'ROUND_ROBIN',
      clasifican: 2,
    }
  });

  await prisma.zonaPareja.createMany({
    data: [
      { zonaId: zonaB.id, parejaId: p5.id, posicion: 0, pj: 0, pg: 0, pp: 0, sf: 0, sc: 0, gf: 0, gc: 0, puntos: 0 },
      { zonaId: zonaB.id, parejaId: p6.id, posicion: 0, pj: 0, pg: 0, pp: 0, sf: 0, sc: 0, gf: 0, gc: 0, puntos: 0 },
      { zonaId: zonaB.id, parejaId: p7.id, posicion: 0, pj: 0, pg: 0, pp: 0, sf: 0, sc: 0, gf: 0, gc: 0, puntos: 0 },
    ]
  });

  // Zona C
  const p8 = await prisma.pareja.create({ data: { categoriaId: cat1.id, jugador1: 'Alonso', jugador2: 'Nieva', orden: 8 } });
  const p9 = await prisma.pareja.create({ data: { categoriaId: cat1.id, jugador1: 'Torres', jugador2: 'Castro', orden: 9 } });

  const zonaC = await prisma.zona.create({
    data: {
      categoriaId: cat1.id,
      nombre: 'Zona C',
      formato: 'ROUND_ROBIN',
      clasifican: 1,
    }
  });

  await prisma.zonaPareja.createMany({
    data: [
      { zonaId: zonaC.id, parejaId: p8.id, posicion: 1, pj: 1, pg: 1, pp: 0, sf: 2, sc: 0, gf: 12, gc: 4, puntos: 3 },
      { zonaId: zonaC.id, parejaId: p9.id, posicion: 2, pj: 1, pg: 0, pp: 1, sf: 0, sc: 2, gf: 4, gc: 12, puntos: 0 },
    ]
  });

  // Category 2: MiniBracket Test
  const cat2 = await prisma.categoria.create({
    data: {
      torneoId: torneo.id,
      nombre: 'MiniBracket Test',
      estado: 'EN_CURSO',
    }
  });

  // MB 1: Sin Jugar
  const mb1P1 = await prisma.pareja.create({ data: { categoriaId: cat2.id, jugador1: 'Albornoz', jugador2: 'Ponce', orden: 1 } });
  const mb1P2 = await prisma.pareja.create({ data: { categoriaId: cat2.id, jugador1: 'Bertolotti', jugador2: 'Cattaneo', orden: 2 } });
  const mb1P3 = await prisma.pareja.create({ data: { categoriaId: cat2.id, jugador1: 'Calderón', jugador2: 'Manzano', orden: 3 } });
  const mb1P4 = await prisma.pareja.create({ data: { categoriaId: cat2.id, jugador1: 'Nieto', jugador2: 'Gauna', orden: 4 } });

  const zonaMB1 = await prisma.zona.create({
    data: {
      categoriaId: cat2.id,
      nombre: 'MB 1 (Sin Jugar)',
      formato: 'MINI_BRACKET',
      clasifican: 2,
    }
  });

  await prisma.zonaPareja.createMany({
    data: [
      { zonaId: zonaMB1.id, parejaId: mb1P1.id, posicion: 0, pj: 0, pg: 0, pp: 0, sf: 0, sc: 0, gf: 0, gc: 0, puntos: 0 },
      { zonaId: zonaMB1.id, parejaId: mb1P2.id, posicion: 0, pj: 0, pg: 0, pp: 0, sf: 0, sc: 0, gf: 0, gc: 0, puntos: 0 },
      { zonaId: zonaMB1.id, parejaId: mb1P3.id, posicion: 0, pj: 0, pg: 0, pp: 0, sf: 0, sc: 0, gf: 0, gc: 0, puntos: 0 },
      { zonaId: zonaMB1.id, parejaId: mb1P4.id, posicion: 0, pj: 0, pg: 0, pp: 0, sf: 0, sc: 0, gf: 0, gc: 0, puntos: 0 },
    ]
  });

  await prisma.partido.createMany({
    data: [
      { categoriaId: cat2.id, zonaId: zonaMB1.id, posicionEnRonda: 1, pareja1Id: mb1P1.id, pareja2Id: mb1P2.id, estado: 'PENDIENTE', fechaHora: new Date('2026-10-15T18:00:00Z') },
      { categoriaId: cat2.id, zonaId: zonaMB1.id, posicionEnRonda: 2, pareja1Id: mb1P3.id, pareja2Id: mb1P4.id, estado: 'PENDIENTE', fechaHora: new Date('2026-10-15T19:15:00Z') },
      { categoriaId: cat2.id, zonaId: zonaMB1.id, posicionEnRonda: 3, estado: 'PENDIENTE', origenPareja1: 'G1', origenPareja2: 'G2', fechaHora: new Date('2026-10-15T21:00:00Z') },
      { categoriaId: cat2.id, zonaId: zonaMB1.id, posicionEnRonda: 4, estado: 'PENDIENTE', origenPareja1: 'P1', origenPareja2: 'P2', fechaHora: new Date('2026-10-15T22:15:00Z') },
    ]
  });

  // MB 2: Ronda 1 Jugada
  const mb2P1 = await prisma.pareja.create({ data: { categoriaId: cat2.id, jugador1: 'Alcaraz', jugador2: 'Lombardi', orden: 5 } });
  const mb2P2 = await prisma.pareja.create({ data: { categoriaId: cat2.id, jugador1: 'Almirón', jugador2: 'Ponce', orden: 6 } });
  const mb2P3 = await prisma.pareja.create({ data: { categoriaId: cat2.id, jugador1: 'Aranda', jugador2: 'Becerra', orden: 7 } });
  const mb2P4 = await prisma.pareja.create({ data: { categoriaId: cat2.id, jugador1: 'Miranda', jugador2: 'Burgos', orden: 8 } });

  const zonaMB2 = await prisma.zona.create({
    data: {
      categoriaId: cat2.id,
      nombre: 'MB 2 (Ronda 1)',
      formato: 'MINI_BRACKET',
      clasifican: 2,
    }
  });

  await prisma.zonaPareja.createMany({
    data: [
      { zonaId: zonaMB2.id, parejaId: mb2P1.id, posicion: 0, pj: 1, pg: 1, pp: 0, sf: 2, sc: 0, gf: 12, gc: 4, puntos: 3 },
      { zonaId: zonaMB2.id, parejaId: mb2P3.id, posicion: 0, pj: 1, pg: 1, pp: 0, sf: 2, sc: 1, gf: 14, gc: 11, puntos: 3 },
      { zonaId: zonaMB2.id, parejaId: mb2P4.id, posicion: 0, pj: 1, pg: 0, pp: 1, sf: 1, sc: 2, gf: 11, gc: 14, puntos: 0 },
      { zonaId: zonaMB2.id, parejaId: mb2P2.id, posicion: 0, pj: 1, pg: 0, pp: 1, sf: 0, sc: 2, gf: 4, gc: 12, puntos: 0 },
    ]
  });

  const m1 = await prisma.partido.create({
    data: { categoriaId: cat2.id, zonaId: zonaMB2.id, posicionEnRonda: 1, pareja1Id: mb2P1.id, pareja2Id: mb2P2.id, ganadorId: mb2P1.id, estado: 'FINALIZADO', fechaHora: new Date('2026-10-15T18:00:00Z') }
  });
  await prisma.setPartido.createMany({
    data: [
      { partidoId: m1.id, numero: 1, gamesPareja1: 6, gamesPareja2: 2 },
      { partidoId: m1.id, numero: 2, gamesPareja1: 6, gamesPareja2: 2 },
    ]
  });

  const m2 = await prisma.partido.create({
    data: { categoriaId: cat2.id, zonaId: zonaMB2.id, posicionEnRonda: 2, pareja1Id: mb2P3.id, pareja2Id: mb2P4.id, ganadorId: mb2P3.id, estado: 'FINALIZADO', fechaHora: new Date('2026-10-15T19:15:00Z') }
  });
  await prisma.setPartido.createMany({
    data: [
      { partidoId: m2.id, numero: 1, gamesPareja1: 6, gamesPareja2: 4 },
      { partidoId: m2.id, numero: 2, gamesPareja1: 2, gamesPareja2: 6 },
      { partidoId: m2.id, numero: 3, gamesPareja1: 6, gamesPareja2: 1 },
    ]
  });

  await prisma.partido.createMany({
    data: [
      { categoriaId: cat2.id, zonaId: zonaMB2.id, posicionEnRonda: 3, pareja1Id: mb2P1.id, pareja2Id: mb2P3.id, estado: 'PENDIENTE', fechaHora: new Date('2026-10-15T21:00:00Z') },
      { categoriaId: cat2.id, zonaId: zonaMB2.id, posicionEnRonda: 4, pareja1Id: mb2P2.id, pareja2Id: mb2P4.id, estado: 'PENDIENTE', fechaHora: new Date('2026-10-15T22:15:00Z') },
    ]
  });

  // MB 3: Finalizada
  const mb3P1 = await prisma.pareja.create({ data: { categoriaId: cat2.id, jugador1: 'Sandoval', jugador2: 'Quevedo', orden: 9 } });
  const mb3P2 = await prisma.pareja.create({ data: { categoriaId: cat2.id, jugador1: 'Tapia', jugador2: 'Nieva', orden: 10 } });
  const mb3P3 = await prisma.pareja.create({ data: { categoriaId: cat2.id, jugador1: 'Maidana', jugador2: 'Valentini', orden: 11 } });
  const mb3P4 = await prisma.pareja.create({ data: { categoriaId: cat2.id, jugador1: 'Dávila', jugador2: 'Arrieta', orden: 12 } });

  const zonaMB3 = await prisma.zona.create({
    data: {
      categoriaId: cat2.id,
      nombre: 'MB 3 (Finalizada)',
      formato: 'MINI_BRACKET',
      clasifican: 2,
    }
  });

  await prisma.zonaPareja.createMany({
    data: [
      { zonaId: zonaMB3.id, parejaId: mb3P1.id, posicion: 1, pj: 2, pg: 2, pp: 0, sf: 4, sc: 0, gf: 24, gc: 8, puntos: 6 },
      { zonaId: zonaMB3.id, parejaId: mb3P3.id, posicion: 2, pj: 2, pg: 1, pp: 1, sf: 2, sc: 3, gf: 18, gc: 23, puntos: 3 },
      { zonaId: zonaMB3.id, parejaId: mb3P2.id, posicion: 3, pj: 2, pg: 1, pp: 1, sf: 2, sc: 2, gf: 16, gc: 18, puntos: 3 },
      { zonaId: zonaMB3.id, parejaId: mb3P4.id, posicion: 4, pj: 2, pg: 0, pp: 2, sf: 1, sc: 4, gf: 17, gc: 26, puntos: 0 },
    ]
  });

  const m3_1 = await prisma.partido.create({
    data: { categoriaId: cat2.id, zonaId: zonaMB3.id, posicionEnRonda: 1, pareja1Id: mb3P1.id, pareja2Id: mb3P2.id, ganadorId: mb3P1.id, estado: 'FINALIZADO', fechaHora: new Date('2026-10-15T18:00:00Z') }
  });
  await prisma.setPartido.createMany({
    data: [
      { partidoId: m3_1.id, numero: 1, gamesPareja1: 6, gamesPareja2: 2 },
      { partidoId: m3_1.id, numero: 2, gamesPareja1: 6, gamesPareja2: 2 },
    ]
  });

  const m3_2 = await prisma.partido.create({
    data: { categoriaId: cat2.id, zonaId: zonaMB3.id, posicionEnRonda: 2, pareja1Id: mb3P3.id, pareja2Id: mb3P4.id, ganadorId: mb3P3.id, estado: 'FINALIZADO', fechaHora: new Date('2026-10-15T19:15:00Z') }
  });
  await prisma.setPartido.createMany({
    data: [
      { partidoId: m3_2.id, numero: 1, gamesPareja1: 6, gamesPareja2: 4 },
      { partidoId: m3_2.id, numero: 2, gamesPareja1: 2, gamesPareja2: 6 },
      { partidoId: m3_2.id, numero: 3, gamesPareja1: 6, gamesPareja2: 1 },
    ]
  });

  const m3_3 = await prisma.partido.create({
    data: { categoriaId: cat2.id, zonaId: zonaMB3.id, posicionEnRonda: 3, pareja1Id: mb3P1.id, pareja2Id: mb3P3.id, ganadorId: mb3P1.id, estado: 'FINALIZADO', fechaHora: new Date('2026-10-15T21:00:00Z') }
  });
  await prisma.setPartido.createMany({
    data: [
      { partidoId: m3_3.id, numero: 1, gamesPareja1: 6, gamesPareja2: 2 },
      { partidoId: m3_3.id, numero: 2, gamesPareja1: 6, gamesPareja2: 2 },
    ]
  });

  const m3_4 = await prisma.partido.create({
    data: { categoriaId: cat2.id, zonaId: zonaMB3.id, posicionEnRonda: 4, pareja1Id: mb3P2.id, pareja2Id: mb3P4.id, ganadorId: mb3P2.id, estado: 'FINALIZADO', fechaHora: new Date('2026-10-15T22:15:00Z') }
  });
  await prisma.setPartido.createMany({
    data: [
      { partidoId: m3_4.id, numero: 1, gamesPareja1: 6, gamesPareja2: 4 },
      { partidoId: m3_4.id, numero: 2, gamesPareja1: 6, gamesPareja2: 2 },
    ]
  });

  console.log('Test tournament created successfully with slug test-mobile-posiciones');
}

main().catch(console.error).finally(() => prisma.$disconnect());
