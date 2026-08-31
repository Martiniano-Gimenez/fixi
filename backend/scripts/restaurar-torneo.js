const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const { execSync } = require('child_process');
const prisma = new PrismaClient();

async function restaurar() {
  console.log('🌱 Restaurando datos del usuario en demo@padel.com...');

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

  // 2. Crear Organizador demo
  const passwordHash = await bcrypt.hash('123456', 10);
  const organizador = await prisma.organizador.create({
    data: {
      nombre: 'Club Central Pádel',
      email: 'demo@padel.com',
      passwordHash,
      cantidadCanchas: 6,
      viernesInicio: '13:00',
      viernesFin: '23:00',
      sabadoInicio: '09:00',
      sabadoFin: '22:00',
    },
  });
  console.log('✅ Organizador demo@padel.com creado con 6 canchas');

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
  console.log(`✅ Torneo creado: "${torneo.nombre}" (ID: ${torneo.id})`);

  // 4. Crear las 4 categorías
  const nombresCategorias = ['5ta', '7ma', '7ma Damas', 'Suma 7'];
  for (const nombre of nombresCategorias) {
    await prisma.categoria.create({
      data: {
        torneoId: torneo.id,
        nombre,
        estado: 'BORRADOR',
      },
    });
    console.log(`✅ Categoría creada: ${nombre}`);
  }

  await prisma.$disconnect();

  // 5. Ejecutar script de importación de parejas desde el XLSX
  const excelPath = path.resolve(__dirname, '../../Inscripciones_Padel_Ordenado.xlsx');
  console.log(`\n📋 Ejecutando importación desde "${excelPath}"...`);
  
  const cmd = `node scripts/importar-parejas-test.js --archivo="${excelPath}" --torneoId=${torneo.id}`;
  const output = execSync(cmd, { cwd: path.resolve(__dirname, '..'), encoding: 'utf-8' });
  console.log(output);

  console.log('🎉 Torneo con 4 categorías y parejas restaurado exitosamente!');
}

restaurar().catch(console.error);
