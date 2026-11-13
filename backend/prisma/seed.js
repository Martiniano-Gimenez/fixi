const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

const organizadorService = require('../src/services/organizador.service');
const partidoService = require('../src/services/partido.service');
const canchasOverridesService = require('../src/services/canchasOverrides.service');
const { generarSlotsDia } = require('../src/services/slots.service');

// Datos de demo: todos los nombres son ficticios.
const CATEGORIAS = [
  {
    nombre: '4ta Caballeros',
    parejas: [
      ['Martín Leone', 'Juan Ponce'], ['Lucas Fernández', 'Diego Amaya'], ['Pablo Ruarte', 'Fede Longo'],
      ['Gastón Silva', 'Nico Romero'], ['Ale Benítez', 'Maxi López'], ['Leo Díaz', 'Tomi Ruiz'],
      ['Santi Rivero', 'Joaco Vidal'], ['Mati Godoy', 'Bruno Paredes'], ['Franco Ibarra', 'Lauti Soria'],
      ['Agus Peralta', 'Facu Ledesma'], ['Rami Toledo', 'Nacho Vera'], ['Emi Bravo', 'Tincho Escobar'],
    ],
  },
  {
    nombre: '6ta Caballeros',
    parejas: [
      ['Facu Méndez', 'Santi Nieva'], ['Ema Ortiz', 'Matías Tapia'], ['Ramiro Castro', 'Bautista Herrera'],
      ['Franco Mendoza', 'Gonzalo Vargas'], ['Joaquín Flores', 'Agustín Morales'], ['Ignacio Roldán', 'Bruno Cabrera'],
      ['Tomás Aguirre', 'Lucio Correa'], ['Dante Molina', 'Iván Salinas'], ['Marcos Zapata', 'Julián Bustos'],
    ],
  },
  {
    nombre: '7ma Damas',
    parejas: [
      ['Sofi Acuña', 'Cami Luna'], ['Juli Cáceres', 'Flor Gauna'], ['Male Ojeda', 'Vicky Suárez'],
      ['Agus Domínguez', 'Lu Pacheco'], ['Pili Rojas', 'Meli Torres'], ['Caro Varela', 'Anto Zárate'],
      ['Guada Mansilla', 'Mica Rearte'], ['Belu Ferraro', 'Jose Galli'],
    ],
  },
];

// Disponibilidades típicas de una inscripción; cada pareja toma una de la lista.
const DISPONIBILIDADES = [
  [['Viernes', '18:00', '23:30'], ['Sabado', '09:00', '13:00']],
  [['Viernes', '20:00', '23:30'], ['Sabado', '14:00', '20:00']],
  [['Sabado', '09:00', '20:00']],
  [['Viernes', '16:00', '22:00']],
  [['Viernes', '19:00', '23:30'], ['Sabado', '16:00', '21:00']],
  [['Sabado', '12:00', '21:00']],
];

const SETS_DEMO = [
  [[6, 4], [6, 3]],
  [[4, 6], [7, 5], [6, 2]],
  [[6, 2], [6, 2]],
  [[7, 6], [3, 6], [6, 4]],
  [[6, 1], [6, 4]],
];

// Próximo viernes a las 12:00 de Argentina, para que la demo siempre muestre un torneo por jugarse.
function proximoViernes() {
  const hoy = new Date();
  const dias = (5 - hoy.getUTCDay() + 7) % 7 || 7;
  return new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate() + dias, 15, 0, 0));
}

async function main() {
  console.log('🌱 Iniciando seed de demo...');

  // 1. Limpiar base de datos
  await prisma.precheckPlan.deleteMany();
  await prisma.overrideCanchasDia.deleteMany();
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
      nombre: 'Club Pádel Central',
      email: 'demo@padel.com',
      passwordHash,
      cantidadCanchas: 4,
      viernesInicio: '14:00',
      viernesFin: '23:59',
      sabadoInicio: '09:00',
      sabadoFin: '23:59',
      domingoInicio: '09:00',
      domingoFin: '21:00',
    },
  });
  console.log('✅ Organizador creado: demo@padel.com (PW: 123456)');

  // 3. Crear Torneo, categorías y parejas con su disponibilidad
  const torneo = await prisma.torneo.create({
    data: {
      nombre: 'Torneo de demo',
      fecha: proximoViernes(),
      estado: 'BORRADOR',
      slug: 'torneo-demo',
      organizadorId: organizador.id,
    },
  });

  let indiceDisponibilidad = 0;
  for (const { nombre, parejas } of CATEGORIAS) {
    const categoria = await prisma.categoria.create({
      data: { torneoId: torneo.id, nombre, estado: 'BORRADOR' },
    });
    for (let i = 0; i < parejas.length; i++) {
      const ventanas = DISPONIBILIDADES[indiceDisponibilidad++ % DISPONIBILIDADES.length];
      const slotIds = ventanas.flatMap(([dia, desde, hasta]) => generarSlotsDia(dia, desde, hasta));
      await prisma.pareja.create({
        data: {
          categoriaId: categoria.id,
          jugador1: parejas[i][0],
          jugador2: parejas[i][1],
          orden: i + 1,
          slotsSeleccionados: { create: slotIds.map((slotId) => ({ slotId })) },
        },
      });
    }
    console.log(`✅ ${nombre}: ${parejas.length} parejas`);
  }

  // 4. Iniciar el torneo con el mismo flujo que el panel: pre-check, zonas y horarios automáticos
  console.log('⚙️ Iniciando el torneo (armado de zonas y horarios)...');
  await canchasOverridesService.loadFromDb(); // el servidor la hidrata al arrancar
  await organizadorService.iniciarTorneoMultiCategoria(organizador.id, torneo.id);
  const programados = await prisma.partido.count({
    where: { categoria: { torneoId: torneo.id }, fechaHora: { not: null } },
  });
  console.log(`✅ Torneo iniciado: ${programados} partidos con horario`);

  // 5. Cargar resultados de los primeros partidos de zona de cada categoría
  const categorias = await prisma.categoria.findMany({ where: { torneoId: torneo.id }, orderBy: { nombre: 'asc' } });
  let cargados = 0;
  for (const categoria of categorias) {
    const partidos = await prisma.partido.findMany({
      where: {
        categoriaId: categoria.id,
        zonaId: { not: null },
        estado: 'PENDIENTE',
        fechaHora: { not: null },
        pareja1Id: { not: null },
        pareja2Id: { not: null },
      },
      orderBy: [{ fechaHora: 'asc' }, { canchaNumero: 'asc' }],
      take: 3,
    });
    for (const partido of partidos) {
      const sets = SETS_DEMO[cargados++ % SETS_DEMO.length].map(([gamesPareja1, gamesPareja2]) => ({ gamesPareja1, gamesPareja2 }));
      await partidoService.cargarResultado(organizador.id, partido.id, { sets });
    }
  }
  console.log(`✅ ${cargados} resultados cargados`);

  console.log('🎉 Seed finalizado con éxito!');
  console.log('👉 Panel: iniciá sesión con demo@padel.com / 123456');
  console.log('👉 Vista pública: /torneo/torneo-demo');
}

// organizador.service deja un setInterval de limpieza de caché que mantiene vivo el proceso:
// se sale de forma explícita al terminar.
main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
