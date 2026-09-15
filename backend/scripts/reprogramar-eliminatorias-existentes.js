const prisma = require('../src/lib/prisma');
const { programarHorariosEliminatorias } = require('../src/services/eliminatoriaScheduler.service');

async function main() {
  console.log('=== REPROGRAMADOR DE ELIMINATORIAS PARA TORNEOS ACTIVOS ===\n');

  const torneos = await prisma.torneo.findMany({
    where: {
      estado: 'EN_CURSO',
    },
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

  console.log(`Se encontraron ${torneos.length} torneo(s) EN_CURSO.\n`);

  for (const torneo of torneos) {
    console.log(`Torneo: "${torneo.nombre}" (${torneo.id})`);
    console.log(`Organizador: ${torneo.organizador.nombre} (${torneo.organizadorId})`);

    const totalCruces = torneo.categorias.reduce(
      (acc, c) => acc + c.fasesEliminatorias.reduce((pAcc, f) => pAcc + f.partidos.length, 0),
      0
    );
    console.log(`Total partidos de eliminatorias en todas sus categorías: ${totalCruces}`);

    if (totalCruces === 0) {
      console.log('  Sin cruces generados, salteando.\n');
      continue;
    }

    try {
      const res = await programarHorariosEliminatorias(torneo.organizadorId, torneo.id);
      console.log('  Resultado programación:', res);
    } catch (err) {
      console.error(`  Error programando torneo ${torneo.id}:`, err.message);
    }

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
        { categoria: { ordenDomingo: 'asc' } },
        { faseEliminatoria: { ronda: 'desc' } },
        { posicionEnRonda: 'asc' },
      ],
    });

    const conHorario = partidosEliminatoria.filter((p) => p.fechaHora && p.canchaNumero);
    const sinHorario = partidosEliminatoria.filter((p) => !p.fechaHora || !p.canchaNumero);

    console.log(`  Cruces con horario y cancha asignados: ${conHorario.length}/${partidosEliminatoria.length}`);
    if (sinHorario.length > 0) {
      console.log(`  ADVERTENCIA: ${sinHorario.length} partidos quedaron sin horario.`);
    } else {
      console.log('  ¡Éxito! 100% de los cruces tienen cancha y horario asignado.');
    }

    console.log('\nMuestra de partidos asignados:');
    for (const p of conHorario.slice(0, 10)) {
      const d = new Date(p.fechaHora);
      const diaNom = d.toLocaleDateString('es-AR', { weekday: 'short' });
      const horaStr = d.toTimeString().slice(0, 5);
      console.log(`    [Cat: ${p.categoria.nombre} | Ronda ${p.faseEliminatoria.ronda} #${p.posicionEnRonda}] -> ${diaNom} ${horaStr}hs - Cancha ${p.canchaNumero}`);
    }
    console.log('--------------------------------------------------\n');
  }

  console.log('=== PROCESO FINALIZADO ===');
}

main()
  .catch((e) => {
    console.error('Error fatal:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
