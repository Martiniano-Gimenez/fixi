'use strict';

const crypto = require('crypto');
const { prepararProblemaZona, compatibleConAsignaciones, verificarProgramacionZona } = require('./programacionZona');
const { calcularAmpliacion } = require('./propuestasZona');

const TAMANO_PAGINA = 6;
const MAX_NODOS_PAGINA = 20_000;
const MAX_NODOS_OPCION = 2_000;
const DURACION_MS = 75 * 60_000;
const solapan = (a, b) => a.startMs < b.endMs && b.startMs < a.endMs;
const tieneHorario = (p) => Boolean(p.fechaHora && p.canchaNumero && !p.sinHorarioAsignado);
const hash = (valor) => crypto.createHash('sha256').update(JSON.stringify(valor)).digest('hex').slice(0, 32);

function listarPartidosZona(zona) {
  return [...zona.partidos].sort((a, b) => a.posicionEnRonda - b.posicionEnRonda).map((p) => {
    const derivado = zona.formato === 'MINI_BRACKET' && p.posicionEnRonda >= 3;
    return { posicionEnRonda: p.posicionEnRonda, pareja1Id: derivado ? null : p.pareja1Id ?? null,
      pareja2Id: derivado ? null : p.pareja2Id ?? null,
      ...(derivado ? { origen: p.origen || (p.origenPareja1 && p.origenPareja2
        ? `${p.origenPareja1} vs ${p.origenPareja2}`
        : p.posicionEnRonda === 3 ? 'Ganador P1 vs Ganador P2' : 'Perdedor P1 vs Perdedor P2') } : {}),
      fechaHora: tieneHorario(p) ? new Date(p.fechaHora).toISOString() : null,
      canchaNumero: tieneHorario(p) ? p.canchaNumero : null,
      estado: tieneHorario(p) ? 'FIJO' : 'PENDIENTE' };
  });
}

function leerCursor(cursor, clavePartido) {
  if (cursor == null) return 0;
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const [clave, offset] = JSON.parse(json);
    if (clave === clavePartido && Number.isSafeInteger(offset) && offset > 0 &&
        Buffer.from(JSON.stringify([clave, offset])).toString('base64url') === cursor) return offset;
  } catch { /* Cursor mal formado o de otro partido. */ }
  throw Object.assign(new Error('El cursor de horarios no es válido para este partido.'), {
    statusCode: 400, codigo: 'CURSOR_HORARIOS_INVALIDO',
  });
}

/** Opciones por INICIO, nunca por cancha. Solo se ocultan imposibilidades probadas.
 * La viabilidad es estructural: todas las disponibilidades se pueden ampliar,
 * pero se conservan la ocupación ajena, los fijos propios y las dependencias mini.
 * El presupuesto se comparte por página, sin depender del tiempo de ejecución. */
