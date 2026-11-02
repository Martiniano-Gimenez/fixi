'use strict';

const crypto = require('crypto');
const { prepararProblemaZona, compatibleConAsignaciones, verificarProgramacionZona } = require('./programacionZona');
const { minutosCronologicosJornada } = require('../services/slots.service');
const MAX_NODOS_PROPUESTAS = 20_000;
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

function compararCosto(a, b) {
  if (a.parejas !== b.parejas) return a.parejas - b.parejas;
  if (a.minutos !== b.minutos) return a.minutos - b.minutos;
  for (let i = 0; i < a.horas.length; i++) if (a.horas[i] !== b.horas[i]) return a.horas[i] - b.horas[i];
  return 0;
}

// En una dimensión, emparejar los inicios ordenados de cada jornada da el matching
// uno a uno con menor diferencia máxima. La trasnoche sigue perteneciendo a su jornada.
function sonPropuestasEquivalentes(a, b) {
  if (a.cambios.length !== b.cambios.length) return false;
  return a.cambios.every((c) => {
    const otra = b.cambios.find((p) => p.parejaId === c.parejaId);
    if (!otra || c.slotsToAdd.length !== otra.slotsToAdd.length) return false;
    const ordenar = (slots) => slots.map((s) => {
      const [dia, hora] = s.split('-'); return { dia, min: minutosCronologicosJornada(hora) };
    }).sort((x, y) => compararTexto(x.dia, y.dia) || x.min - y.min);
    const uno = ordenar(c.slotsToAdd), dos = ordenar(otra.slotsToAdd);
    return uno.every((s, i) => s.dia === dos[i].dia && Math.abs(s.min - dos[i].min) < 75);
  });
}

function compararSoluciones(a, b) {
  const costo = compararCosto(a.costo, b.costo);
  if (costo) return costo;
  for (let i = 0; i < Math.min(a.inicios.length, b.inicios.length); i++) {
    if (a.inicios[i] !== b.inicios[i]) return a.inicios[i] - b.inicios[i];
  }
  return a.inicios.length - b.inicios.length || compararTexto(a.natural, b.natural);
}

// El umbral no es transitivo. Se eligen representantes por costo, sin unir cadenas
// de vecinos: cada propuesta descartada debe ser equivalente a un representante mejor.
function seleccionarGrupos(soluciones) {
  const top = [];
  for (const s of [...soluciones].sort(compararSoluciones)) {
    if (!top.some((t) => sonPropuestasEquivalentes(t.propuesta, s.propuesta))) top.push(s);
    if (top.length === 3) break;
  }
  return top;
}

