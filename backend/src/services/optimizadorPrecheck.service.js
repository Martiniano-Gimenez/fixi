'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { generarGrillaOrganizador } = require('./slots.service');
const { fusionarSlotsEnVentanas, slotIdToMsWindow, calcularConfigZonas } = require('./zona.service');
const { pk, qk, TICKS_PARTIDO } = require('../utils/optimizadorPrecheck');

const TICK_MS = 15 * 60_000;
const RUTA_WORKER = path.join(__dirname, '../utils/optimizadorWorker.js');

// Ajustables desde los tests; los valores por defecto son los de producción.
const config = {
  presupuestoMs: 9500, // tope de la búsqueda del optimizador (~10 s con el armado y el cierre)
  limiteDuroMs: 12_000, // si el worker no responde, se lo mata y queda el plan de siempre
  maxIteraciones: 100000,
  estancamiento: 400,
  maxColumnas: 900,
  tiempoPorVueltaMs: 3000, // seguro por vuelta: normalmente cada vuelta termina sola, así la trayectoria no depende del reloj
  semilla: 1,
};

// Un solo cálculo por torneo a la vez: otro pedido del mismo torneo espera el que está corriendo
// (si es idéntico, comparte su resultado; si no, corre después). Nunca hay dos workers para un torneo.
const enCurso = new Map();
const estadisticas = { lanzados: 0, activos: 0, maxActivos: 0 };

/** ¿El plan base ya está perfecto? Entonces no hay nada que optimizar. */
function metricaPlan(categoriasPlan) {
  let manual = 0; let sinHorario = 0;
  for (const c of categoriasPlan) for (const z of c.zonas) {
    if (z.requiereArmadoManual) manual += z.parejaIds.length;
    for (const p of z.partidos) if (!p.fechaHora || p.sinHorarioAsignado) sinHorario++;
  }
  return { manual, sinHorario };
}
/** Mejora estricta: primero menos parejas en zona manual, después menos partidos sin horario. Empate: no. */
function mejora(nueva, actual) {
  return nueva.manual < actual.manual || (nueva.manual === actual.manual && nueva.sinHorario < actual.sinHorario);
}

/**
 * Datos planos para el optimizador, con la misma disponibilidad efectiva que el resto del pre-check
 * (0 franjas = horario del club; 75 min dentro de la ventana de la pareja y del club).
 * @param validos [{ categoria: { id, nombre, parejas: [{ id, orden, slotsSeleccionados }] } }]
 * @param planBase categoriasPlan ya evaluado (zonas + horarios que arma hoy el pre-check)
 */
