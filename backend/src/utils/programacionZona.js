'use strict';

const { DURACION_PARTIDO_MIN } = require('../services/slots.service');

const DURACION_MS = DURACION_PARTIDO_MIN * 60_000;
const PASO_MS = 15 * 60_000;
const MAX_NODOS_ZONA = 20_000;
const solapan = (a, b) => a.startMs < b.endMs && b.startMs < a.endMs;

/**
 * Verificador puro: ventanas absolutas (fusionarSlotsEnVentanas), club por jornada y ocupación
 * AJENA a la zona. Ventanas vacías = pareja libre; los partidos propios con horario quedan fijos.
 * No consulta Prisma, no modifica entradas ni usa reloj/azar/UUID para ordenar.
 * Devuelve FACTIBLE con testigo, NO_FACTIBLE o BUSQUEDA_INCOMPLETA (nunca un falso imposible).
 */
function prepararProblemaZona({
  formato, parejas, partidos, ventanasClub, cantidadCanchas,
  courtTimelines = new Map(), parejaAssignments = new Map(), maxNodos = MAX_NODOS_ZONA,
}) {
  const pares = [...parejas].sort((a, b) => a.orden - b.orden);
  const mini = formato === 'MINI_BRACKET';
  const n = pares.length;
  const ordenes = new Set(pares.map((p) => p.orden));
  const indices = new Map(pares.map((p, i) => [p.id, i]));
  const lista = [...partidos].sort((a, b) => a.posicionEnRonda - b.posicionEnRonda);
  if (n < 2 || n > 4 || (mini ? n !== 4 : formato !== 'ROUND_ROBIN') ||
      ordenes.size !== n || indices.size !== n || pares.some((p) => !Number.isInteger(p.orden)) ||
      lista.length !== (mini ? 4 : n * (n - 1) / 2) ||
      lista.some((p, i) => p.posicionEnRonda !== i + 1) ||
      !Number.isInteger(cantidadCanchas) || cantidadCanchas < 1 ||
      !Number.isInteger(maxNodos) || maxNodos < 0) {
    throw new Error('Entrada inválida para verificar la programación de la zona.');
  }

  const cruces = new Set();
  const tareas = lista.map((p) => {
    const derivado = mini && p.posicionEnRonda >= 3;
    const participantes = derivado ? pares.map((_, i) => i) : [indices.get(p.pareja1Id), indices.get(p.pareja2Id)];
    if (!derivado) {
      if (participantes.some((i) => i === undefined) || participantes[0] === participantes[1]) {
        throw new Error('Cruce inválido en la zona.');
      }
      cruces.add([...participantes].sort((a, b) => a - b).join(':'));
    }
    return { posicionEnRonda: p.posicionEnRonda, participantes, derivado, partido: p };
  });
  if ((!mini && cruces.size !== lista.length) ||
      (mini && new Set(tareas.slice(0, 2).flatMap((t) => t.participantes)).size !== 4)) {
    throw new Error('Los cruces no cubren el formato de la zona.');
  }
  return { pares, mini, tareas, ventanasClub, cantidadCanchas, courtTimelines, parejaAssignments, maxNodos };
}

function compatibleConAsignaciones(t, candidato, tareas, asignaciones, mini) {
  for (const [i, ocupado] of asignaciones) {
    const otra = tareas[i];
    if (mini && t.derivado !== otra.derivado) {
      const base = t.derivado ? ocupado : candidato;
      const definicion = t.derivado ? candidato : ocupado;
      if (definicion.startMs < base.endMs) return false;
    }
    if (!solapan(candidato, ocupado)) continue;
    if (candidato.canchaNumero === ocupado.canchaNumero) return false;
    // P3 y P4 tienen participantes disjuntos en TODOS los resultados posibles.
    if (mini && t.derivado && otra.derivado) continue;
    if (t.participantes.some((p) => otra.participantes.includes(p))) return false;
  }
  return true;
}

