const prisma = require('../src/lib/prisma');

async function check() {
  const impares = await prisma.torneo.findFirst({
    where: { nombre: { contains: 'Impares' } },
    include: {
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

  if (!impares) {
    console.log('No se encontró torneo Impares');
    return;
  }

  console.log(`Torneo: ${impares.nombre} (${impares.id}), Estado: ${impares.estado}`);
  for (const cat of impares.categorias) {
    console.log(`\nCategoría: ${cat.nombre}`);
    for (const fase of cat.fasesEliminatorias) {
      console.log(`  Ronda ${fase.ronda}: ${fase.partidos.length} partido(s)`);
      for (const p of fase.partidos) {
        const fh = p.fechaHora ? new Date(p.fechaHora).toISOString() : 'SIN FECHA';
        console.log(`    Pos ${p.posicionEnRonda}: ${fh} | Cancha ${p.canchaNumero} | SinHorario: ${p.sinHorarioAsignado} | P1: ${p.origenPareja1 || p.pareja1Id} vs P2: ${p.origenPareja2 || p.pareja2Id}`);
      }
    }
  }
}

check().catch(console.error).finally(() => prisma.$disconnect());
