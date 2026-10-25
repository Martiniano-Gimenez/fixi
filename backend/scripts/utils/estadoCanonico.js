'use strict';

/**
 * estadoCanonico.js
 *
 * Representación canónica del estado de un torneo, sin UUID, para comparar corridas:
 * los UUID v4 cambian en cada corrida, así que cada entidad se identifica por una clave natural.
 *   - categoría: nombre
 *   - pareja:    "<categoría>#<orden>"          (pareja.orden es único dentro de la categoría)
 *   - zona:      "<categoría>/<nombre de zona>"
 *   - fase:      "<categoría>/R<ronda>"
 *   - partido:   "<zona o fase>/P<posicionEnRonda>"
 * Las listas se ordenan por esas claves, así que el resultado tampoco depende del orden de inserción.
 *
 * - canonizarEstadoTorneo(prisma, torneoId) / hashEstadoTorneo: estado persistido del torneo.
 * - canonizarPlanPrecheck(prisma, categoriasPlan) / hashPlanPrecheck: plan del pre-check (dry-run, no
 *   queda en la base). Acá el orden de las listas se respeta, porque es parte del resultado: define en
 *   qué orden iniciarTorneoMultiCategoria crea las filas.
 * - hashCanonico(valor): SHA256 de un JSON con claves de objeto ordenadas.
 */

const crypto = require('crypto');

function stableStringify(valor) {
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor);
  if (valor instanceof Date) return JSON.stringify(valor.toISOString());
  if (Array.isArray(valor)) return `[${valor.map(stableStringify).join(',')}]`;
  const claves = Object.keys(valor).sort();
  return `{${claves.map((k) => `${JSON.stringify(k)}:${stableStringify(valor[k])}`).join(',')}}`;
}

function hashCanonico(valor) {
  return crypto.createHash('sha256').update(stableStringify(valor)).digest('hex');
}

const iso = (d) => (d ? new Date(d).toISOString() : null);
const porClave = (a, b) => (a.clave < b.clave ? -1 : a.clave > b.clave ? 1 : 0);

function parsearMapa(json) {
  if (!json) return {};
  if (typeof json === 'string') {
    try {
      return JSON.parse(json);
    } catch (_) {
      return { __invalido: json };
    }
  }
  return json;
}

/** Arma los mapas id -> clave natural de un conjunto de categorías ya cargadas. */
function construirClaves(categorias) {
  const pareja = new Map();
  const zona = new Map();
  const fase = new Map();
  const partido = new Map();
  for (const c of categorias) {
    const usadas = new Set();
    for (const p of c.parejas) {
      let clave = `${c.nombre}#${p.orden}`;
      // Datos viejos con orden repetido: se agregan los nombres para no mezclar parejas
      if (usadas.has(clave)) clave = `${clave}:${p.jugador1}/${p.jugador2}`;
      usadas.add(clave);
      pareja.set(p.id, clave);
    }
    for (const z of c.zonas) zona.set(z.id, `${c.nombre}/${z.nombre}`);
    for (const f of c.fasesEliminatorias) fase.set(f.id, `${c.nombre}/R${f.ronda}`);
    for (const p of c.partidos) {
      const contenedor = p.zonaId ? zona.get(p.zonaId) : p.faseEliminatoriaId ? fase.get(p.faseEliminatoriaId) : `${c.nombre}/?`;
      partido.set(p.id, `${contenedor}/P${p.posicionEnRonda}`);
    }
  }
  return { pareja, zona, fase, partido };
}