function verificarProgramacionZona(entrada) {
  const { pares, mini, tareas, ventanasClub, cantidadCanchas, courtTimelines, parejaAssignments, maxNodos } = prepararProblemaZona(entrada);

  // El domingo lógico se excluye; Sabado incluye su trasnoche del domingo civil.
  const club = ventanasClub.filter((w) => w.dia === 'Viernes' || w.dia === 'Sabado')
    .slice().sort((a, b) => a.startMs - b.startMs);
  const dominios = tareas.map((t) => {
    let comunes = club;
    for (const i of t.participantes) {
      const ventanas = pares[i].ventanas;
      if (!ventanas.length) continue;
      comunes = comunes.flatMap((a) => ventanas.filter((b) => a.dia === b.dia).map((b) => ({
        dia: a.dia, startMs: Math.max(a.startMs, b.startMs), endMs: Math.min(a.endMs, b.endMs),
      })).filter((w) => w.endMs - w.startMs >= DURACION_MS));
    }
    const fijado = t.partido.fechaHora && !t.partido.sinHorarioAsignado;
    const inicioFijo = fijado ? new Date(t.partido.fechaHora).getTime() : null;
    const opciones = new Map();
    for (const w of comunes) {
      for (let startMs = fijado ? inicioFijo : w.startMs; startMs + DURACION_MS <= w.endMs; startMs += PASO_MS) {
        const intervalo = { startMs, endMs: startMs + DURACION_MS };
        if (startMs < w.startMs || t.participantes.some((i) =>
          (parejaAssignments.get(pares[i].id) || []).some((o) => solapan(intervalo, o)))) {
          if (fijado) break;
          continue;
        }
        for (let cancha = 1; cancha <= cantidadCanchas; cancha++) {
          if (fijado && cancha !== t.partido.canchaNumero) continue;
          if ((courtTimelines.get(cancha) || []).some((o) => solapan(intervalo, o))) continue;
          opciones.set(`${startMs}:${cancha}`, { ...intervalo, canchaNumero: cancha });
        }
        if (fijado) break;
      }
    }
    return [...opciones.values()].sort((a, b) => a.startMs - b.startMs || a.canchaNumero - b.canchaNumero);
  });

  const asignaciones = new Map();
  let nodos = 0;
  let incompleta = false;
  function compatible(t, candidato) {
    return compatibleConAsignaciones(t, candidato, tareas, asignaciones, mini);
  }
  function buscar() {
    if (asignaciones.size === tareas.length) return true;
    // MRV dinámico; los empates conservan posicionEnRonda, nunca el id del partido.
    let elegida = null;
    for (let i = 0; i < tareas.length; i++) {
      if (asignaciones.has(i)) continue;
      const opciones = dominios[i].filter((c) => compatible(tareas[i], c));
      if (!opciones.length) return false;
      if (!elegida || opciones.length < elegida.opciones.length) elegida = { i, opciones };
    }
    for (const candidato of elegida.opciones) {
      if (nodos >= maxNodos) { incompleta = true; return false; }
      nodos++;
      asignaciones.set(elegida.i, candidato);
      if (buscar()) return true;
      asignaciones.delete(elegida.i);
      if (incompleta) return false;
    }
    return false;
  }
  const factible = buscar();
  return {
    estado: factible ? 'FACTIBLE' : incompleta ? 'BUSQUEDA_INCOMPLETA' : 'NO_FACTIBLE',
    nodos,
    programacion: factible ? tareas.map((t, i) => ({
      posicionEnRonda: t.posicionEnRonda,
      fechaHora: new Date(asignaciones.get(i).startMs).toISOString(),
      canchaNumero: asignaciones.get(i).canchaNumero,
    })) : [],
  };
}

module.exports = { verificarProgramacionZona, MAX_NODOS_ZONA, prepararProblemaZona, compatibleConAsignaciones };
