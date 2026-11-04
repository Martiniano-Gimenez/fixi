'use strict';

const crypto = require('crypto');
const { prepararProblemaZona, compatibleConAsignaciones, verificarProgramacionZona } = require('./programacionZona');
const { calcularAmpliacion } = require('./propuestasZona');

const MAX_NODOS_OPCION = 2_000;
const DURACION_MS = 75 * 60_000;
const solapan = (a, b) => a.startMs < b.endMs && b.startMs < a.endMs;
const tieneHorario = (p) => Boolean(p.fechaHora && p.canchaNumero && !p.sinHorarioAsignado);
const hash = (valor) => crypto.createHash('sha256').update(JSON.stringify(valor)).digest('hex').slice(0, 32);

/**
 * Detalle por pareja de lo que calcularAmpliacion suma para un inicio: minutos antes del primer bloque del día,
 * después del último, o un día que no tenía. Entre dos bloques se cuenta hacia el lado que cuesta menos, igual
 * que calcularAmpliacion, así minutosAntes + minutosDespues es la misma ampliación. Solo informa: no decide nada.
 */
function detalleAmpliacion(s, ventanas) {
  const bloques = [];
  for (const w of ventanas.filter((v) => v.dia === s.dia).sort((a, b) => a.startMs - b.startMs)) {
    const ultimo = bloques.at(-1);
    if (ultimo && w.startMs <= ultimo.endMs) ultimo.endMs = Math.max(ultimo.endMs, w.endMs);
    else bloques.push({ startMs: w.startMs, endMs: w.endMs });
  }
  if (!bloques.length) return { diaNuevo: true, minutosAntes: 0, minutosDespues: 0 };
  let antes = Math.max(0, bloques[0].startMs - s.startMs);
  let despues = Math.max(0, s.endMs - bloques.at(-1).endMs);
  for (let i = 1; i < bloques.length; i++) {
    const inicio = bloques[i - 1].endMs, fin = bloques[i].startMs;
    const desde = Math.max(inicio, s.startMs), hasta = Math.min(fin, s.endMs);
    if (desde >= hasta) continue;
    if (fin - hasta >= desde - inicio) despues += hasta - inicio;
    else antes += fin - desde;
  }
  return { diaNuevo: false, minutosAntes: antes / 60_000, minutosDespues: despues / 60_000 };
}

