const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const prisma = new PrismaClient();

// Re-usamos servicios para asegurar la lógica de negocio correcta
const zonaService = require('../src/services/zona.service');
const partidoService = require('../src/services/partido.service');

async function main() {
  console.log('🌱 Iniciando seed...');

  // 1. Limpiar base de datos (con cuidado, solo porque es demo local)
  await prisma.setPartido.deleteMany();
  await prisma.partido.deleteMany();
  await prisma.faseEliminatoria.deleteMany();
  await prisma.zonaPareja.deleteMany();
  await prisma.zona.deleteMany();
  await prisma.pareja.deleteMany();
  await prisma.torneo.deleteMany();
  await prisma.organizador.deleteMany();

  // 2. Crear Organizador
  const passwordHash = await bcrypt.hash('123456', 10);
  const organizador = await prisma.organizador.create({
    data: {
      nombre: 'Admin Demo',
      email: 'demo@padel.com',
      passwordHash,
    },
  });
  console.log(`✅ Organizador creado: demo@padel.com (PW: 123456)`);

  // 3. Crear Torneo
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

  // 4. Crear Parejas (12 parejas)
  const nombres = [
    ['Martin', 'Juan'], ['Lucas', 'Diego'], ['Pablo', 'Fede'],
    ['Gaston', 'Nico'], ['Ale', 'Maxi'], ['Leo', 'Tomi'],
    ['Facu', 'Santi'], ['Ema', 'Mati'], ['Rami', 'Bauti'],
    ['Fran', 'Gonza'], ['Joaquin', 'Agustin'], ['Ignacio', 'Bruno']
  ];

  for (let i = 0; i < nombres.length; i++) {
    await prisma.pareja.create({
      data: {
        torneoId: torneo.id,
        jugador1: nombres[i][0],
        jugador2: nombres[i][1],
        orden: i + 1,
      },
    });
  }
  console.log(`✅ 12 Parejas inscritas`);

  // 5. Iniciar Torneo (Genera zonas y partidos)
  console.log(`⚙️ Iniciando torneo (sorteo de zonas)...`);
  await zonaService.iniciarTorneo(organizador.id, torneo.id);
  console.log(`✅ Zonas generadas`);

  // 6. Cargar algunos resultados de prueba
  // Buscamos un par de partidos al azar de la primera zona
  const partidos = await prisma.partido.findMany({
    where: { torneoId: torneo.id, zonaId: { not: null } },
    take: 3,
  });

  if (partidos.length > 0) {
    // Simulamos resultados para 3 partidos
    const resultadosMock = [
      [{ gamesPareja1: 6, gamesPareja2: 4 }, { gamesPareja1: 7, gamesPareja2: 5 }], // Gana P1 2-0
      [{ gamesPareja1: 4, gamesPareja2: 6 }, { gamesPareja1: 6, gamesPareja2: 2 }, { gamesPareja1: 6, gamesPareja2: 3 }], // Gana P1 2-1
      [{ gamesPareja1: 1, gamesPareja2: 6 }, { gamesPareja1: 2, gamesPareja2: 6 }], // Gana P2 0-2
    ];

    console.log(`⚙️ Cargando resultados de prueba en 3 partidos...`);
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
