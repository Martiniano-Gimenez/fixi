'use strict';

const crypto = require('crypto');
const { prepararProblemaZona, compatibleConAsignaciones, verificarProgramacionZona } = require('./programacionZona');
const MAX_NODOS_PROPUESTAS = 5_000;
const DURACION_MS = 75 * 60_000;
const solapan = (a, b) => a.startMs < b.endMs && b.startMs < a.endMs;
const compararTexto = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function unirVentanas(ventanas) {
  const res = [];
  for (const w of [...ventanas].sort((a, b) => a.startMs - b.startMs)) {
    const ultima = res.at(-1);
    if (ultima && ultima.dia === w.dia && w.startMs <= ultima.endMs) ultima.endMs = Math.max(ultima.endMs, w.endMs);
    else res.push({ ...w });
  }
  return res;
}

function minutosFuera(nuevas, originales) {
  return unirVentanas(nuevas).reduce((s, w) => s + w.endMs - w.startMs - originales.reduce((n, o) =>
    n + Math.max(0, Math.min(w.endMs, o.endMs) - Math.max(w.startMs, o.startMs)), 0), 0) / 60_000;
}

function calcularAmpliacion(nuevas, originales) {
  let diasNuevos = 0, minutosAmpliacion = 0;
  for (const dia of new Set(nuevas.map((w) => w.dia))) {
    const bloques = unirVentanas(originales.filter((w) => w.dia === dia));
    const requeridas = unirVentanas(nuevas.filter((w) => w.dia === dia));
    if (!bloques.length) { diasNuevos++; continue; }
    let ampliacionMs = Math.max(0, bloques[0].startMs - requeridas[0].startMs) +
      Math.max(0, requeridas.at(-1).endMs - bloques.at(-1).endMs);
    // Entre dos bloques se puede ampliar desde ambos lados. El mínimo deja sin
    // cubrir el mayor hueco que no contiene ningún partido requerido.
    for (let i = 1; i < bloques.length; i++) {
      const inicio = bloques[i - 1].endMs, fin = bloques[i].startMs;
      let cursor = inicio, huecoMayor = 0;
      for (const w of requeridas) {
        const desde = Math.max(inicio, w.startMs), hasta = Math.min(fin, w.endMs);
        if (desde >= hasta) continue;
        huecoMayor = Math.max(huecoMayor, desde - cursor);
        cursor = hasta;
      }
      huecoMayor = Math.max(huecoMayor, fin - cursor);
      ampliacionMs += fin - inicio - huecoMayor;
    }
    minutosAmpliacion += ampliacionMs / 60_000;
  }
  return { diasNuevos, minutosAmpliacion };
}

function compararCosto(a, b) {
  if (a.parejas !== b.parejas) return a.parejas - b.parejas;
  if (a.diasNuevos !== b.diasNuevos) return a.diasNuevos - b.diasNuevos;
  if (a.minutosAmpliacion !== b.minutosAmpliacion) return a.minutosAmpliacion - b.minutosAmpliacion;
  for (let i = 0; i < a.horas.length; i++) if (a.horas[i] !== b.horas[i]) return a.horas[i] - b.horas[i];
  return 0;
}

// Los slotId ya expresan la jornada lógica, incluida la trasnoche del sábado.
function diasAgregados(slots) {
  return [...new Set(slots.map((s) => s.split('-')[0]))].sort(compararTexto);
}

function sonPropuestasEquivalentes(a, b) {
  if (a.cambios.length !== b.cambios.length) return false;
  return a.cambios.every((c) => {
    const otra = b.cambios.find((p) => p.parejaId === c.parejaId);
    return !!otra && JSON.stringify(diasAgregados(c.slotsToAdd)) === JSON.stringify(diasAgregados(otra.slotsToAdd));
  });
}

function compararSoluciones(a, b) {
  return compararCosto(a.costo, b.costo) || compararTexto(a.natural, b.natural);
}

