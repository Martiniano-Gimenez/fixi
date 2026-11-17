/**
 * Inscripción pública de parejas por link (/torneo/:slug/inscripcion).
 *
 * Reglas (sesión 88):
 * - La inscripción queda firme al enviarla (origen INSCRIPCION); la pareja no puede editarla.
 * - Disponibilidad obligatoria: al menos un slot o "Puedo en cualquier horario" (0 slots).
 * - Solo con el torneo y la categoría en BORRADOR y la inscripción abierta por el organizador.
 * - El teléfono se guarda en dígitos y nunca sale por /api/public/*.
 *
 * Los errores llevan `codigo` para que la página elija la pantalla sin leer el mensaje.
 */

const prisma = require('../lib/prisma');
const { getTorneoById } = require('./torneo.service');
const { generarGrillaOrganizador } = require('./slots.service');
const { validarSlotIdsEstricto } = require('./disponibilidad.service');
const { conReintentoOrden } = require('../utils/reintentoOrden');
const { colaAltasPareja } = require('../utils/colaSerial');

const MAX_NOMBRE = 60;
const MAX_PAREJAS_INSCRIPCION = 48;
const MIN_DIGITOS_TEL = 8;
const MAX_DIGITOS_TEL = 15; // E.164
// Transacción de inscripción: espera explícita por el bloqueo del torneo (inscripciones simultáneas)
const OPCIONES_TX = { maxWait: 10000, timeout: 15000 };

function error(statusCode, codigo, mensaje) {
  return Object.assign(new Error(mensaje), { statusCode, codigo });
}

const errores = {
  torneoNoEncontrado: () => error(404, 'TORNEO_NO_ENCONTRADO', 'No encontramos ese torneo. Revisá el link.'),
  torneoIniciado: () => error(409, 'TORNEO_INICIADO', 'El torneo ya empezó, así que la inscripción está cerrada.'),
  cerrada: () => error(409, 'INSCRIPCION_CERRADA', 'La inscripción de este torneo está cerrada.'),
  categoriaNoEncontrada: () => error(404, 'CATEGORIA_NO_DISPONIBLE', 'Esa categoría no existe en este torneo.'),
  categoriaIniciada: () => error(409, 'CATEGORIA_NO_DISPONIBLE', 'Esa categoría ya empezó y no acepta inscripciones.'),
  categoriaCompleta: () => error(409, 'CATEGORIA_COMPLETA', 'Esta categoría ya está completa. Elegí otra o consultá con la organización.'),
  duplicado: () => error(409, 'DUPLICADO', 'Esa pareja ya está inscripta en esta categoría. Si necesitás un cambio, avisale al organizador.'),
  datos: (mensaje) => error(400, 'DATOS_INVALIDOS', mensaje),
};

// Espacios colapsados; null si no es texto
function limpiarNombre(valor) {
  if (typeof valor !== 'string') return null;
  return valor.replace(/\s+/g, ' ').trim();
}

// Clave para detectar duplicados: sin acentos, minúsculas, espacios colapsados
function claveNombre(nombre) {
  return nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function clavePareja(j1, j2) {
  return [claveNombre(j1), claveNombre(j2)].sort().join('|');
}

function validarNombre(valor, etiqueta) {
  const nombre = limpiarNombre(valor);
  if (!nombre) throw errores.datos(`Falta el nombre del ${etiqueta}.`);
  if (nombre.length > MAX_NOMBRE) throw errores.datos(`El nombre del ${etiqueta} es demasiado largo (máximo ${MAX_NOMBRE} caracteres).`);
  return nombre;
}

function normalizarTelefono(valor) {
  const mensaje = `Ingresá un teléfono válido, con código de área (entre ${MIN_DIGITOS_TEL} y ${MAX_DIGITOS_TEL} números).`;
  if (typeof valor !== 'string' || !/^[\d\s+\-().]+$/.test(valor)) throw errores.datos(mensaje);
  const digitos = valor.replace(/\D/g, '');
  if (digitos.length < MIN_DIGITOS_TEL || digitos.length > MAX_DIGITOS_TEL) throw errores.datos(mensaje);
  return digitos;
}

function normalizarIndicaciones(valor) {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'string') throw errores.datos('Las indicaciones deben ser un texto.');
  const texto = valor.trim();
  if (texto.length > 300) throw errores.datos('Las indicaciones pueden tener hasta 300 caracteres.');
  return texto || null;
}