function obtenerOpcionesPartidoZona(entrada, posicionEnRonda, { cursor = null } = {}) {
  const { pares, mini, tareas, courtTimelines, parejaAssignments, cantidadCanchas } = prepararProblemaZona(entrada);
  const indice = tareas.findIndex((t) => t.posicionEnRonda === posicionEnRonda);
  if (indice < 0) throw Object.assign(new Error('El partido no pertenece a esta zona.'), {
    statusCode: 404, codigo: 'PARTIDO_PRECHECK_NO_ENCONTRADO',
  });
  const clavePartido = hash([entrada.claveZona || pares.map((p) => p.orden), posicionEnRonda]);
  const offset = leerCursor(cursor, clavePartido);
  const tarea = tareas[indice];
  if (tieneHorario(tarea.partido) || (tarea.derivado && tareas.slice(0, 2).some((t) => !tieneHorario(t.partido)))) {
    return { opciones: [], siguienteCursor: null };
  }
  const fijos = new Map(tareas.flatMap((t, i) => tieneHorario(t.partido) ? [[i, {
    startMs: +new Date(t.partido.fechaHora), endMs: +new Date(t.partido.fechaHora) + DURACION_MS,
    canchaNumero: t.partido.canchaNumero,
  }]] : []));
  const candidatos = [];
  const inicios = new Set();
  for (const s of [...entrada.grilla].sort((a, b) => a.startMs - b.startMs)) {
    if (inicios.has(s.startMs) || !['Viernes', 'Sabado'].includes(s.dia) ||
        !entrada.ventanasClub.some((w) => w.dia === s.dia && s.startMs >= w.startMs && s.endMs <= w.endMs)) continue;
    inicios.add(s.startMs);
    if (tarea.participantes.some((i) => (parejaAssignments.get(pares[i].id) || []).some((o) => solapan(s, o)))) continue;
    // La fijación futura debe elegir esta misma regla: primera cancha libre compatible.
    let canchaNumero;
    for (let cancha = 1; cancha <= cantidadCanchas; cancha++) {
      if (!(courtTimelines.get(cancha) || []).some((o) => solapan(s, o)) &&
          compatibleConAsignaciones(tarea, { ...s, canchaNumero: cancha }, tareas, fijos, mini)) {
        canchaNumero = cancha; break;
      }
    }
    if (!canchaNumero) continue;
    const faltan = tarea.participantes.filter((i) => pares[i].ventanas.length && !pares[i].ventanas.some((w) =>
      w.dia === s.dia && s.startMs >= w.startMs && s.endMs <= w.endMs));
    const costos = faltan.map((i) => calcularAmpliacion([s], pares[i].ventanas));
    candidatos.push({ slot: s, canchaNumero, opcion: {
      clave: hash([clavePartido, s.slotId]), slotId: s.slotId, fechaHora: new Date(s.startMs).toISOString(),
      parejasAAmpliar: faltan.map((i) => pares[i].id),
      diasNuevos: costos.reduce((n, c) => n + c.diasNuevos, 0),
      minutosAmpliacion: costos.reduce((n, c) => n + c.minutosAmpliacion, 0),
    } });
  }
  candidatos.sort((a, b) => Number(Boolean(a.opcion.parejasAAmpliar.length)) - Number(Boolean(b.opcion.parejasAAmpliar.length)) ||
    a.opcion.diasNuevos - b.opcion.diasNuevos || a.opcion.minutosAmpliacion - b.opcion.minutosAmpliacion || a.slot.startMs - b.slot.startMs);
  if (offset > candidatos.length) throw Object.assign(new Error('El cursor excede los horarios del partido.'), {
    statusCode: 400, codigo: 'CURSOR_HORARIOS_INVALIDO',
  });
  const opciones = [];
  let siguiente = offset, presupuesto = entrada.maxNodosPagina ?? MAX_NODOS_PAGINA;
  while (siguiente < candidatos.length && opciones.length < TAMANO_PAGINA) {
    const candidato = candidatos[siguiente++];
    const resultado = verificarProgramacionZona({ ...entrada,
      maxNodos: Math.min(presupuesto, entrada.maxNodosOpcion ?? MAX_NODOS_OPCION),
      parejas: pares.map((p) => ({ ...p, ventanas: [] })),
      partidos: tareas.map((t, i) => i === indice ? { ...t.partido,
        fechaHora: candidato.opcion.fechaHora, canchaNumero: candidato.canchaNumero, sinHorarioAsignado: false,
      } : t.partido),
    });
    presupuesto -= resultado.nodos;
    if (resultado.estado !== 'NO_FACTIBLE') opciones.push({ ...candidato.opcion, verificada: resultado.estado === 'FACTIBLE' });
  }
  return { opciones, siguienteCursor: siguiente < candidatos.length
    ? Buffer.from(JSON.stringify([clavePartido, siguiente])).toString('base64url') : null };
}

module.exports = { obtenerOpcionesPartidoZona, listarPartidosZona, TAMANO_PAGINA, MAX_NODOS_PAGINA, MAX_NODOS_OPCION };
