'use strict';

const { generarGrillaOrganizador } = require('../services/slots.service');
const { fusionarSlotsEnVentanas, slotIdToMsWindow } = require('../services/zona.service');
const DURACION = 75 * 60_000;
const solapan = (a, b) => a.startMs < b.endMs && b.startMs < a.endMs;
const asignado = (p) => p.fechaHora && p.canchaNumero && !p.sinHorarioAsignado;

/** Pasada compatible: cada solución se adopta antes de buscar la siguiente.
 * Solo mueve donantes de otra zona, en su misma jornada y sin ampliar disponibilidad.
 * Presupuesto por objetivo determinista; nunca adopta un intento parcial. */
function reacomodarPrecheck({ categoriasPlan, parejasMap, organizador, refFecha, externos = [], maxMovimientos = 1, maxNodos = 200_000 }) {
  const cantidadCanchas = Math.max(1, organizador.cantidadCanchas || 1);
  const grilla = generarGrillaOrganizador(organizador);
  const inicios = [...grilla.viernes, ...grilla.sabado].map((id) => slotIdToMsWindow(id, refFecha))
    .sort((a, b) => a.startMs - b.startMs);
  const club = fusionarSlotsEnVentanas([...grilla.viernes, ...grilla.sabado], refFecha);
  const ventanas = new Map([...parejasMap].map(([id, p]) => [id,
    p.slotsSeleccionados.length ? fusionarSlotsEnVentanas(p.slotsSeleccionados.map((s) => s.slotId), refFecha) : club]));
  const tareas = [];
  const intervalo = (p) => {
    if (!asignado(p)) return null;
    const startMs = +new Date(p.fechaHora), endMs = startMs + DURACION;
    return { startMs, endMs, canchaNumero: p.canchaNumero,
      dia: club.find((w) => startMs >= w.startMs && endMs <= w.endMs)?.dia };
  };
  const comparar = (a, b) => a.categoria.localeCompare(b.categoria, 'es', { numeric: true }) ||
    a.zona.nombre.localeCompare(b.zona.nombre, 'es', { numeric: true }) || a.p.posicionEnRonda - b.p.posicionEnRonda ||
    a.ordenParejas.localeCompare(b.ordenParejas, 'es', { numeric: true });
  for (const c of categoriasPlan) for (const zona of c.zonas) for (const p of zona.partidos) {
    const mini = zona.formato === 'MINI_BRACKET', derivado = mini && p.posicionEnRonda >= 3;
    const ids = derivado ? zona.parejaIds : [p.pareja1Id, p.pareja2Id].filter(Boolean);
    const base = intervalo(p);
    const dia = base && club.find((w) => base.startMs >= w.startMs && base.endMs <= w.endMs)?.dia;
    tareas.push({ p, zona, mini, derivado, ids, base, categoria: c.nombre,
      ordenParejas: ids.map((id) => { const par = parejasMap.get(id); return `${par?.orden}:${par?.jugador1}/${par?.jugador2}`; }).sort().join('|'),
      fijo: Boolean(p.fijadoManual || p.horarioManual), externo: false,
      dominio: inicios.filter((w) => (!base || w.dia === dia) && ids.length >= 2 && ids.every((id) =>
        ventanas.get(id)?.some((v) => v.dia === w.dia && w.startMs >= v.startMs && w.endMs <= v.endMs))) });
  }
  tareas.sort(comparar);
  for (const p of externos) if (asignado(p)) tareas.push({ p, base: intervalo(p), fijo: true, externo: true,
    zona: null, ids: [p.pareja1Id, p.pareja2Id].filter(Boolean), dominio: [] });
  const objetivos = tareas.filter((t) => !t.externo && !t.base && !t.fijo && !t.p.pendienteManual && !t.zona.requiereArmadoManual);
  const estado = (t, cambios) => cambios.get(t) || t.base;
  function bloqueos(t, a, cambios) {
    const bloquean = new Set();
    for (const otra of tareas) {
      if (otra === t) continue;
      const b = estado(otra, cambios);
      if (t.mini && t.zona === otra.zona && t.derivado !== otra.derivado) {
        if (t.derivado && !b) return null;
        if (b && (t.derivado ? a.startMs < b.endMs : b.startMs < a.endMs)) bloquean.add(otra);
      }
      if (!b || !solapan(a, b)) continue;
      const disjuntos = t.mini && t.zona === otra.zona && t.derivado && otra.derivado;
      if (a.canchaNumero === b.canchaNumero || (!disjuntos && t.ids.some((id) => otra.ids.includes(id)))) bloquean.add(otra);
    }
    return bloquean;
  }
  let nodos = 0, resueltos = 0, movimientos = 0, agotados = 0;
  function resolver(objetivo) {
    let usados = 0;
    function reparar(cambios) {
      nodos++;
      if (++usados > maxNodos) return null;
      const necesarios = new Set();
      for (const [t, a] of cambios) {
        const bloquean = bloqueos(t, a, cambios);
        if (!bloquean) return null;
        for (const otra of bloquean) {
          if (cambios.has(otra) || otra.fijo || otra.p.pendienteManual || otra.externo || otra.zona === objetivo.zona) return null;
          necesarios.add(otra);
        }
      }
      if (!necesarios.size) return cambios;
      if (cambios.size - 1 + necesarios.size > maxMovimientos) return null;
      // Orden natural, independiente del UUID y del orden de inserción de mapas.
      const donante = [...necesarios].sort(comparar)[0];
      for (const w of donante.dominio) {
        if (w.startMs === donante.base.startMs || w.dia !== donante.base.dia) continue;
        for (let canchaNumero = 1; canchaNumero <= cantidadCanchas; canchaNumero++) {
          const siguiente = new Map(cambios); siguiente.set(donante, { ...w, canchaNumero });
          const resultado = reparar(siguiente);
          if (resultado) return resultado;
          if (usados > maxNodos) return null;
        }
      }
      return null;
    }
    for (const w of objetivo.dominio) for (let canchaNumero = 1; canchaNumero <= cantidadCanchas; canchaNumero++) {
      const resultado = reparar(new Map([[objetivo, { ...w, canchaNumero }]]));
      if (resultado) return resultado;
      if (usados > maxNodos) { agotados++; return null; }
    }
    return null;
  }
  let progreso;
  do {
    progreso = false;
    for (const t of objetivos) {
      if (t.base) continue;
      const solucion = resolver(t);
      if (!solucion) continue;
      for (const [tarea, horario] of solucion) {
        tarea.base = horario;
        Object.assign(tarea.p, { fechaHora: new Date(horario.startMs), canchaNumero: horario.canchaNumero, sinHorarioAsignado: false });
      }
      movimientos += solucion.size - 1; resueltos++; progreso = true;
    }
  } while (progreso);
  return { resueltos, movimientos, nodos, agotados };
}

module.exports = { reacomodarPrecheck };