// Primero una opción por conjunto de parejas; después variantes por parejas/días.
function seleccionarGrupos(soluciones) {
  const grupos = new Map();
  for (const s of soluciones) {
    const anterior = grupos.get(s.grupo);
    if (!anterior || compararSoluciones(s, anterior) < 0) grupos.set(s.grupo, s);
  }
  const ordenadas = [...grupos.values()].sort(compararSoluciones);
  const top = [], conjuntos = new Set(), elegidos = new Set();
  for (const s of ordenadas) {
    if (conjuntos.has(s.conjunto)) continue;
    conjuntos.add(s.conjunto); elegidos.add(s.grupo); top.push(s);
    if (top.length === 3) return top;
  }
  for (const s of ordenadas) {
    if (elegidos.has(s.grupo)) continue;
    top.push(s);
    if (top.length === 3) break;
  }
  return top;
}

/** Busca cada combinación de una o dos parejas con su propio presupuesto de MRV.
 * Las variantes completas cubiertas por un grupo no consumen más nodos.
 * Se juntan los mejores testigos por parejas/días antes de elegir el top global. */
function generarPropuestasZona(entrada) {
  const { pares, mini, tareas, courtTimelines, parejaAssignments, cantidadCanchas } = prepararProblemaZona(entrada);
  const maxNodos = entrada.maxNodos ?? MAX_NODOS_PROPUESTAS;
  const grilla = [...entrada.grilla].sort((a, b) => a.startMs - b.startMs);
  const originales = pares.map((p) => unirVentanas(p.ventanas));
  const horas = originales.map((ws) => ws.reduce((s, w) => s + w.endMs - w.startMs, 0) / 3_600_000);
  const dominios = tareas.map((t) => {
    const fijo = t.partido.fechaHora && !t.partido.sinHorarioAsignado;
    const inicio = fijo ? +new Date(t.partido.fechaHora) : null;
    let slots = grilla;
    if (fijo) {
      slots = grilla.filter((s) => s.startMs === inicio);
      // Un horario manual fuera de grilla puede mantenerse si no pide agregar disponibilidad.
      if (!slots.length) slots = entrada.ventanasClub.filter((w) => inicio >= w.startMs && inicio + DURACION_MS <= w.endMs)
        .map((w) => ({ dia: w.dia, startMs: inicio, endMs: inicio + DURACION_MS, slotId: null }));
    }
    const opciones = [];
    for (const s of slots) {
      if (!['Viernes', 'Sabado'].includes(s.dia)) continue;
      if (!entrada.ventanasClub.some((w) => w.dia === s.dia && s.startMs >= w.startMs && s.endMs <= w.endMs)) continue;
      if (t.participantes.some((i) => (parejaAssignments.get(pares[i].id) || []).some((o) => solapan(s, o)))) continue;
      const faltan = t.participantes.filter((i) => originales[i].length && !originales[i].some((w) =>
        w.dia === s.dia && s.startMs >= w.startMs && s.endMs <= w.endMs));
      if (faltan.length > 2 || (faltan.length && !s.slotId)) continue;
      for (let cancha = 1; cancha <= cantidadCanchas; cancha++) {
        if (fijo && cancha !== t.partido.canchaNumero) continue;
        if ((courtTimelines.get(cancha) || []).some((o) => solapan(s, o))) continue;
        opciones.push({ ...s, canchaNumero: cancha, faltan });
      }
    }
    return opciones;
  });
  function costo(cambios) {
    const indices = cambios.flatMap((s, i) => s.length ? [i] : []);
    const ampliaciones = indices.map((i) => calcularAmpliacion(cambios[i], originales[i]));
    return { parejas: indices.length, diasNuevos: ampliaciones.reduce((n, c) => n + c.diasNuevos, 0),
      minutosAmpliacion: ampliaciones.reduce((n, c) => n + c.minutosAmpliacion, 0),
      horas: indices.map((i) => horas[i]).sort((a, b) => a - b) };
  }
  function extender(cambios, op) {
    const siguientes = cambios.map((s) => [...s]);
    for (const i of op.faltan) if (!siguientes[i].some((s) => s.slotId === op.slotId)) siguientes[i].push(op);
    return siguientes;
  }
  function claveGrupo(cambios) {
    return JSON.stringify(cambios.flatMap((slots, i) => slots.length
      ? [[pares[i].orden, diasAgregados(slots.map((s) => s.slotId))]] : []));
  }
  function buscarCombinacion(indices) {
    const permitidas = new Set(indices);
    const conjuntoPermitido = JSON.stringify(indices.map((i) => pares[i].orden));
    const dominiosCombinacion = dominios.map((opciones) => opciones.filter((op) => op.faltan.every((i) => permitidas.has(i))));
    // Un dominio vacío prueba esta combinación imposible sin gastar el presupuesto.
    if (dominiosCombinacion.some((d) => !d.length)) return { soluciones: [], nodos: 0, busquedaIncompleta: false };
    const asignaciones = new Map(), soluciones = new Map(), cotas = new Map();
    let top = [];
    let nodos = 0, incompleta = false;
    function registrar(cambios) {
      const c = costo(cambios);
      if (!c.parejas) return;
      const delta = cambios.flatMap((s, i) => s.length ? [{ i, slots: [...s].sort((a, b) => a.startMs - b.startMs) }] : []);
      const conjunto = JSON.stringify(delta.map(({ i }) => pares[i].orden)), cota = cotas.get(conjunto);
      if (cota && compararCosto(c, cota) > 0) return;
      const natural = JSON.stringify(delta.map(({ i, slots }) => [String(pares[i].orden).padStart(8, '0'), slots.map((s) => s.startMs)]));
      const programacion = tareas.map((t, i) => ({ posicionEnRonda: t.posicionEnRonda,
        fechaHora: new Date(asignaciones.get(i).startMs).toISOString(), canchaNumero: asignaciones.get(i).canchaNumero }));
      const grupo = claveGrupo(cambios), anterior = soluciones.get(grupo);
      const clave = crypto.createHash('sha256').update(JSON.stringify([entrada.claveZona || '', natural])).digest('hex').slice(0, 32);
      const nueva = { grupo, conjunto, natural, costo: c, propuesta: { clave,
        cambios: delta.map(({ i, slots }) => ({ parejaId: pares[i].id, slotsToAdd: slots.map((s) => s.slotId) })),
        minutosAgregados: delta.reduce((n, { i, slots }) => n + minutosFuera(slots, originales[i]), 0),
        minutosAmpliacion: c.minutosAmpliacion, diasNuevos: c.diasNuevos, partidosPropuestos: programacion } };
      if (anterior) {
        const comparacion = compararSoluciones(nueva, anterior);
        if (comparacion > 0 || comparacion === 0 && compararTexto(JSON.stringify(programacion), JSON.stringify(anterior.propuesta.partidosPropuestos)) >= 0) return;
      }
      soluciones.set(grupo, nueva);
      top = seleccionarGrupos(soluciones.values());
      const mejoresDelConjunto = [...soluciones.values()].filter((s) => s.conjunto === conjunto).sort(compararSoluciones);
      if (mejoresDelConjunto.length >= 3) cotas.set(conjunto, mejoresDelConjunto[2].costo);
    }
    function buscar(cambios) {
      if (asignaciones.size === tareas.length) { registrar(cambios); return; }
      let elegida;
      for (let i = 0; i < tareas.length; i++) {
        if (asignaciones.has(i)) continue;
        const opciones = [];
        for (const op of dominiosCombinacion[i]) {
          // En la última decisión ya conocemos todos los cambios: evaluar las variantes
          // equivalentes sin gastar presupuesto en otra rama/otra cancha del mismo grupo.
          if (asignaciones.size === tareas.length - 1 && compatibleConAsignaciones(tareas[i], op, tareas, asignaciones, mini)) {
            const siguientes = extender(cambios, op), c = costo(siguientes);
            const cota = c.parejas === indices.length ? cotas.get(conjuntoPermitido) : null;
            if (c.parejas <= 2 && (!cota || compararCosto(c, cota) <= 0)) {
              const grupo = claveGrupo(siguientes);
              const cubierta = top.some((s) => s.grupo === grupo);
              if (cubierta) {
                asignaciones.set(i, op); registrar(siguientes); asignaciones.delete(i);
                if (incompleta) return;
                continue;
              }
            }
          }
          if (nodos >= maxNodos) { incompleta = true; return; }
          nodos++;
          if (!compatibleConAsignaciones(tareas[i], op, tareas, asignaciones, mini)) continue;
          const siguientes = extender(cambios, op), c = costo(siguientes);
          if (c.parejas > 2) continue;
          // La ampliación mínima es monótona: cubrir más partidos restringe las
          // extensiones posibles. Parejas y días nuevos tampoco pueden disminuir.
          // Solo podar con el conjunto definitivo: otro conjunto tiene su propio cupo.
          const cota = c.parejas === indices.length ? cotas.get(conjuntoPermitido) : null;
          if (cota && compararCosto(c, cota) > 0) continue;
          opciones.push({ op, siguientes, costo: c });
        }
        if (!opciones.length) return;
        if (!elegida || opciones.length < elegida.opciones.length) elegida = { i, opciones };
      }
      elegida.opciones.sort((a, b) => compararCosto(a.costo, b.costo) || a.op.startMs - b.op.startMs || a.op.canchaNumero - b.op.canchaNumero);
      for (const { op, siguientes } of elegida.opciones) {
        asignaciones.set(elegida.i, op); buscar(siguientes); asignaciones.delete(elegida.i);
        if (incompleta) return;
      }
    }
    buscar(pares.map(() => []));
    return { soluciones: [...soluciones.values()], nodos, busquedaIncompleta: incompleta };
  }
  const combinaciones = pares.map((_, i) => [i]);
  for (let i = 0; i < pares.length; i++) for (let j = i + 1; j < pares.length; j++) combinaciones.push([i, j]);
  const resultados = combinaciones.map((indices) => buscarCombinacion(indices));
  const propuestas = seleccionarGrupos(resultados.flatMap((r) => r.soluciones)).map(({ propuesta }) => propuesta).filter((p) => {
    const parejas = pares.map((par, i) => ({ ...par, ventanas: unirVentanas([...originales[i],
      ...grilla.filter((s) => p.cambios.find((c) => c.parejaId === par.id)?.slotsToAdd.includes(s.slotId))]) }));
    return verificarProgramacionZona({ ...entrada, parejas, partidos: tareas.map((t, i) => ({ ...t.partido,
      ...p.partidosPropuestos[i], sinHorarioAsignado: false })) }).estado === 'FACTIBLE';
  }).map((propuesta) => ({ ...propuesta, partidosPropuestos: propuesta.partidosPropuestos.map((p) => {
    const t = tareas.find((t) => t.posicionEnRonda === p.posicionEnRonda);
    return { ...p, pareja1Id: t.derivado ? null : t.partido.pareja1Id ?? null,
      pareja2Id: t.derivado ? null : t.partido.pareja2Id ?? null,
      ...(t.derivado ? { origen: t.partido.origen || (t.partido.origenPareja1 && t.partido.origenPareja2
        ? `${t.partido.origenPareja1} vs ${t.partido.origenPareja2}`
        : t.posicionEnRonda === 3 ? 'Ganador P1 vs Ganador P2' : 'Perdedor P1 vs Perdedor P2') } : {}) };
  }) }));
  return { propuestas, busquedaIncompleta: resultados.some((r) => r.busquedaIncompleta),
    nodos: resultados.reduce((n, r) => n + r.nodos, 0),
    combinaciones: resultados.map((r, i) => ({ ordenes: combinaciones[i].map((j) => pares[j].orden), nodos: r.nodos, busquedaIncompleta: r.busquedaIncompleta })) };
}

module.exports = { generarPropuestasZona, minutosFuera, calcularAmpliacion, compararCosto, MAX_NODOS_PROPUESTAS, sonPropuestasEquivalentes, seleccionarGrupos };
