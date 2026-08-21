const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const prisma = new PrismaClient();

const zonaService = require('../src/services/zona.service');
const partidoService = require('../src/services/partido.service');

async function main() {
  console.log('🌱 Iniciando seed...');

  // 1. Limpiar base de datos
  await prisma.setPartido.deleteMany();
  await prisma.partido.deleteMany();
  await prisma.faseEliminatoria.deleteMany();
  await prisma.zonaPareja.deleteMany();
  await prisma.zona.deleteMany();
  await prisma.slotPareja.deleteMany();
  await prisma.pareja.deleteMany();
  await prisma.categoria.deleteMany();
  await prisma.torneo.deleteMany();
  await prisma.organizador.deleteMany();

  // 2. Crear Organizador
  const passwordHash = await bcrypt.hash('123456', 10);
  const organizador = await prisma.organizador.create({
    data: {
      nombre: 'Club Padel Central',
      email: 'demo@padel.com',
      passwordHash,
      cantidadCanchas: 3,
      viernesInicio: '14:00',
      viernesFin: '23:00',
      sabadoInicio: '09:00',
      sabadoFin: '21:00',
    },
  });
  console.log(`✅ Organizador creado: demo@padel.com (PW: 123456)`);

  // 3. Crear Torneo (Evento)
  const slug = 'torneo-padel-pro-2026-' + crypto.randomBytes(3).toString('hex');
  const torneo = await prisma.torneo.create({
    data: {
      nombre: 'Torneo Pádel Pro 2026',
      fecha: new Date(),
      estado: 'BORRADOR',
      slug,
      organizadorId: organizador.id,
    },
  });
  console.log(`✅ Torneo creado: ${torneo.nombre}`);

  // 4. Crear Categorías (4ta y 6ta)
  const cat4ta = await prisma.categoria.create({
    data: {
      torneoId: torneo.id,
      nombre: '4ta Caballeros',
      estado: 'BORRADOR',
    },
  });

  const cat6ta = await prisma.categoria.create({
    data: {
      torneoId: torneo.id,
      nombre: '6ta Caballeros',
      estado: 'BORRADOR',
    },
  });
  console.log(`✅ Categorías creadas: 4ta y 6ta`);

  // 5. Crear Parejas (6 para 4ta y 6 para 6ta)
  const nombres4ta = [
    ['Martin Leone', 'Juan Ponce'],
    ['Lucas Fernandez', 'Diego Amaya'],
    ['Pablo Ruarte', 'Fede Longo'],
    ['Gaston Silva', 'Nico Romero'],
    ['Ale Benitez', 'Maxi Lopez'],
    ['Leo Diaz', 'Tomi Ruiz'],
  ];

  for (let i = 0; i < nombres4ta.length; i++) {
    await prisma.pareja.create({
      data: {
        categoriaId: cat4ta.id,
        jugador1: nombres4ta[i][0],
        jugador2: nombres4ta[i][1],
        orden: i + 1,
      },
    });
  }

  const nombres6ta = [
    ['Facu Mendez', 'Santi Nieva'],
    ['Ema Ortiz', 'Matias Tapia'],
    ['Ramiro Castro', 'Bautista Herrera'],
    ['Franco Mendoza', 'Gonzalo Vargas'],
    ['Joaquin Flores', 'Agustin Morales'],
    ['Ignacio Roldán', 'Bruno Cabrera'],
  ];

  for (let i = 0; i < nombres6ta.length; i++) {
    await prisma.pareja.create({
      data: {
        categoriaId: cat6ta.id,
        jugador1: nombres6ta[i][0],
        jugador2: nombres6ta[i][1],
        orden: i + 1,
      },
    });
  }
  console.log(`✅ 12 Parejas creadas en 4ta y 6ta`);

  // 6. Iniciar Categoría 4ta (Genera zonas y partidos)
  console.log(`⚙️ Iniciando categoría 4ta (sorteo de zonas)...`);
  await zonaService.iniciarCategoria(organizador.id, cat4ta.id);
  console.log(`✅ Zonas generadas`);

  // 7. Cargar algunos resultados de prueba en 4ta
  const partidos = await prisma.partido.findMany({
    where: { categoriaId: cat4ta.id, zonaId: { not: null } },
    take: 2,
  });

  if (partidos.length > 0) {
    const resultadosMock = [
      [{ gamesPareja1: 6, gamesPareja2: 4 }, { gamesPareja1: 7, gamesPareja2: 5 }],
      [{ gamesPareja1: 4, gamesPareja2: 6 }, { gamesPareja1: 6, gamesPareja2: 2 }, { gamesPareja1: 6, gamesPareja2: 3 }],
    ];

    console.log(`⚙️ Cargando resultados de prueba en 4ta...`);
    for (let i = 0; i < partidos.length; i++) {
      await partidoService.cargarResultado(organizador.id, partidos[i].id, {
        sets: resultadosMock[i],
      });
    }
    console.log(`✅ Resultados cargados`);
  }

  console.log('🎉 Seed finalizado con éxito!');
  console.log('👉 Iniciá sesión con demo@padel.com / 123456');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