async function canonizarEstadoTorneo(prisma, torneoId) {
  const torneo = await prisma.torneo.findUnique({ where: { id: torneoId } });
  const categorias = await prisma.categoria.findMany({
    where: { torneoId },
    include: {
      parejas: { include: { slotsSeleccionados: true } },
      zonas: { include: { zonaParejas: true } },
      fasesEliminatorias: true,
      partidos: { include: { sets: true } },
    },
  });
  const overrides = await prisma.overrideCanchasDia.findMany({ where: { torneoId } });
  const claves = construirClaves(categorias);
  const cp = (id) => (id ? claves.pareja.get(id) || '?' : null);

  return {
    torneo: {
      estado: torneo.estado,
      fecha: iso(torneo.fecha),
      canchasDisponiblesOverride: torneo.canchasDisponiblesOverride ?? null,
      overrideActivoDesde: iso(torneo.overrideActivoDesde),
    },
    categorias: categorias
      .map((c) => ({
        clave: c.nombre,
        estado: c.estado,
        parejas: c.parejas
          .map((p) => ({
            clave: cp(p.id),
            jugador1: p.jugador1,
            jugador2: p.jugador2,
            resolucionManual: p.resolucionManual,
            slots: p.slotsSeleccionados.map((s) => s.slotId).sort(),
          }))
          .sort(porClave),
        zonas: c.zonas
          .map((z) => ({
            clave: claves.zona.get(z.id),
            formato: z.formato,
            clasifican: z.clasifican,
            requiereArmadoManual: z.requiereArmadoManual,
            parejas: z.zonaParejas
              .map((zp) => ({
                clave: cp(zp.parejaId),
                posicion: zp.posicion,
                pj: zp.pj,
                pg: zp.pg,
                pp: zp.pp,
                sf: zp.sf,
                sc: zp.sc,
                gf: zp.gf,
                gc: zp.gc,
                puntos: zp.puntos,
              }))
              .sort(porClave),
          }))
          .sort(porClave),
        fases: c.fasesEliminatorias.map((f) => ({ clave: claves.fase.get(f.id), nombre: f.nombre })).sort(porClave),
        partidos: c.partidos
          .map((p) => ({
            clave: claves.partido.get(p.id),
            estado: p.estado,
            pareja1: cp(p.pareja1Id),
            pareja2: cp(p.pareja2Id),
            ganador: cp(p.ganadorId),
            origen1: p.origenPareja1,
            origen2: p.origenPareja2,
            fechaHora: iso(p.fechaHora),
            cancha: p.canchaNumero,
            sinHorarioAsignado: p.sinHorarioAsignado,
            esBye: p.esBye,
            horarioManual: p.horarioManual,
            sets: [...p.sets].sort((a, b) => a.numero - b.numero).map((s) => [s.numero, s.gamesPareja1, s.gamesPareja2]),
          }))
          .sort(porClave),
      }))
      .sort(porClave),
    overrides: overrides
      .map((o) => {
        const mapa = parsearMapa(o.partidosSinSlot);
        const sinSlot = Object.keys(mapa)
          .map((id) => [claves.partido.get(id) || `?`, mapa[id]])
          .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
        return { clave: o.diaKey, canchas: o.canchas, isLluvia: o.isLluvia, activoDesde: iso(o.activoDesde), partidosSinSlot: sinSlot };
      })
      .sort(porClave),
  };
}

async function hashEstadoTorneo(prisma, torneoId) {
  return hashCanonico(await canonizarEstadoTorneo(prisma, torneoId));
}

/** Plan del pre-check sin UUID. Las parejas se resuelven contra la base (existen aunque el plan sea dry-run). */
async function canonizarPlanPrecheck(prisma, categoriasPlan) {
  const ids = new Set();
  for (const c of categoriasPlan) {
    for (const z of c.zonas) {
      z.parejaIds.forEach((id) => ids.add(id));
      for (const p of z.partidos) {
        if (p.pareja1Id) ids.add(p.pareja1Id);
        if (p.pareja2Id) ids.add(p.pareja2Id);
      }
    }
  }
  const parejas = await prisma.pareja.findMany({ where: { id: { in: [...ids] } }, include: { categoria: { select: { nombre: true } } } });
  const clave = new Map(parejas.map((p) => [p.id, `${p.categoria.nombre}#${p.orden}`]));
  const cp = (id) => (id ? clave.get(id) || '?' : null);

  return categoriasPlan.map((c) => ({
    categoria: c.nombre,
    zonas: c.zonas.map((z) => ({
      nombre: z.nombre,
      formato: z.formato,
      clasifican: z.clasifican,
      requiereArmadoManual: z.requiereArmadoManual,
      parejas: z.parejaIds.map(cp),
      partidos: z.partidos.map((p) => ({
        posicion: p.posicionEnRonda,
        pareja1: cp(p.pareja1Id),
        pareja2: cp(p.pareja2Id),
        origen1: p.origenPareja1,
        origen2: p.origenPareja2,
        fechaHora: iso(p.fechaHora),
        cancha: p.canchaNumero,
        sinHorarioAsignado: p.sinHorarioAsignado,
      })),
    })),
  }));
}

async function hashPlanPrecheck(prisma, categoriasPlan) {
  return hashCanonico(await canonizarPlanPrecheck(prisma, categoriasPlan));
}

module.exports = {
  stableStringify,
  hashCanonico,
  canonizarEstadoTorneo,
  hashEstadoTorneo,
  canonizarPlanPrecheck,
  hashPlanPrecheck,
};