function construirEntrada({ validos, organizador, refFecha, externos, planBase, planFijo = [] }) {
  const grilla = generarGrillaOrganizador(organizador);
  const ids = [...grilla.viernes, ...grilla.sabado];
  const inicios = ids.map((id) => slotIdToMsWindow(id, refFecha));
  const club = fusionarSlotsEnVentanas(ids, refFecha);
  const gridTick = inicios.map((w) => Math.round(w.startMs / TICK_MS));
  const gridMs = inicios.map((w) => w.startMs);
  const idxPorMs = new Map(gridMs.map((ms, i) => [ms, i]));

  const uso = new Map(); const externosPorCancha = [];
  for (const e of externos) {
    if (!e.fechaHora || !e.canchaNumero) continue;
    const t0 = Math.round(+new Date(e.fechaHora) / TICK_MS);
    for (let k = 0; k < TICKS_PARTIDO; k++) uso.set(t0 + k, (uso.get(t0 + k) || 0) + 1);
    externosPorCancha.push({ cancha: e.canchaNumero, tick: t0 });
  }
  // Categorías que no se optimizan (sin disponibilidad: sorteo): sus partidos ya agendados ocupan canchas como externos.
  for (const c of planFijo) for (const z of c.zonas) for (const p of z.partidos) {
    if (!p.fechaHora || !p.canchaNumero || p.sinHorarioAsignado) continue;
    const t0 = Math.round(+new Date(p.fechaHora) / TICK_MS);
    for (let k = 0; k < TICKS_PARTIDO; k++) uso.set(t0 + k, (uso.get(t0 + k) || 0) + 1);
    externosPorCancha.push({ cancha: p.canchaNumero, tick: t0 });
  }

  const dominio = new Map();
  const categorias = validos.map(({ categoria }) => {
    const parejas = [...categoria.parejas].sort((a, b) => a.orden - b.orden || (a.id < b.id ? -1 : 1)).map((p) => {
      const ventanas = p.slotsSeleccionados.length ? fusionarSlotsEnVentanas(p.slotsSeleccionados.map((s) => s.slotId), refFecha) : club;
      const d = [];
      inicios.forEach((w, i) => { if (ventanas.some((v) => v.dia === w.dia && w.startMs >= v.startMs && w.endMs <= v.endMs)) d.push(i); });
      dominio.set(p.id, new Set(d));
      return { id: p.id, orden: p.orden, dominio: d };
    });
    return { key: categoria.id, parejas, config: calcularConfigZonas(parejas.length) };
  });

  // Plan base -> zonas (en orden de juego) y horarios que el modelo puede representar.
  const zonas = []; const sched = [];
  for (const c of planBase) for (const z of c.zonas) {
    if (z.requiereArmadoManual) continue;
    const porPos = new Map(z.partidos.map((p) => [p.posicionEnRonda, p]));
    let miembros = z.parejaIds;
    if (z.formato === 'MINI_BRACKET') {
      const p1 = porPos.get(1); const p2 = porPos.get(2);
      if (!p1 || !p2) continue;
      miembros = [p1.pareja1Id, p1.pareja2Id, p2.pareja1Id, p2.pareja2Id];
    }
    zonas.push({ catKey: c.categoriaId, ids: miembros });
    for (const p of z.partidos) {
      if (!p.fechaHora || p.sinHorarioAsignado) continue;
      const i = idxPorMs.get(+new Date(p.fechaHora));
      if (i === undefined) continue;
      const derivado = z.formato === 'MINI_BRACKET' && p.posicionEnRonda >= 3;
      const involucradas = derivado ? miembros : [p.pareja1Id, p.pareja2Id];
      if (!involucradas.every((id) => dominio.get(id)?.has(i))) continue; // fuera del modelo: se trata como sin horario
      sched.push([derivado ? qk(miembros, p.posicionEnRonda) : pk(p.pareja1Id, p.pareja2Id), i]);
    }
  }
  return {
    canchas: Math.max(1, organizador.cantidadCanchas || 1), gridTick, gridMs, uso: [...uso], externosPorCancha,
    categorias, base: { zonas, sched },
    semilla: config.semilla, presupuestoMs: config.presupuestoMs, maxIteraciones: config.maxIteraciones, estancamiento: config.estancamiento,
    maxColumnas: config.maxColumnas, tiempoPorVueltaMs: config.tiempoPorVueltaMs,
  };
}

function correrWorker(entrada) {
  estadisticas.lanzados++;
  estadisticas.activos++;
  estadisticas.maxActivos = Math.max(estadisticas.maxActivos, estadisticas.activos);
  return new Promise((resolve) => {
    const worker = new Worker(RUTA_WORKER, { workerData: entrada });
    let listo = false;
    const fin = (valor) => { if (listo) return; listo = true; estadisticas.activos--; clearTimeout(reloj); worker.terminate().catch(() => {}); resolve(valor); };
    const reloj = setTimeout(() => { console.warn('[optimizador] sin respuesta en el tiempo límite: queda el plan de siempre.'); fin(null); }, config.limiteDuroMs);
    worker.once('message', (m) => {
      if (!m.ok) console.warn('[optimizador] falló:', m.error);
      fin(m.ok ? m.resultado : null);
    });
    worker.once('error', (e) => { console.warn('[optimizador] error del worker:', e && e.message); fin(null); });
    worker.once('exit', () => fin(null));
  });
}