/** Busca grupos distintos, hasta dos parejas. Las variantes cubiertas por un grupo
 * no consumen nodos; sí se conservan para reelegir representantes sin encadenar vecinos.
 * El resto de las opciones examinadas (incluso podadas) consume el presupuesto de MRV. */
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
  const asignaciones = new Map(), soluciones = new Map(), patrones = new Map();
  let top = [], cota = null;
  let nodos = 0, incompleta = false;
  function costo(cambios) {
    const indices = cambios.flatMap((s, i) => s.length ? [i] : []);
    return { parejas: indices.length, minutos: indices.reduce((n, i) => n + minutosFuera(cambios[i], originales[i]), 0),
      horas: indices.map((i) => horas[i]).sort((a, b) => a - b) };
  }
  function extender(cambios, op) {
    const siguientes = cambios.map((s) => [...s]);
    for (const i of op.faltan) if (!siguientes[i].some((s) => s.slotId === op.slotId)) siguientes[i].push(op);
    return siguientes;
  }
  function registrar(cambios) {
      const c = costo(cambios);
      if (!c.parejas || cota && compararCosto(c, cota) > 0) return;
      const delta = cambios.flatMap((s, i) => s.length ? [{ i, slots: [...s].sort((a, b) => a.startMs - b.startMs) }] : []);
      const natural = JSON.stringify(delta.map(({ i, slots }) => [String(pares[i].orden).padStart(8, '0'), slots.map((s) => s.startMs)]));
      const programacion = tareas.map((t, i) => ({ posicionEnRonda: t.posicionEnRonda,
        fechaHora: new Date(asignaciones.get(i).startMs).toISOString(), canchaNumero: asignaciones.get(i).canchaNumero }));
      const anterior = soluciones.get(natural);
      if (anterior && compararTexto(JSON.stringify(programacion), JSON.stringify(anterior.propuesta.partidosPropuestos)) >= 0) return;
      const clave = crypto.createHash('sha256').update(JSON.stringify([entrada.claveZona || '', natural])).digest('hex').slice(0, 32);
      const nueva = { natural, costo: c, inicios: delta.flatMap(({ slots }) => slots.map((s) => s.startMs)).sort((a, b) => a - b), propuesta: { clave,
        cambios: delta.map(({ i, slots }) => ({ parejaId: pares[i].id, slotsToAdd: slots.map((s) => s.slotId) })),
        minutosAgregados: c.minutos, partidosPropuestos: programacion } };
      // Guardar variantes evita perder alternativas al desplazarse un representante.
      // Se acota también el archivo: nunca más de 20.000 cambios completos distintos.
      if (!anterior && soluciones.size >= MAX_NODOS_PROPUESTAS) { incompleta = true; return; }
      soluciones.set(natural, nueva);
      const cubierta = top.some((s) => compararSoluciones(s, nueva) <= 0 && sonPropuestasEquivalentes(s.propuesta, nueva.propuesta));
      if (!cubierta || anterior && top.includes(anterior)) top = seleccionarGrupos(soluciones.values());
      // Tres patrones (parejas + cantidades por jornada) nunca pueden ser equivalentes.
      // Esta cota sigue siendo válida aunque se desplacen representantes cercanos.
      const patron = JSON.stringify(delta.map(({ i, slots }) => [pares[i].orden, ['Viernes', 'Sabado'].map((d) => slots.filter((s) => s.dia === d).length)]));
      if (!patrones.has(patron) || compararCosto(c, patrones.get(patron)) < 0) {
        patrones.set(patron, c);
        cota = patrones.size >= 3 ? [...patrones.values()].sort(compararCosto)[2] : null;
      }
  }
  function buscar(cambios) {
    if (asignaciones.size === tareas.length) { registrar(cambios); return; }
    let elegida;
    for (let i = 0; i < tareas.length; i++) {
      if (asignaciones.has(i)) continue;
      const opciones = [];
      for (const op of dominios[i]) {
        // En la última decisión ya conocemos todos los cambios: archivar las variantes
        // equivalentes sin gastar presupuesto en otra rama/otra cancha del mismo grupo.
        if (asignaciones.size === tareas.length - 1 && compatibleConAsignaciones(tareas[i], op, tareas, asignaciones, mini)) {
          const siguientes = extender(cambios, op), c = costo(siguientes);
          if (c.parejas <= 2 && (!cota || compararCosto(c, cota) <= 0)) {
            const propuesta = { cambios: siguientes.flatMap((s, j) => s.length ? [{ parejaId: pares[j].id, slotsToAdd: s.map((w) => w.slotId) }] : []) };
            const cubierta = top.some((s) => sonPropuestasEquivalentes(s.propuesta, propuesta));
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
  const propuestas = seleccionarGrupos(soluciones.values()).map(({ propuesta }) => propuesta).filter((p) => {
    const parejas = pares.map((par, i) => ({ ...par, ventanas: unirVentanas([...originales[i],
      ...grilla.filter((s) => p.cambios.find((c) => c.parejaId === par.id)?.slotsToAdd.includes(s.slotId))]) }));
    return verificarProgramacionZona({ ...entrada, parejas, partidos: tareas.map((t, i) => ({ ...t.partido,
      ...p.partidosPropuestos[i], sinHorarioAsignado: false })) }).estado === 'FACTIBLE';
  });
  return { propuestas, busquedaIncompleta: incompleta, nodos };
}

module.exports = { generarPropuestasZona, minutosFuera, compararCosto, MAX_NODOS_PROPUESTAS, sonPropuestasEquivalentes, seleccionarGrupos };
