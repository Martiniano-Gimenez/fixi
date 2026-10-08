'use strict';

const prisma = require('../../src/lib/prisma');
const { programarHorariosEliminatorias } = require('../../src/services/eliminatoriaScheduler.service');
const { requireConfirmarDev, crearBackupDevDb } = require('./devUtils');

async function main() {
  console.log('=== REPROGRAMADOR DE ELIMINATORIAS (DEV-TOOLS) ===\n');

  requireConfirmarDev('reprogramar-eliminatorias-existentes.js');

  const args = process.argv.slice(2);
  const torneoArg = args.find((a) => a.startsWith('--torneoId='));
  const torneoId = torneoArg ? torneoArg.split('=')[1].trim() : null;

  if (!torneoId) {
    console.error('❌ Parámetro obligatorio faltante: --torneoId=<id>');
    console.error('Ejemplo: node scripts/dev-tools/reprogramar-eliminatorias-existentes.js --confirmar-dev --torneoId=<uuid>');
    process.exit(1);
  }

  const torneo = await prisma.torneo.findUnique({
    where: { id: torneoId },
    include: {
      organizador: true,
      categorias: {
        include: {
          fasesEliminatorias: {
            include: {
              partidos: true,
            },
          },
        },
      },
    },
  });

  if (!torneo) {
    console.error(`❌ No se encontró ningún torneo con id="${torneoId}".`);
    process.exit(1);
  }

  crearBackupDevDb();

  console.log(`Torneo encontrado: "${torneo.nombre}" (${torneo.id}) | Estado: ${torneo.estado}`);
  console.log(`Organizador: ${torneo.organizador.nombre} (${torneo.organizadorId})`);

  const totalCruces = torneo.categorias.reduce(
    (acc, c) => acc + c.fasesEliminatorias.reduce((pAcc, f) => pAcc + f.partidos.length, 0),
    0
  );
  console.log(`Total partidos de eliminatorias en todas sus categorías: ${totalCruces}`);

  if (totalCruces === 0) {
    console.log('El torneo no tiene cruces generados.');
    return;
  }

  const res = await programarHorariosEliminatorias(torneo.organizadorId, torneo.id);
  console.log('Resultado programación:', res);

  // Verificar el estado post-programación
  const partidosEliminatoria = await prisma.partido.findMany({
    where: {
      faseEliminatoriaId: { not: null },
      categoria: { torneoId: torneo.id },
    },
    include: {
      faseEliminatoria: true,
      categoria: true,
    },
    orderBy: [
      { categoria: { nombre: 'asc' } },
      { faseEliminatoria: { ronda: 'desc' } },
      { posicionEnRonda: 'asc' },
    ],
  });

  const conHorario = partidosEliminatoria.filter((p) => p.fechaHora && p.canchaNumero);
  const sinHorario = partidosEliminatoria.filter((p) => !p.fechaHora || !p.canchaNumero);

  console.log(`Cruces con horario y cancha asignados: ${conHorario.length}/${partidosEliminatoria.length}`);
  if (sinHorario.length > 0) {
    console.log(`ADVERTENCIA: ${sinHorario.length} partidos quedaron sin horario.`);
  } else {
    console.log('¡Éxito! 100% de los cruces tienen cancha y horario asignado.');
  }

  console.log('\n=== PROCESO FINALIZADO ===');
}

main()
  .catch((e) => {
    console.error('Error fatal:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