/**
 * Corre (o espera) la optimización del torneo. Devuelve el resultado del optimizador o null si no se pudo.
 */
async function ejecutar(torneoId, entrada) {
  const hash = crypto.createHash('sha256').update(JSON.stringify(entrada)).digest('hex');
  for (;;) {
    const previo = enCurso.get(torneoId);
    if (!previo) break;
    if (previo.hash === hash) return previo.promesa;
    await previo.promesa.catch(() => {});
  }
  const promesa = correrWorker(entrada);
  enCurso.set(torneoId, { hash, promesa });
  const limpiar = () => { if (enCurso.get(torneoId)?.promesa === promesa) enCurso.delete(torneoId); };
  promesa.then(limpiar, limpiar);
  return promesa;
}

/**
 * Resultado del optimizador -> armado por categoría que entiende iniciarCategoriaConDisponibilidad
 * ({ grupos, sinGrupo }) más los horarios por partido (clave -> { startMs, cancha }).
 */
function aArmado(resultado, entrada) {
  const porCategoria = new Map();
  for (const c of entrada.categorias) porCategoria.set(c.key, { grupos: [], sinGrupo: [], horarios: new Map() });
  for (const z of resultado.zonas) porCategoria.get(z.catKey).grupos.push(z.ids);
  const catDe = new Map(entrada.categorias.flatMap((c) => c.parejas.map((p) => [p.id, c.key])));
  for (const id of resultado.sinGrupo) porCategoria.get(catDe.get(id)).sinGrupo.push(id);
  const horarios = new Map();
  for (const [key, i, cancha] of resultado.horarios) if (cancha) horarios.set(key, { startMs: entrada.gridMs[i], cancha });
  for (const a of porCategoria.values()) a.horarios = horarios;
  return porCategoria;
}

/**
 * Armado impuesto que reproduce exactamente las zonas y horarios de un plan ya armado (categorías que no se optimizan).
 * Los miembros salen en orden de juego desde los partidos: P1 = [0] vs [1], P2 = [0] vs [2] (zona de 3) o [2] vs [3] (de 4).
 */
function armadoDesdePlan(categoriasPlan) {
  const porCategoria = new Map();
  for (const c of categoriasPlan) {
    const a = { grupos: [], sinGrupo: [], horarios: new Map() };
    for (const z of c.zonas) {
      if (z.requiereArmadoManual) { a.sinGrupo.push(...z.parejaIds); continue; }
      const porPos = new Map(z.partidos.map((p) => [p.posicionEnRonda, p]));
      const p1 = porPos.get(1); const p2 = porPos.get(2);
      let miembros = z.parejaIds;
      if (z.parejaIds.length === 2 && p1) miembros = [p1.pareja1Id, p1.pareja2Id];
      else if (z.parejaIds.length === 3 && p1 && p2) miembros = [p1.pareja1Id, p1.pareja2Id, p2.pareja2Id];
      else if (z.formato === 'MINI_BRACKET' && p1 && p2) miembros = [p1.pareja1Id, p1.pareja2Id, p2.pareja1Id, p2.pareja2Id];
      a.grupos.push(miembros);
      for (const p of z.partidos) {
        if (!p.fechaHora || !p.canchaNumero || p.sinHorarioAsignado) continue;
        const clave = z.formato === 'MINI_BRACKET' && p.posicionEnRonda >= 3 ? qk(miembros, p.posicionEnRonda) : pk(p.pareja1Id, p.pareja2Id);
        a.horarios.set(clave, { startMs: +new Date(p.fechaHora), cancha: p.canchaNumero });
      }
    }
    porCategoria.set(c.categoriaId, a);
  }
  return porCategoria;
}

module.exports = { construirEntrada, armadoDesdePlan, ejecutar, aArmado, metricaPlan, mejora, config, estadisticas };
