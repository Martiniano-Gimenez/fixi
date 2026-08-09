const prisma = require('../lib/prisma');

const DIAS_VALIDOS = ['Viernes', 'Sabado'];

/**
 * Reemplaza todas las franjas de disponibilidad de una pareja.
 * Recibe franjas: [{ dia, horaInicio, horaFin }]
 */
async function setDisponibilidades(parejaId, franjas) {
  // Validar que la pareja exista
  const pareja = await prisma.pareja.findUnique({ where: { id: parejaId } });
  if (!pareja) {
    const err = new Error('Pareja no encontrada.');
    err.statusCode = 404;
    throw err;
  }

  // Validar cada franja
  for (const f of franjas) {
    if (!DIAS_VALIDOS.includes(f.dia)) {
      const err = new Error(`Día inválido: "${f.dia}". Solo se aceptan: ${DIAS_VALIDOS.join(', ')}.`);
      err.statusCode = 400;
      throw err;
    }
    if (!f.horaInicio || !f.horaFin) {
      const err = new Error('Cada franja debe tener horaInicio y horaFin.');
      err.statusCode = 400;
      throw err;
    }
    if (f.horaInicio >= f.horaFin) {
      const err = new Error(`horaFin debe ser mayor que horaInicio en la franja del ${f.dia}.`);
      err.statusCode = 400;
      throw err;
    }
  }

  // Reemplazar atómicamente (delete + createMany)
  await prisma.$transaction(async (tx) => {
    await tx.disponibilidadPareja.deleteMany({ where: { parejaId } });
    if (franjas.length > 0) {
      await tx.disponibilidadPareja.createMany({
        data: franjas.map((f) => ({
          parejaId,
          dia: f.dia,
          horaInicio: f.horaInicio,
          horaFin: f.horaFin,
        })),
      });
    }
  });

  return prisma.disponibilidadPareja.findMany({ where: { parejaId } });
}

/**
 * Devuelve todas las franjas de disponibilidad de una pareja.
 */
async function getDisponibilidades(parejaId) {
  return prisma.disponibilidadPareja.findMany({
    where: { parejaId },
    orderBy: [{ dia: 'asc' }, { horaInicio: 'asc' }],
  });
}

/**
 * Convierte "HH:MM" a minutos desde medianoche.
 */
function horaAMinutos(hora) {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Calcula los minutos totales de solapamiento entre dos conjuntos de franjas.
 * Compara por día: para cada día en común, suma la intersección de rangos.
 * Devuelve 0 si no hay solapamiento.
 *
 * @param {Array<{dia, horaInicio, horaFin}>} franjasA
 * @param {Array<{dia, horaInicio, horaFin}>} franjasB
 * @returns {number} minutos en común
 */
function calcularSolapamientoMinutos(franjasA, franjasB) {
  let totalMinutos = 0;

  for (const fA of franjasA) {
    for (const fB of franjasB) {
      if (fA.dia !== fB.dia) continue;

      const inicioA = horaAMinutos(fA.horaInicio);
      const finA = horaAMinutos(fA.horaFin);
      const inicioB = horaAMinutos(fB.horaInicio);
      const finB = horaAMinutos(fB.horaFin);

      const inicioComun = Math.max(inicioA, inicioB);
      const finComun = Math.min(finA, finB);

      if (finComun > inicioComun) {
        totalMinutos += finComun - inicioComun;
      }
    }
  }

  return totalMinutos;
}

module.exports = {
  setDisponibilidades,
  getDisponibilidades,
  calcularSolapamientoMinutos,
};
