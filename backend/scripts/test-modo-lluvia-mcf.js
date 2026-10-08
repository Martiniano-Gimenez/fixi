const { ensureTestDb } = require('./utils/testEnvGuard');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const organizadorService = require('../src/services/organizador.service');
const zonaService = require('../src/services/zona.service');
const canchasOverridesService = require('../src/services/canchasOverrides.service');
const { parseFechaLocal, getDiaCalendarioConTrasnoche } = require('../src/utils/dateUtils');
const { horaAMinutos } = require('../src/services/slots.service');

/**
 * Test comparativo de regresión: Bucle Voraz vs. Scheduler MCF en Modo Lluvia
 */
async function testComparacionMCF() {
  await ensureTestDb();
  await canchasOverridesService.loadFromDb();
  console.log('🧪 Iniciando test comparativo: Bucle Voraz vs Scheduler MCF en Modo Lluvia...\n');

  let orgId = null;
  let torneoId = null;
  let catId = null;

  try {
    // Limpiar y crear organizador de prueba
    const orgEmail = `test-mcf-${Date.now()}@padel.com`;
    const organizador = await prisma.organizador.create({
      data: {
        nombre: 'Club Test MCF',
        email: orgEmail,
        passwordHash: 'hash123',
        cantidadCanchas: 6,
        viernesInicio: '14:00',
        viernesFin: '02:00',
        sabadoInicio: '09:00',
        sabadoFin: '02:00',
      },
    });
    orgId = organizador.id;

    const fechaTorneo = '2026-09-04'; // Viernes 4 de Septiembre 2026
    const torneo = await prisma.torneo.create({
      data: {
        nombre: 'Torneo Comparativo Lluvia',
        slug: `torneo-comp-${Date.now()}`,
        fecha: parseFechaLocal(fechaTorneo),
        estado: 'BORRADOR',
        organizadorId: organizador.id,
      },
    });
    torneoId = torneo.id;

    const cat = await prisma.categoria.create({
      data: {
        torneoId: torneo.id,
        nombre: '5ta',
        estado: 'BORRADOR',
      },
    });
    catId = cat.id;

    // Crear 12 parejas (6 cruces) con distintos grados de flexibilidad:
    // - 4 parejas RÍGIDAS (solo pueden jugar entre 18:00 y 20:30) -> Cruces A y B
    // - 8 parejas FLEXIBLES (pueden jugar entre 14:00 y 01:00) -> Cruces C, D, E, F
    const parejas = [];
    for (let i = 1; i <= 12; i++) {
      const p = await prisma.pareja.create({
        data: {
          categoriaId: cat.id,
          jugador1: `J1_${i}`,
          jugador2: `J2_${i}`,
          orden: i,
        },
      });

      const isRigida = i <= 4;
      const slots = [];
      if (isRigida) {
        // Solo 18:00 a 20:30
        const startMin = 18 * 60;
        const endMin = 20 * 60 + 30;
        for (let m = startMin; m + 75 <= endMin; m += 15) {
          const hh = Math.floor(m / 60).toString().padStart(2, '0');
          const mm = (m % 60).toString().padStart(2, '0');
          slots.push(`Viernes-${hh}:${mm}`);
        }
      } else {
        // 14:00 a 01:00 (muy flexible)
        const startMin = 14 * 60;
        const endMin = 25 * 60; // 01:00 trasnoche
        for (let m = startMin; m + 75 <= endMin; m += 15) {
          const clockM = m % (24 * 60);
          const hh = Math.floor(clockM / 60).toString().padStart(2, '0');
          const mm = (clockM % 60).toString().padStart(2, '0');
          slots.push(`Viernes-${hh}:${mm}`);
        }
      }

      for (const slotId of slots) {
        await prisma.slotPareja.create({
          data: { parejaId: p.id, slotId },
        });
      }
      parejas.push(p);
    }

    // Iniciar categoría y asignar horarios iniciales en 6 canchas
    await zonaService.iniciarCategoriaConDisponibilidad(organizador.id, cat.id);
    await zonaService.asignarHorariosAutomatico(organizador.id, cat.id);
    await prisma.torneo.update({ where: { id: torneo.id }, data: { estado: 'EN_CURSO' } });

    const partidosIniciales = await prisma.partido.findMany({
      where: { categoriaId: cat.id },
      select: { id: true, fechaHora: true, canchaNumero: true, pareja1Id: true, pareja2Id: true },
    });

    console.log(`✅ Categoría iniciada con ${partidosIniciales.length} partidos en 6 canchas.`);
    console.log('Horarios iniciales:', partidosIniciales.map(p => ({
      cancha: p.canchaNumero,
      hora: p.fechaHora?.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' })
    })));

    // 1. Ejecutar reducción a 4 canchas con la lógica actual
    console.log('\n🌧️ Ejecutando reducción a 4 canchas...');
    const resReduccion = await organizadorService.reprogramarPorReduccionCanchas(organizador.id, torneo.id, 4);
    console.log(`Resultado: ${resReduccion.message}`);

    const partidosPostReduccion = await prisma.partido.findMany({
      where: { categoriaId: cat.id },
      select: { id: true, fechaHora: true, canchaNumero: true, sinHorarioAsignado: true },
      orderBy: { fechaHora: 'asc' },
    });

    console.log('\n📊 Horarios tras reducción:');
    for (const p of partidosPostReduccion) {
      console.log(`  - Cancha ${p.canchaNumero || 'N/A'}: ${p.fechaHora ? p.fechaHora.toISOString() : 'SIN HORARIO'}`);
    }

    const horasMs = partidosPostReduccion.map(p => p.fechaHora ? new Date(p.fechaHora).getTime() : null).filter(Boolean);
    const maxHora = new Date(Math.max(...horasMs));
    const trasnocheCount = partidosPostReduccion.filter(p => {
      if (!p.fechaHora) return false;
      const d = new Date(p.fechaHora);
      const h = d.getHours();
      return h >= 0 && h < 6; // Madrugada trasnoche
    }).length;

    console.log('\n📈 Métricas actuales:');
    console.log(`  - Horario de cierre más tardío: ${maxHora.toISOString()}`);
    console.log(`  - Partidos en trasnoche (madrugada): ${trasnocheCount}`);
    console.log(`  - Partidos sin horario: ${resReduccion.reprogramacion.partidosSinHorarioNuevo}`);

    return { organizador, torneo, cat, maxHora, trasnocheCount, resReduccion };
  } finally {
    try {
      if (catId) {
        await prisma.slotPareja.deleteMany({ where: { pareja: { categoriaId: catId } } });
        await prisma.setPartido.deleteMany({ where: { partido: { categoriaId: catId } } });
        await prisma.partido.deleteMany({ where: { categoriaId: catId } });
        await prisma.faseEliminatoria.deleteMany({ where: { categoriaId: catId } });
        await prisma.zonaPareja.deleteMany({ where: { zona: { categoriaId: catId } } });
        await prisma.zona.deleteMany({ where: { categoriaId: catId } });
        await prisma.pareja.deleteMany({ where: { categoriaId: catId } });
        await prisma.categoria.deleteMany({ where: { id: catId } });
      }
      if (torneoId) {
        await prisma.overrideCanchasDia.deleteMany({ where: { torneoId } });
        await prisma.torneo.deleteMany({ where: { id: torneoId } });
      }
      if (orgId) {
        await prisma.organizador.deleteMany({ where: { id: orgId } });
      }
      console.log('✓ Limpieza en finally completada para test-modo-lluvia-mcf');
    } catch (cleanErr) {
      console.error('Error limpiando en finally:', cleanErr);
    }
  }
}

if (require.main === module) {
  testComparacionMCF()
    .then(async () => {
      console.log('\nTest completado exitosamente.');
      await prisma.$disconnect();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('Error:', err);
      await prisma.$disconnect();
      process.exit(1);
    });
}

module.exports = { testComparacionMCF };
