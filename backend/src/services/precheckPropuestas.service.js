'use strict';

const crypto = require('crypto');
const { generarPropuestasZona } = require('../utils/propuestasZona');
const { verificarProgramacionZona } = require('../utils/programacionZona');
const { generarGrillaOrganizador } = require('./slots.service');
const { fusionarSlotsEnVentanas, slotIdToMsWindow } = require('./zona.service');
const { requireTorneoFecha } = require('../utils/dateUtils');
const DURACION_MS = 75 * 60_000;

function crearServicioPropuestas({ prisma, preCheckSessions, planesCache, preCheckBase }) {
  const colas = new Map();
  function encolar(id, fn) {
    const siguiente = (colas.get(id) || Promise.resolve()).catch(() => {}).then(fn);
    colas.set(id, siguiente);
    const limpiar = () => { if (colas.get(id) === siguiente) colas.delete(id); };
    siguiente.then(limpiar, limpiar);
    return siguiente;
  }
  function error(statusCode, message, codigo) { return Object.assign(new Error(message), { statusCode, codigo }); }
  async function leerEstado(db, organizadorId, torneoId) {
    const torneo = await db.torneo.findUnique({ where: { id: torneoId }, include: {
      categorias: { orderBy: { nombre: 'asc' }, include: { parejas: { orderBy: { orden: 'asc' },
        include: { slotsSeleccionados: { orderBy: { slotId: 'asc' } } } } } },
    } });
    if (!torneo) throw error(404, 'Torneo no encontrado.');
    if (torneo.organizadorId !== organizadorId) throw error(403, 'No tenés permisos sobre este torneo.');
    const club = await db.organizador.findUnique({ where: { id: organizadorId }, select: {
      cantidadCanchas: true, viernesInicio: true, viernesFin: true, sabadoInicio: true, sabadoFin: true,
    } });
    const externos = await db.partido.findMany({ where: {
      categoria: { torneo: { organizadorId } }, esBye: false,
      fechaHora: { not: null }, canchaNumero: { not: null }, sinHorarioAsignado: false,
    }, orderBy: [{ fechaHora: 'asc' }, { canchaNumero: 'asc' }, { categoria: { nombre: 'asc' } }, { posicionEnRonda: 'asc' }],
    select: { id: true, zonaId: true, pareja1Id: true, pareja2Id: true, fechaHora: true, canchaNumero: true } });
    return { torneo, club, externos };
  }
  function firma(estado, sesion) {
    return crypto.createHash('sha256').update(JSON.stringify([estado.club,
      estado.torneo.estado, estado.torneo.fecha, estado.torneo.inscripcionAbierta,
      estado.torneo.categorias.map((c) => [c.id, c.nombre, c.estado, c.parejas.map((p) => [p.id, p.orden, p.jugador1, p.jugador2, p.resolucionManual,
        p.slotsSeleccionados.map((s) => s.slotId)])]), estado.externos,
      sesion.categoriasPlan.map((c) => [c.categoriaId, c.zonas.map((z) => [z.id, z.nombre, z.formato, z.requiereArmadoManual,
        z.parejaIds, z.partidos.map((p) => [p.posicionEnRonda, p.pareja1Id, p.pareja2Id, p.fechaHora, p.canchaNumero, p.sinHorarioAsignado])])]),
    ])).digest('hex');
  }
  function contexto(estado, sesion, zona) {
    const refFecha = requireTorneoFecha(estado.torneo), grillaClub = generarGrillaOrganizador(estado.club);
    const grilla = [...grillaClub.viernes, ...grillaClub.sabado].map((slotId) => ({ slotId, ...slotIdToMsWindow(slotId, refFecha) }));
    const courtTimelines = new Map(), parejaAssignments = new Map();
    function ocupar(p) {
      if (!p.fechaHora || !p.canchaNumero || p.sinHorarioAsignado) return;
      const intervalo = { startMs: +new Date(p.fechaHora), endMs: +new Date(p.fechaHora) + DURACION_MS };
      if (!courtTimelines.has(p.canchaNumero)) courtTimelines.set(p.canchaNumero, []);
      courtTimelines.get(p.canchaNumero).push(intervalo);
      for (const id of [p.pareja1Id, p.pareja2Id].filter(Boolean)) {
        if (!parejaAssignments.has(id)) parejaAssignments.set(id, []);
        parejaAssignments.get(id).push(intervalo);
      }
    }
    for (const c of sesion.categoriasPlan) for (const z of c.zonas) if (z !== zona) z.partidos.forEach(ocupar);
    estado.externos.filter((p) => p.zonaId !== zona.id).forEach(ocupar);
    const todas = new Map(estado.torneo.categorias.flatMap((c) => c.parejas.map((p) => [p.id, p])));
    return { formato: zona.formato, partidos: zona.partidos, cantidadCanchas: Math.max(1, estado.club.cantidadCanchas),
      courtTimelines, parejaAssignments, grilla,
      ventanasClub: fusionarSlotsEnVentanas(grilla.map((s) => s.slotId), refFecha),
      parejas: zona.parejaIds.map((id) => ({ id, orden: todas.get(id).orden,
        ventanas: fusionarSlotsEnVentanas(todas.get(id).slotsSeleccionados.map((s) => s.slotId), refFecha) })),
    };
  }
  async function anexar(organizadorId, torneoId, respuesta, reintento = false) {
    const sesion = preCheckSessions.get(torneoId);
    const estado = await leerEstado(prisma, organizadorId, torneoId);
    const nomina = estado.torneo.categorias.filter((c) => c.estado === 'BORRADOR').flatMap((c) => c.parejas.map((p) => p.id)).sort().join(',');
    if (!sesion || sesion.parejaIdsHash !== nomina) {
      if (!reintento) return anexar(organizadorId, torneoId,
        await preCheckBase(organizadorId, torneoId, { isReCheck: true }), true);
      throw error(409, 'La nómina cambió durante la verificación. Volvé a verificar.', 'ESTADO_PRECHECK_CAMBIO');
    }
    const actual = firma(estado, sesion);
    if (sesion.propuestasFirma !== actual) {
      const propuestasCache = new Map(), propuestasPorZona = new Map(), ambiguas = new Set();
      for (const c of sesion.categoriasPlan) for (const z of c.zonas) {
        if (!z.requiereArmadoManual && !z.partidos.some((p) => p.sinHorarioAsignado)) continue;
        const resultado = z.parejaIds.length >= 2 && z.parejaIds.length <= 4
          ? generarPropuestasZona({ ...contexto(estado, sesion, z), claveZona: JSON.stringify([c.nombre, z.nombre,
            z.parejaIds.map((id) => {
              const p = estado.torneo.categorias.flatMap((c) => c.parejas).find((p) => p.id === id);
              return [p.orden, p.jugador1, p.jugador2];
            }).sort((a, b) => a[0] - b[0])]) })
          : { propuestas: [], busquedaIncompleta: false, nodos: 0 };
        propuestasPorZona.set(`${c.categoriaId}:${z.id}`, resultado);
        for (const propuesta of resultado.propuestas) {
          if (propuestasCache.has(propuesta.clave)) ambiguas.add(propuesta.clave);
          propuestasCache.set(propuesta.clave, { propuesta, zona: z, categoriaId: c.categoriaId });
        }
      }
      // Categorías duplicadas con las mismas claves naturales no pueden compartir una acción.
      for (const clave of ambiguas) propuestasCache.delete(clave);
      for (const r of propuestasPorZona.values()) if (r.propuestas.some((p) => ambiguas.has(p.clave))) {
        r.propuestas = r.propuestas.filter((p) => !ambiguas.has(p.clave)); r.busquedaIncompleta = true;
      }
      sesion.revision = crypto.randomUUID();
      sesion.propuestasFirma = actual;
      sesion.propuestasCache = propuestasCache;
      sesion.propuestasPorZona = propuestasPorZona;
    }
    respuesta.revision = sesion.revision;
    for (const c of respuesta.conflictos || []) for (const p of c.partidosSinHorario) {
      const r = sesion.propuestasPorZona.get(`${c.categoriaId}:${p.zonaId}`);
      p.propuestasZona = structuredClone(r?.propuestas || []);
      p.busquedaPropuestasIncompleta = r?.busquedaIncompleta || false;
    }
    return respuesta;
  }
  async function obtener(org, id, opciones) { return anexar(org, id, await preCheckBase(org, id, opciones)); }
  async function rechazar(org, id, mensaje, codigo) {
    let preCheck;
    try { preCheck = await obtener(org, id, { isReCheck: true }); }
    catch (e) {
      if (![400, 409].includes(e.statusCode)) throw e;
      preCheck = e.preCheck || { bloqueado: true, revision: null, conflictos: [], motivo: e.message };
    }
    throw Object.assign(error(409, mensaje, codigo), { preCheck });
  }
  async function aplicar(org, id, { clave, revision } = {}) {
    if (typeof clave !== 'string' || typeof revision !== 'string' || !clave || !revision) {
      throw error(400, 'Indicá la clave y la revisión del pre-check.', 'PROPUESTA_INVALIDA');
    }
    const estado = await leerEstado(prisma, org, id);
    const sesion = preCheckSessions.get(id);
    if (!sesion || sesion.expiresAt <= Date.now() || sesion.revision !== revision) {
      return rechazar(org, id, 'El pre-check cambió o venció. Revisá las propuestas actualizadas.', 'REVISION_PRECHECK_VIEJA');
    }
    const guardada = sesion.propuestasCache?.get(clave);
    if (!guardada) return rechazar(org, id, 'La propuesta ya no está disponible. Revisá el pre-check actualizado.', 'PROPUESTA_VENCIDA');
    try {
      await prisma.$transaction(async (tx) => {
        // Primera escritura para serializar con altas, inicio y otras ediciones en SQLite.
        await tx.torneo.update({ where: { id }, data: { inscripcionAbierta: estado.torneo.inscripcionAbierta } });
        const actual = await leerEstado(tx, org, id), { propuesta, zona, categoriaId } = guardada;
        const categoriaActual = actual.torneo.categorias.find((c) => c.id === categoriaId);
        if (preCheckSessions.get(id) !== sesion || sesion.revision !== revision ||
            categoriaActual?.estado !== 'BORRADOR' || !zona.parejaIds.every((id) => categoriaActual.parejas.some((p) => p.id === id))) {
          throw error(409, 'El pre-check cambió. Revisá las propuestas actualizadas.', 'REVISION_PRECHECK_VIEJA');
        }
        const ctx = contexto(actual, sesion, zona), refFecha = requireTorneoFecha(actual.torneo);
        const pares = new Map(actual.torneo.categorias.flatMap((c) => c.parejas.map((p) => [p.id, p])));
        const validos = new Set(ctx.grilla.map((s) => s.slotId));
        const parejas = ctx.parejas.map((p) => ({ ...p, ventanas: fusionarSlotsEnVentanas([
          ...pares.get(p.id).slotsSeleccionados.map((s) => s.slotId),
          ...(propuesta.cambios.find((c) => c.parejaId === p.id)?.slotsToAdd || []),
        ], refFecha) }));
        const partidos = zona.partidos.map((p) => ({ ...p,
          ...propuesta.partidosPropuestos.find((q) => q.posicionEnRonda === p.posicionEnRonda), sinHorarioAsignado: false }));
        const mueveFijo = zona.partidos.some((p, i) => !p.sinHorarioAsignado && p.fechaHora &&
          (+new Date(p.fechaHora) !== +new Date(partidos[i].fechaHora) || p.canchaNumero !== partidos[i].canchaNumero));
        if (mueveFijo || propuesta.cambios.some((c) => c.slotsToAdd.some((s) => !validos.has(s))) ||
            verificarProgramacionZona({ ...ctx, parejas, partidos }).estado !== 'FACTIBLE') {
          throw error(409, 'La propuesta ya no permite programar la zona. Revisá las opciones actualizadas.', 'PROPUESTA_NO_FACTIBLE');
        }
        if (firma(actual, sesion) !== sesion.propuestasFirma) {
          throw error(409, 'Los horarios o el plan cambiaron. Revisá las propuestas actualizadas.', 'ESTADO_PRECHECK_CAMBIO');
        }
        for (const c of propuesta.cambios) {
          const anteriores = new Set(pares.get(c.parejaId).slotsSeleccionados.map((s) => s.slotId));
          const nuevos = c.slotsToAdd.filter((s) => !anteriores.has(s));
          if (nuevos.length) await tx.slotPareja.createMany({ data: nuevos.map((slotId) => ({ parejaId: c.parejaId, slotId })) });
        }
        await tx.pareja.updateMany({ where: { id: { in: propuesta.cambios.map((c) => c.parejaId) } }, data: { resolucionManual: true } });
      }, { timeout: 10_000 });
    } catch (e) {
      if (e.statusCode === 409) return rechazar(org, id, e.message, e.codigo);
      throw e;
    }
    // Adoptar únicamente después del commit: la memoria no se adelanta a la base.
    for (const p of guardada.zona.partidos) {
      const q = guardada.propuesta.partidosPropuestos.find((q) => q.posicionEnRonda === p.posicionEnRonda);
      p.fechaHora = new Date(q.fechaHora); p.canchaNumero = q.canchaNumero; p.sinHorarioAsignado = false;
    }
    guardada.zona.requiereArmadoManual = false;
    for (const [key, plan] of planesCache) if (plan.torneoId === id) planesCache.delete(key);
    return obtener(org, id, { isReCheck: true });
  }
  return {
    preCheck: (org, id, opciones) => encolar(id, () => obtener(org, id, opciones)),
    aplicar: (org, id, data) => encolar(id, () => aplicar(org, id, data)),
  };
}

module.exports = { crearServicioPropuestas };