/** "HH:MM" de la hora local de un instante, tomando como referencia un inicio de la grilla del club. */
function horaLocal(ms, referencia) {
  const [h, m] = referencia.slotId.split('-')[1].split(':').map(Number);
  const minutos = ((h * 60 + m + Math.round((ms - referencia.startMs) / 60_000)) % 1440 + 1440) % 1440;
  return `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
}

/**
 * Horario cargado de cada pareja del partido, por jornada lógica (la madrugada va con el día anterior).
 * Sin franjas cargadas, la pareja puede en todo el horario del club y queda marcada con cargado: false.
 */
function horariosDeParejas(entrada, pares, tarea) {
  const referencia = entrada.grilla[0];
  return tarea.participantes.map((i) => {
    const cargado = pares[i].ventanas.length > 0;
    const ventanas = referencia ? (cargado ? pares[i].ventanas : entrada.ventanasClub) : [];
    return { parejaId: pares[i].id, cargado, ventanas: [...ventanas].sort((a, b) => a.startMs - b.startMs)
      .map((w) => ({ dia: w.dia, desde: horaLocal(w.startMs, referencia), hasta: horaLocal(w.endMs, referencia) })) };
  });
}

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
        fijadoManual: Boolean(p.fijadoManual),
        estado: tieneHorario(p) ? 'FIJO' : 'PENDIENTE' };
  });
}

/** Todos los inicios del club, incluidos los bloqueados y su motivo.
 * La viabilidad es estructural: todas las disponibilidades se pueden ampliar,
 * pero se conservan la ocupación ajena, los fijos propios y las dependencias mini.
 * Cada candidato tiene el mismo presupuesto determinista, también al fijar. */
function prepararCandidatosPartidoZona(entrada, posicionEnRonda) {
  const { pares, mini, tareas, courtTimelines, parejaAssignments, cantidadCanchas } = prepararProblemaZona(entrada);
  const indice = tareas.findIndex((t) => t.posicionEnRonda === posicionEnRonda);
  if (indice < 0) throw Object.assign(new Error('El partido no pertenece a esta zona.'), {
    statusCode: 404, codigo: 'PARTIDO_PRECHECK_NO_ENCONTRADO',
  });
  const clavePartido = hash([entrada.claveZona || pares.map((p) => p.orden), posicionEnRonda]);
  const tarea = tareas[indice];
  if (tieneHorario(tarea.partido)) {
    return { pares, tareas, indice, clavePartido, candidatos: [] };
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
    const esperaBases = tarea.derivado && tareas.slice(0, 2).some((t) => !tieneHorario(t.partido));
    const ocupadas = tarea.participantes.filter((i) =>
      (parejaAssignments.get(pares[i].id) || []).some((o) => solapan(s, o)) ||
      [...fijos].some(([j, o]) => solapan(s, o) && tareas[j].participantes.includes(i) &&
        !(mini && tarea.derivado && tareas[j].derivado)));
    const dependencia = mini && [...fijos].some(([j, o]) => tarea.derivado !== tareas[j].derivado &&
      (tarea.derivado ? s.startMs < o.endMs : o.startMs < s.endMs));
    // Compartido con fijar: primera cancha libre compatible, recalculada en la transacción.
    let canchaNumero;
    for (let cancha = 1; cancha <= cantidadCanchas; cancha++) {
      if (!(courtTimelines.get(cancha) || []).some((o) => solapan(s, o)) &&
          compatibleConAsignaciones(tarea, { ...s, canchaNumero: cancha }, tareas, fijos, mini)) {
        canchaNumero = cancha; break;
      }
    }
    const motivo = esperaBases ? 'ESPERA_BASES' : ocupadas.length ? 'PAREJA_OCUPADA'
      : dependencia ? 'ZONA_SIN_SALIDA' : !canchaNumero ? 'SIN_CANCHA' : null;
    const faltan = tarea.participantes.filter((i) => pares[i].ventanas.length && !pares[i].ventanas.some((w) =>
      w.dia === s.dia && s.startMs >= w.startMs && s.endMs <= w.endMs));
    const costos = faltan.map((i) => calcularAmpliacion([s], pares[i].ventanas));
    candidatos.push({ slot: s, canchaNumero, opcion: {
      clave: hash([clavePartido, s.slotId]), slotId: s.slotId, fechaHora: new Date(s.startMs).toISOString(),
      parejasAAmpliar: faltan.map((i) => pares[i].id),
      estado: motivo ? 'NO_DISPONIBLE' : faltan.length === 0 ? 'ENTRA' : faltan.length === 1 ? 'PEDIR_1' : 'PEDIR_VARIAS',
      motivo, parejasOcupadas: ocupadas.map((i) => pares[i].id),
      diasNuevos: costos.reduce((n, c) => n + c.diasNuevos, 0),
      minutosAmpliacion: costos.reduce((n, c) => n + c.minutosAmpliacion, 0),
      ampliacionPorPareja: faltan.map((i) => ({ parejaId: pares[i].id, ...detalleAmpliacion(s, pares[i].ventanas) })),
    } });
  }
  return { pares, tareas, indice, clavePartido, candidatos };
}

function verificarCandidato(entrada, { pares, tareas, indice }, candidato, maxNodos) {
  return verificarProgramacionZona({ ...entrada, maxNodos,
    parejas: pares.map((p) => ({ ...p, ventanas: [] })),
    partidos: tareas.map((t, i) => i === indice ? { ...t.partido,
      fechaHora: candidato.opcion.fechaHora, canchaNumero: candidato.canchaNumero, sinHorarioAsignado: false,
    } : t.partido),
  });
}

// No usa datos derivados del caché: vuelve a calcular disponibilidad, cancha y viabilidad.
function recalcularOpcionPartidoZona(entrada, posicionEnRonda, slotId) {
  const problema = prepararCandidatosPartidoZona(entrada, posicionEnRonda);
  const candidato = problema.candidatos.find((c) => c.opcion.slotId === slotId);
  if (!candidato || candidato.opcion.estado === 'NO_DISPONIBLE') return null;
  const resultado = verificarCandidato(entrada, problema, candidato, entrada.maxNodosOpcion ?? MAX_NODOS_OPCION);
  if (resultado.estado === 'NO_FACTIBLE') return null;
  return { ...candidato.opcion, canchaNumero: candidato.canchaNumero, verificada: resultado.estado === 'FACTIBLE' };
}

function obtenerOpcionesPartidoZona(entrada, posicionEnRonda) {
  const problema = prepararCandidatosPartidoZona(entrada, posicionEnRonda);
  const opciones = problema.candidatos.map((candidato) => {
    if (candidato.opcion.estado === 'NO_DISPONIBLE') return { ...candidato.opcion, verificada: false };
    const resultado = verificarCandidato(entrada, problema, candidato, entrada.maxNodosOpcion ?? MAX_NODOS_OPCION);
    return { ...candidato.opcion,
      ...(resultado.estado === 'NO_FACTIBLE' ? { estado: 'NO_DISPONIBLE', motivo: 'ZONA_SIN_SALIDA' } : {}),
      // Interno: una búsqueda incompleta conserva el estado por disponibilidad.
      verificada: resultado.estado === 'FACTIBLE' };
  });
  return { opciones, horariosParejas: horariosDeParejas(entrada, problema.pares, problema.tareas[problema.indice]) };
}

module.exports = { obtenerOpcionesPartidoZona, recalcularOpcionPartidoZona, listarPartidosZona,
  MAX_NODOS_OPCION };
