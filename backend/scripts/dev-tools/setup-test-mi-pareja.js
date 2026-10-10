'use strict';

const prisma = require('../../src/lib/prisma');
const { requireConfirmarDev, crearBackupDevDb } = require('./devUtils');

async function main() {
  requireConfirmarDev('setup-test-mi-pareja.js');

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

  // Borrar torneo previo si existe
  const existing = await prisma.torneo.findUnique({
    where: { slug: 'test-mi-pareja' }
  });
  if (existing) {
    await prisma.torneo.delete({ where: { id: existing.id } });
    console.log('Deleted old test tournament test-mi-pareja');
  }

  // Crear torneo
  const torneo = await prisma.torneo.create({
    data: {
      nombre: 'Torneo Test Mi Pareja',
      slug: 'test-mi-pareja',
      estado: 'EN_CURSO',
      fecha: new Date('2026-10-16T15:00:00.000Z'),
      organizadorId: org.id,
    }
  });

  // Categoría 1: Escenarios Mi Pareja
  const cat1 = await prisma.categoria.create({
    data: {
      torneoId: torneo.id,
      nombre: 'Escenarios Mi Pareja',
      estado: 'EN_CURSO',
    }
  });

  // Parejas para Cat 1
  const p1 = await prisma.pareja.create({ data: { categoriaId: cat1.id, jugador1: 'Leone', jugador2: 'Díaz', orden: 1 } });
  const p2 = await prisma.pareja.create({ data: { categoriaId: cat1.id, jugador1: 'López', jugador2: 'Martínez', orden: 2 } });
  const p3 = await prisma.pareja.create({ data: { categoriaId: cat1.id, jugador1: 'Pérez', jugador2: 'Romero', orden: 3 } });

  const p4 = await prisma.pareja.create({ data: { categoriaId: cat1.id, jugador1: 'Nieva', jugador2: 'Castro', orden: 4 } });
  const p5 = await prisma.pareja.create({ data: { categoriaId: cat1.id, jugador1: 'Fernández', jugador2: 'Ruarte', orden: 5 } });
  const p6 = await prisma.pareja.create({ data: { categoriaId: cat1.id, jugador1: 'Alonso', jugador2: 'Torres', orden: 6 } });

  const p7 = await prisma.pareja.create({ data: { categoriaId: cat1.id, jugador1: 'Suárez', jugador2: 'Blanco', orden: 7 } });
  const p8 = await prisma.pareja.create({ data: { categoriaId: cat1.id, jugador1: 'Longo', jugador2: 'Molina', orden: 8 } });
  const p9 = await prisma.pareja.create({ data: { categoriaId: cat1.id, jugador1: 'Ortiz', jugador2: 'Silva', orden: 9 } });

  // Parejas para Eliminatoria
  const p10 = await prisma.pareja.create({ data: { categoriaId: cat1.id, jugador1: 'Silva', jugador2: 'Benítez', orden: 10 } });
  const p11 = await prisma.pareja.create({ data: { categoriaId: cat1.id, jugador1: 'Ruiz', jugador2: 'Vega', orden: 11 } });
  const p12 = await prisma.pareja.create({ data: { categoriaId: cat1.id, jugador1: 'Tapia', jugador2: 'Ramos', orden: 12 } });

  // 1. Zona A: ROUND_ROBIN de 3 parejas, FINALIZADA
  // p1 (1°, 6 pts), p2 (2°, 3 pts), p3 (3°, 0 pts). Clasifican 2.
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
      { zonaId: zonaA.id, parejaId: p1.id, posicion: 0, pj: 2, pg: 2, pp: 0, sf: 4, sc: 0, gf: 24, gc: 8, puntos: 6 },
      { zonaId: zonaA.id, parejaId: p2.id, posicion: 0, pj: 2, pg: 1, pp: 1, sf: 2, sc: 2, gf: 16, gc: 16, puntos: 3 },
      { zonaId: zonaA.id, parejaId: p3.id, posicion: 0, pj: 2, pg: 0, pp: 2, sf: 0, sc: 4, gf: 8, gc: 24, puntos: 0 },
    ]
  });

  // Partidos finalizados de Zona A
  await prisma.partido.createMany({
    data: [
      {
        categoriaId: cat1.id,
        zonaId: zonaA.id,
        pareja1Id: p1.id,
        pareja2Id: p2.id,
        ganadorId: p1.id,
        estado: 'FINALIZADO',
        posicionEnRonda: 1,
        fechaHora: new Date('2026-10-15T18:00:00Z'),
        canchaNumero: 1,
      },
      {
        categoriaId: cat1.id,
        zonaId: zonaA.id,
        pareja1Id: p1.id,
        pareja2Id: p3.id,
        ganadorId: p1.id,
        estado: 'FINALIZADO',
        posicionEnRonda: 2,
        fechaHora: new Date('2026-10-15T19:30:00Z'),
        canchaNumero: 2,
      },
      {
        categoriaId: cat1.id,
        zonaId: zonaA.id,
        pareja1Id: p2.id,
        pareja2Id: p3.id,
        ganadorId: p2.id,
        estado: 'FINALIZADO',
        posicionEnRonda: 3,
        fechaHora: new Date('2026-10-15T21:00:00Z'),
        canchaNumero: 1,
      },
    ]
  });

  // 2. Zona B: ROUND_ROBIN de 3 parejas, EN JUEGO
  // Partido EN_CURSO (p4 vs p5) y PENDIENTE con fechaHora (p6 vs p4)
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
      { zonaId: zonaB.id, parejaId: p4.id, posicion: 0, pj: 0, pg: 0, pp: 0, sf: 0, sc: 0, gf: 0, gc: 0, puntos: 0 },
      { zonaId: zonaB.id, parejaId: p5.id, posicion: 0, pj: 0, pg: 0, pp: 0, sf: 0, sc: 0, gf: 0, gc: 0, puntos: 0 },
      { zonaId: zonaB.id, parejaId: p6.id, posicion: 0, pj: 0, pg: 0, pp: 0, sf: 0, sc: 0, gf: 0, gc: 0, puntos: 0 },
    ]
  });

  await prisma.partido.createMany({
    data: [
      {
        categoriaId: cat1.id,
        zonaId: zonaB.id,
        pareja1Id: p4.id,
        pareja2Id: p5.id,
        estado: 'EN_CURSO',
        posicionEnRonda: 1,
        fechaHora: new Date('2026-10-15T20:00:00Z'),
        canchaNumero: 3,
      },
      {
        categoriaId: cat1.id,
        zonaId: zonaB.id,
        pareja1Id: p6.id,
        pareja2Id: p4.id,
        estado: 'PENDIENTE',
        posicionEnRonda: 2,
        fechaHora: new Date('2026-10-15T22:30:00Z'),
        canchaNumero: 2,
      },
      {
        categoriaId: cat1.id,
        zonaId: zonaB.id,
        pareja1Id: p6.id,
        pareja2Id: p5.id,
        estado: 'PENDIENTE',
        posicionEnRonda: 3,
        fechaHora: new Date('2026-10-16T00:00:00Z'),
        canchaNumero: 1,
      },
    ]
  });

  // 3. Zona C: ROUND_ROBIN de 3 parejas, SIN JUGAR
  const zonaC = await prisma.zona.create({
    data: {
      categoriaId: cat1.id,
      nombre: 'Zona C',
      formato: 'ROUND_ROBIN',
      clasifican: 2,
    }
  });

  await prisma.zonaPareja.createMany({
    data: [
      { zonaId: zonaC.id, parejaId: p7.id, posicion: 0, pj: 0, pg: 0, pp: 0, sf: 0, sc: 0, gf: 0, gc: 0, puntos: 0 },
      { zonaId: zonaC.id, parejaId: p8.id, posicion: 0, pj: 0, pg: 0, pp: 0, sf: 0, sc: 0, gf: 0, gc: 0, puntos: 0 },
      { zonaId: zonaC.id, parejaId: p9.id, posicion: 0, pj: 0, pg: 0, pp: 0, sf: 0, sc: 0, gf: 0, gc: 0, puntos: 0 },
    ]
  });

  // 3.5. Zona D: con p10 ("Silva / Benítez"), p11 ("Ruiz / Vega"), p12 ("Tapia / Ramos")
  const zonaD = await prisma.zona.create({
    data: {
      categoriaId: cat1.id,
      nombre: 'Zona D',
      formato: 'ROUND_ROBIN',
      clasifican: 2,
    }
  });

  await prisma.zonaPareja.createMany({
    data: [
      { zonaId: zonaD.id, parejaId: p10.id, posicion: 0, pj: 2, pg: 2, pp: 0, sf: 4, sc: 0, gf: 24, gc: 8, puntos: 6 },
      { zonaId: zonaD.id, parejaId: p11.id, posicion: 0, pj: 1, pg: 0, pp: 1, sf: 0, sc: 2, gf: 4, gc: 12, puntos: 0 },
      { zonaId: zonaD.id, parejaId: p12.id, posicion: 0, pj: 1, pg: 0, pp: 1, sf: 0, sc: 2, gf: 4, gc: 12, puntos: 0 },
    ]
  });

  await prisma.partido.createMany({
    data: [
      {
        categoriaId: cat1.id,
        zonaId: zonaD.id,
        pareja1Id: p10.id,
        pareja2Id: p11.id,
        ganadorId: p10.id,
        estado: 'FINALIZADO',
        posicionEnRonda: 1,
        fechaHora: new Date('2026-10-15T18:00:00Z'),
        canchaNumero: 1,
      },
      {
        categoriaId: cat1.id,
        zonaId: zonaD.id,
        pareja1Id: p10.id,
        pareja2Id: p12.id,
        ganadorId: p10.id,
        estado: 'FINALIZADO',
        posicionEnRonda: 2,
        fechaHora: new Date('2026-10-15T19:30:00Z'),
        canchaNumero: 2,
      },
      {
        categoriaId: cat1.id,
        zonaId: zonaD.id,
        pareja1Id: p11.id,
        pareja2Id: p12.id,
        estado: 'PENDIENTE',
        posicionEnRonda: 3,
        fechaHora: null,
        canchaNumero: null,
      },
    ]
  });

  // 4. Eliminatoria para Cat 1
  const faseCuartos = await prisma.faseEliminatoria.create({
    data: {
      categoriaId: cat1.id,
      nombre: 'Cuartos de final',
      ronda: 8,
    }
  });

  // Match 1: 1° Zona A vs 2° Zona B (Leone / Díaz clasificó 1° en Zona A, Zona B sigue en juego)
  await prisma.partido.create({
    data: {
      categoriaId: cat1.id,
      faseEliminatoriaId: faseCuartos.id,
      pareja1Id: null,
      pareja2Id: null,
      origenPareja1: '1° Zona A',
      origenPareja2: '2° Zona B',
      estado: 'PENDIENTE',
      posicionEnRonda: 1,
      fechaHora: new Date('2026-10-16T16:00:00Z'),
      canchaNumero: 1,
    }
  });

  // Match 2: 1° Zona B vs 2° Zona A (López / Martínez clasificó 2° en Zona A, sin horario aún)
  await prisma.partido.create({
    data: {
      categoriaId: cat1.id,
      faseEliminatoriaId: faseCuartos.id,
      pareja1Id: null,
      pareja2Id: null,
      origenPareja1: '1° Zona B',
      origenPareja2: '2° Zona A',
      estado: 'PENDIENTE',
      posicionEnRonda: 2,
      fechaHora: null,
      canchaNumero: null,
    }
  });

  // Match 3: p10 vs null (Esperando rival con pareja1Id explícito)
  await prisma.partido.create({
    data: {
      categoriaId: cat1.id,
      faseEliminatoriaId: faseCuartos.id,
      pareja1Id: p10.id,
      pareja2Id: null,
      origenPareja1: '1° Zona D',
      origenPareja2: '2° Zona C',
      estado: 'PENDIENTE',
      posicionEnRonda: 3,
      fechaHora: new Date('2026-10-16T18:00:00Z'),
      canchaNumero: 2,
    }
  });

  // Match 4: p11 vs p12 (Partido pendiente con ambas parejas asignadas)
  await prisma.partido.create({
    data: {
      categoriaId: cat1.id,
      faseEliminatoriaId: faseCuartos.id,
      pareja1Id: p11.id,
      pareja2Id: p12.id,
      origenPareja1: '1° Zona C',
      origenPareja2: '2° Zona D',
      estado: 'PENDIENTE',
      posicionEnRonda: 4,
      fechaHora: null,
      canchaNumero: null,
    }
  });

  // Categoría 2: MiniBracket Finalizada (Verificación condición 2)
  const cat2 = await prisma.categoria.create({
    data: {
      torneoId: torneo.id,
      nombre: 'Cat MiniBracket',
      estado: 'EN_CURSO',
    }
  });

  const mbP1 = await prisma.pareja.create({ data: { categoriaId: cat2.id, jugador1: 'Aladín', jugador2: 'Pérez', orden: 1 } });
  const mbP2 = await prisma.pareja.create({ data: { categoriaId: cat2.id, jugador1: 'Bertolotti', jugador2: 'Cattaneo', orden: 2 } });
  const mbP3 = await prisma.pareja.create({ data: { categoriaId: cat2.id, jugador1: 'Calderón', jugador2: 'Manzano', orden: 3 } });
  const mbP4 = await prisma.pareja.create({ data: { categoriaId: cat2.id, jugador1: 'Nieto', jugador2: 'Gauna', orden: 4 } });

  const zonaMB = await prisma.zona.create({
    data: {
      categoriaId: cat2.id,
      nombre: 'Zona MB',
      formato: 'MINI_BRACKET',
      clasifican: 3,
    }
  });

  // Finalizada: mbP1 (1°), mbP2 (2°), mbP3 (3°), mbP4 (4°)
  await prisma.zonaPareja.createMany({
    data: [
      { zonaId: zonaMB.id, parejaId: mbP1.id, posicion: 1, pj: 2, pg: 2, pp: 0, sf: 4, sc: 0, gf: 24, gc: 8, puntos: 6 },
      { zonaId: zonaMB.id, parejaId: mbP2.id, posicion: 2, pj: 2, pg: 1, pp: 1, sf: 2, sc: 2, gf: 18, gc: 18, puntos: 3 },
      { zonaId: zonaMB.id, parejaId: mbP3.id, posicion: 3, pj: 2, pg: 1, pp: 1, sf: 2, sc: 3, gf: 16, gc: 20, puntos: 3 },
      { zonaId: zonaMB.id, parejaId: mbP4.id, posicion: 4, pj: 2, pg: 0, pp: 2, sf: 1, sc: 4, gf: 12, gc: 24, puntos: 0 },
    ]
  });

  await prisma.partido.createMany({
    data: [
      { categoriaId: cat2.id, zonaId: zonaMB.id, pareja1Id: mbP1.id, pareja2Id: mbP2.id, ganadorId: mbP1.id, estado: 'FINALIZADO', posicionEnRonda: 1 },
      { categoriaId: cat2.id, zonaId: zonaMB.id, pareja1Id: mbP3.id, pareja2Id: mbP4.id, ganadorId: mbP3.id, estado: 'FINALIZADO', posicionEnRonda: 2 },
      { categoriaId: cat2.id, zonaId: zonaMB.id, pareja1Id: mbP1.id, pareja2Id: mbP3.id, ganadorId: mbP1.id, estado: 'FINALIZADO', posicionEnRonda: 3 },
      { categoriaId: cat2.id, zonaId: zonaMB.id, pareja1Id: mbP2.id, pareja2Id: mbP4.id, ganadorId: mbP2.id, estado: 'FINALIZADO', posicionEnRonda: 4 },
    ]
  });

  console.log('✅ Seed test-mi-pareja completado exitosamente.');
  console.log('Torneo: /torneo/test-mi-pareja');
  console.log('Cat 1 ID:', cat1.id);
  console.log('  p1 (Clasificado esperando elim):', p1.id, 'Leone / Díaz');
  console.log('  p3 (Sin partidos pendientes):', p3.id, 'Pérez / Romero');
  console.log('  p4 (EN_CURSO):', p4.id, 'Nieva / Castro');
  console.log('  p6 (Pendiente con horario):', p6.id, 'Alonso / Torres');
  console.log('  p7 (Zona C Sin jugar):', p7.id, 'Suárez / Blanco');
  console.log('  p10 (Esperando rival):', p10.id, 'Silva / Benítez');
  console.log('  p11 (Pendiente sin horario):', p11.id, 'Ruiz / Vega');
  console.log('Cat 2 ID:', cat2.id);
  console.log('  mbP1 (MB 1° clasificado):', mbP1.id);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