function validarDisponibilidad(organizador, slotIds, cualquierHorario) {
  if (slotIds !== undefined && slotIds !== null && !Array.isArray(slotIds)) {
    throw errores.datos('Los horarios elegidos no son válidos.');
  }
  if (cualquierHorario !== undefined && typeof cualquierHorario !== 'boolean') {
    throw errores.datos('Indicá si pueden jugar en cualquier horario.');
  }
  const tieneSlots = Array.isArray(slotIds) && slotIds.length > 0;
  const cualquiera = cualquierHorario === true;
  if (!tieneSlots && !cualquiera) {
    throw errores.datos('Indicá su disponibilidad: elegí al menos un horario o marcá "Puedo en cualquier horario".');
  }
  if (tieneSlots && cualquiera) {
    throw errores.datos('Elegí horarios o marcá "Puedo en cualquier horario", no las dos cosas.');
  }
  return cualquiera ? [] : validarSlotIdsEstricto(organizador, slotIds);
}

/**
 * GET /api/public/:slug/inscripcion
 */
async function getInscripcionPublica(slug) {
  const torneo = await prisma.torneo.findUnique({
    where: { slug },
    include: {
      organizador: true,
      categorias: {
        where: { estado: 'BORRADOR' },
        orderBy: [{ nombre: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, nombre: true, _count: { select: { parejas: true } } },
      },
    },
  });
  if (!torneo) throw errores.torneoNoEncontrado();

  const { viernes, sabado } = generarGrillaOrganizador(torneo.organizador); // sin domingo: es de eliminatorias
  return {
    torneo: {
      nombre: torneo.nombre,
      slug: torneo.slug,
      fecha: torneo.fecha,
      estado: torneo.estado,
      inscripcionAbierta: torneo.inscripcionAbierta,
    },
    categorias: torneo.categorias.map(({ id, nombre, _count }) => ({
      id, nombre, completa: _count.parejas >= MAX_PAREJAS_INSCRIPCION,
    })),
    grilla: { viernes, sabado },
  };
}

/**
 * POST /api/public/:slug/inscripcion
 * { categoriaId, jugador1, jugador2, telefono, indicaciones, slotIds, cualquierHorario, website }
 */
// Esperas de la base que no son culpa del pedido: P1008 (SQLite no respondió dentro del
// busy_timeout, por ejemplo mientras corre la transacción de inicio del torneo) y P2028 (la
// transacción no se pudo abrir dentro de maxWait o pasó su timeout). Se responde 503 para que
// la página pida reintentar, en vez de un 500.
const CODIGOS_ESPERA = new Set(['P1008', 'P2028']);

async function crearInscripcion(slug, body = {}) {
  try {
    return await crearInscripcionSinMapear(slug, body);
  } catch (err) {
    if (CODIGOS_ESPERA.has(err?.code)) {
      throw error(503, 'REINTENTAR', 'Hay mucha gente inscribiéndose en este momento. Probá de nuevo en unos segundos.');
    }
    throw err;
  }
}

async function crearInscripcionSinMapear(slug, body) {
  const { categoriaId, jugador1, jugador2, telefono, indicaciones, slotIds, cualquierHorario, website } = body || {};

  // Honeypot: un humano no ve el campo. Se responde como si se hubiera guardado.
  if (typeof website === 'string' ? website.trim() !== '' : website) {
    return {
      inscripcion: {
        torneo: { slug },
        categoria: { id: typeof categoriaId === 'string' ? categoriaId : null, nombre: null },
        jugador1: limpiarNombre(jugador1),
        jugador2: limpiarNombre(jugador2),
        cualquierHorario: cualquierHorario === true,
        slotIds: [],
      },
    };
  }

  const torneo = await prisma.torneo.findUnique({ where: { slug }, include: { organizador: true } });
  if (!torneo) throw errores.torneoNoEncontrado();
  if (torneo.estado !== 'BORRADOR') throw errores.torneoIniciado();
  if (!torneo.inscripcionAbierta) throw errores.cerrada();

  const nombre1 = validarNombre(jugador1, 'jugador 1');
  const nombre2 = validarNombre(jugador2, 'jugador 2');
  const telefonoDigitos = normalizarTelefono(telefono);
  const indicacionesTexto = normalizarIndicaciones(indicaciones);
  const slots = validarDisponibilidad(torneo.organizador, slotIds, cualquierHorario);

  const categoria = typeof categoriaId === 'string'
    ? await prisma.categoria.findUnique({ where: { id: categoriaId } })
    : null;
  if (!categoria || categoria.torneoId !== torneo.id) throw errores.categoriaNoEncontrada();
  if (categoria.estado !== 'BORRADOR') throw errores.categoriaIniciada();

  const clave = clavePareja(nombre1, nombre2);

  // Cola serial del proceso + reintento entre procesos (ver utils/colaSerial.js)
  const pareja = await colaAltasPareja(() => conReintentoOrden(() => prisma.$transaction(async (tx) => {
    // Primera escritura: toma el bloqueo del torneo (la fila en Postgres, la base en SQLite).
    // Serializa las inscripciones entre sí y con el inicio del torneo, que hace lo mismo al cerrar
    // la inscripción: lo que se lee después ya incluye lo que confirmó la otra transacción.
    const bloqueo = await tx.torneo.updateMany({
      where: { id: torneo.id, estado: 'BORRADOR', inscripcionAbierta: true },
      data: { inscripcionAbierta: true },
    });
    if (bloqueo.count === 0) {
      const actual = await tx.torneo.findUnique({ where: { id: torneo.id } });
      throw actual?.estado !== 'BORRADOR' ? errores.torneoIniciado() : errores.cerrada();
    }

    const cat = await tx.categoria.findUnique({ where: { id: categoria.id } });
    if (!cat || cat.estado !== 'BORRADOR') throw errores.categoriaIniciada();

    // El cupo incluye las altas del panel y se verifica bajo el mismo bloqueo que el alta.
    const cantidad = await tx.pareja.count({ where: { categoriaId: categoria.id } });
    if (cantidad >= MAX_PAREJAS_INSCRIPCION) throw errores.categoriaCompleta();

    const existentes = await tx.pareja.findMany({
      where: { categoriaId: categoria.id },
      select: { jugador1: true, jugador2: true },
    });
    if (existentes.some((p) => clavePareja(p.jugador1, p.jugador2) === clave)) throw errores.duplicado();

    const { _max } = await tx.pareja.aggregate({ where: { categoriaId: categoria.id }, _max: { orden: true } });
    const creada = await tx.pareja.create({
      data: {
        categoriaId: categoria.id,
        jugador1: nombre1,
        jugador2: nombre2,
        telefono: telefonoDigitos,
        indicaciones: indicacionesTexto,
        origen: 'INSCRIPCION',
        orden: (_max.orden ?? 0) + 1,
      },
    });
    if (slots.length > 0) {
      await tx.slotPareja.createMany({ data: slots.map((slotId) => ({ parejaId: creada.id, slotId })) });
    }
    return creada;
  }, OPCIONES_TX)));

  // Sin teléfono ni ids internos de la pareja
  return {
    inscripcion: {
      torneo: { nombre: torneo.nombre, slug: torneo.slug },
      categoria: { id: categoria.id, nombre: categoria.nombre },
      jugador1: pareja.jugador1,
      jugador2: pareja.jugador2,
      cualquierHorario: slots.length === 0,
      slotIds: slots,
    },
  };
}

/**
 * PATCH /api/torneos/:id/inscripcion { abierta } (panel del organizador)
 */
async function setInscripcionAbierta(organizadorId, torneoId, abierta) {
  if (typeof abierta !== 'boolean') throw errores.datos('Indicá si la inscripción queda abierta (true) o cerrada (false).');
  await getTorneoById(organizadorId, torneoId); // 404 / 403

  // Condicional, para no reabrir un torneo que se inició entre la lectura y la escritura
  const { count } = await prisma.torneo.updateMany({
    where: { id: torneoId, estado: 'BORRADOR' },
    data: { inscripcionAbierta: abierta },
  });
  if (count === 0) {
    throw error(409, 'TORNEO_INICIADO', 'Solo se puede abrir o cerrar la inscripción con el torneo en borrador.');
  }
  return { id: torneoId, inscripcionAbierta: abierta };
}

module.exports = {
  getInscripcionPublica,
  crearInscripcion,
  setInscripcionAbierta,
  claveNombre,
  normalizarTelefono,
  MAX_NOMBRE,
  MAX_PAREJAS_INSCRIPCION,
};
