'use strict';

const crypto = require('crypto');
const { generarPropuestasZona } = require('../utils/propuestasZona');
const { verificarProgramacionZona } = require('../utils/programacionZona');
const { obtenerOpcionesPartidoZona, recalcularOpcionPartidoZona, listarPartidosZona } = require('../utils/opcionesPartidoZona');
const { generarGrillaOrganizador } = require('./slots.service');
const { fusionarSlotsEnVentanas, slotIdToMsWindow } = require('./zona.service');
const { requireTorneoFecha } = require('../utils/dateUtils');
const DURACION_MS = 75 * 60_000;
const { hidratarPlan, guardarPlan, comprobarRevision, conflictoPlan } = require('./precheckPlan.service');

function crearServicioPropuestas({ prisma, preCheckSessions, planesCache, preCheckBase, reconstruirOcupacion }) {
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
        z.parejaIds, z.partidos.map((p) => [p.posicionEnRonda, p.pareja1Id, p.pareja2Id, p.fechaHora, p.canchaNumero, p.sinHorarioAsignado, Boolean(p.fijadoManual)])])]),
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
      sesion.revision = crypto.randomUUID();
      sesion.propuestasFirma = actual;
      sesion.propuestasCache = new Map();
      sesion.propuestasPorZona = new Map();
      sesion.opcionesPorPartido = new Map();
      sesion.opcionesCache = new Map();
    }
    for (const conflicto of respuesta.conflictos || []) {
      const categoria = sesion.categoriasPlan.find((c) => c.categoriaId === conflicto.categoriaId);
      for (const pendiente of conflicto.partidosSinHorario || []) {
        if (pendiente.motivo !== 'ZONA_MANUAL_INCOMPLETA') continue;
        const zona = categoria?.zonas.find((z) => z.id === pendiente.zonaId);
        if (zona) pendiente.partidosZona = listarPartidosZona(zona);
      }
    }
    respuesta.revision = sesion.revision;
    return respuesta;
  }
  const nomina = (estado) => estado.torneo.categorias.filter((c) => c.estado === 'BORRADOR' && c.parejas.length)
    .map((c) => [c.id, c.parejas.map((p) => p.id).sort()]).sort((a, b) => a[0].localeCompare(b[0]));
  const hashParejas = (estado) => estado.torneo.categorias.filter((c) => c.estado === 'BORRADOR')
    .flatMap((c) => c.parejas.map((p) => p.id)).sort().join(',');
  async function obtener(org, id, opciones = {}) {
    const estado = await leerEstado(prisma, org, id);
    const fila = await prisma.precheckPlan.findUnique({ where: { torneoId: id } });
    // La identidad incluye la categoría: mover una pareja también cambia la nómina.
    if (fila && !opciones.forceReset && (fila.nomina !== hashParejas(estado) ||
        JSON.stringify(fila.contenido.nominaCategorias) !== JSON.stringify(nomina(estado)))) {
      return { bloqueado: true, codigo: 'NOMINA_PRECHECK_CAMBIO', nominaCambio: true,
        motivo: 'Cambió la lista de parejas. Para seguir, rearmá las zonas desde cero.',
        conflictos: [], revision: null, permiteInicioEmergencia: false };
    }
    let anterior = preCheckSessions.get(id);
    if (fila && (!anterior || anterior.expiresAt <= Date.now() || anterior.guardadoRevision !== fila.revision)) {
      anterior = hidratarPlan(fila, org);
      reconstruirOcupacion(anterior, estado.club.cantidadCanchas);
      preCheckSessions.set(id, anterior);
    }
    const respaldo = anterior && structuredClone(anterior);
    const planesAntes = [...planesCache].filter(([, p]) => p.torneoId === id);
    const firmaEntrada = anterior ? firma(estado, respaldo) : null;
    try {
      const respuesta = await anexar(org, id, await preCheckBase(org, id, opciones));
      const sesion = preCheckSessions.get(id);
      sesion.guardadoRevision = fila?.revision || null;
      sesion.nominaCategorias = nomina(estado);
      const plan = planesCache.get(respuesta.planId || respuesta.planEmergenciaId) || null;
      const revision = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`UPDATE "Torneo" SET "inscripcionAbierta" = "inscripcionAbierta" WHERE "id" = ${id}`;
        const actual = await leerEstado(tx, org, id);
        if (JSON.stringify(nomina(actual)) !== JSON.stringify(nomina(estado)) ||
            (respaldo && firma(actual, respaldo) !== firmaEntrada) ||
            (!respaldo && firma(actual, sesion) !== firma(estado, sesion))) throw conflictoPlan();
        const revision = await guardarPlan(tx, sesion, firma(actual, sesion), plan);
        return revision;
      }, { timeout: 10_000 });
      sesion.guardadoRevision = revision;
      return respuesta;
    } catch (e) {
      if (anterior && respaldo) { Object.assign(anterior, respaldo); preCheckSessions.set(id, anterior); }
      else preCheckSessions.delete(id);
      for (const [key, p] of planesCache) if (p.torneoId === id) planesCache.delete(key);
      for (const [key, p] of planesAntes) planesCache.set(key, p);
      throw e;
    }
  }
  async function rechazar(org, id, mensaje, codigo) {
    let preCheck;
    try { preCheck = await obtener(org, id, { isReCheck: true }); }
    catch (e) {
      if (![400, 409].includes(e.statusCode)) throw e;
      preCheck = e.preCheck || { bloqueado: true, revision: null, conflictos: [], motivo: e.message };
    }
    throw Object.assign(error(409, mensaje, codigo), { preCheck });
  }
  function claveNaturalZona(estado, categoria, zona) {
    const parejas = new Map(estado.torneo.categorias.flatMap((c) => c.parejas.map((p) => [p.id, p])));
    return JSON.stringify([categoria.nombre, zona.nombre, zona.parejaIds.map((id) => {
      const p = parejas.get(id); return [p.orden, p.jugador1, p.jugador2];
    }).sort((a, b) => a[0] - b[0])]);
  }
  function zonaTrabada(zona) {
    return zona.requiereArmadoManual || zona.partidos.some((p) => p.sinHorarioAsignado || !p.fechaHora);
  }
  async function solicitar(org, id, { categoriaId, zonaId, revision } = {}) {
    if (![categoriaId, zonaId, revision].every((v) => typeof v === 'string' && v)) {
      throw error(400, 'Indicá la categoría, la zona y la revisión del pre-check.', 'PROPUESTA_INVALIDA');
    }
    const estado = await leerEstado(prisma, org, id);
    const sesion = preCheckSessions.get(id);
    if (!sesion || sesion.expiresAt <= Date.now() || sesion.revision !== revision) {
      return rechazar(org, id, 'El pre-check cambió o venció. Volvé a pedir las propuestas de la zona.', 'REVISION_PRECHECK_VIEJA');
    }
    if (firma(estado, sesion) !== sesion.propuestasFirma) {
      return rechazar(org, id, 'Los horarios o el plan cambiaron. Volvé a pedir las propuestas de la zona.', 'ESTADO_PRECHECK_CAMBIO');
    }
    const categoria = sesion.categoriasPlan.find((c) => c.categoriaId === categoriaId);
    const zona = categoria?.zonas.find((z) => z.id === zonaId);
    if (!zona) throw error(404, 'La zona no pertenece a este pre-check.', 'ZONA_PRECHECK_NO_ENCONTRADA');
    const key = `${categoriaId}:${zonaId}`;
    if (!sesion.propuestasPorZona.has(key)) {
      let resultado = { propuestas: [], busquedaIncompleta: false, nodos: 0 };
      if (zonaTrabada(zona)) {
        const claveZona = claveNaturalZona(estado, categoria, zona);
        // Detectar ambigüedad sin generar las propuestas de las otras zonas.
        const coincidencias = sesion.categoriasPlan.flatMap((c) => c.zonas.filter(zonaTrabada).map((z) => claveNaturalZona(estado, c, z)))
          .filter((clave) => clave === claveZona).length;
        if (coincidencias > 1) resultado.busquedaIncompleta = true;
        else if (zona.parejaIds.length >= 2 && zona.parejaIds.length <= 4) {
          resultado = generarPropuestasZona({ ...contexto(estado, sesion, zona), claveZona });
        }
      }
      sesion.propuestasPorZona.set(key, resultado);
      for (const propuesta of resultado.propuestas) sesion.propuestasCache.set(propuesta.clave, { propuesta, zona, categoriaId });
    }
    const resultado = sesion.propuestasPorZona.get(key);
    return { revision: sesion.revision, propuestasZona: structuredClone(resultado.propuestas), busquedaIncompleta: resultado.busquedaIncompleta };
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
    let revisionGuardada;
    try {
      await prisma.$transaction(async (tx) => {
        // Primera escritura para serializar con altas, inicio y otras ediciones en SQLite.
        await tx.torneo.update({ where: { id }, data: { inscripcionAbierta: estado.torneo.inscripcionAbierta } });
        await comprobarRevision(tx, id, sesion.guardadoRevision);
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
        const candidata = structuredClone(sesion);
        const zonaCandidata = candidata.categoriasPlan.find((c) => c.categoriaId === categoriaId).zonas.find((z) => z.id === zona.id);
        for (const p of zonaCandidata.partidos) Object.assign(p,
          propuesta.partidosPropuestos.find((q) => q.posicionEnRonda === p.posicionEnRonda),
          { sinHorarioAsignado: false, fijadoManual: true, pendienteManual: false });
        zonaCandidata.requiereArmadoManual = false;
        revisionGuardada = await guardarPlan(tx, candidata, firma(await leerEstado(tx, org, id), candidata));
      }, { timeout: 10_000 });
    } catch (e) {
      if (e.statusCode === 409) return rechazar(org, id, e.message, e.codigo);
      throw e;
    }
    sesion.guardadoRevision = revisionGuardada;
    // Adoptar solo despues del commit.
    for (const p of guardada.zona.partidos) {
      const q = guardada.propuesta.partidosPropuestos.find((q) => q.posicionEnRonda === p.posicionEnRonda);
      p.fechaHora = new Date(q.fechaHora); p.canchaNumero = q.canchaNumero; p.sinHorarioAsignado = false; p.fijadoManual = true;
    }
    guardada.zona.requiereArmadoManual = false;
    for (const [key, plan] of planesCache) if (plan.torneoId === id) planesCache.delete(key);
    return obtener(org, id, { isReCheck: true });
  }
  async function opcionesPartido(org, id, data = {}) {
    const { categoriaId, zonaId, posicionEnRonda, revision } = data || {};
    if (![categoriaId, zonaId, revision].every((v) => typeof v === 'string' && v) ||
        !Number.isSafeInteger(posicionEnRonda) || posicionEnRonda < 1 ||
        data?.cursor != null) {
      throw error(400, 'Indicá la categoría, la zona, el partido y la revisión del pre-check, sin cursor.', 'OPCIONES_PARTIDO_INVALIDAS');
    }
    const estado = await leerEstado(prisma, org, id);
    const sesion = preCheckSessions.get(id);
    if (!sesion || sesion.expiresAt <= Date.now() || sesion.revision !== revision) {
      return rechazar(org, id, 'El pre-check cambió o venció. Volvé a pedir los horarios del partido.', 'REVISION_PRECHECK_VIEJA');
    }
    if (firma(estado, sesion) !== sesion.propuestasFirma) {
      return rechazar(org, id, 'Los horarios o el plan cambiaron. Volvé a pedir los horarios del partido.', 'ESTADO_PRECHECK_CAMBIO');
    }
    const categoria = sesion.categoriasPlan.find((c) => c.categoriaId === categoriaId);
    const zona = categoria?.zonas.find((z) => z.id === zonaId);
    if (!zona) throw error(404, 'La zona no pertenece a este pre-check.', 'ZONA_PRECHECK_NO_ENCONTRADA');
    if (!zona.partidos.some((p) => p.posicionEnRonda === posicionEnRonda)) {
      throw error(404, 'El partido no pertenece a esta zona.', 'PARTIDO_PRECHECK_NO_ENCONTRADO');
    }
    const key = JSON.stringify([categoriaId, zonaId, posicionEnRonda]);
    if (!sesion.opcionesPorPartido.has(key)) sesion.opcionesPorPartido.set(key,
      obtenerOpcionesPartidoZona({ ...contexto(estado, sesion, zona), claveZona: claveNaturalZona(estado, categoria, zona) },
        posicionEnRonda));
    for (const opcion of sesion.opcionesPorPartido.get(key).opciones) {
      if (opcion.estado === 'NO_DISPONIBLE') continue;
      sesion.opcionesCache.set(JSON.stringify([categoriaId, zonaId, posicionEnRonda, opcion.clave]), opcion.slotId);
    }
    sesion.expiresAt = Date.now() + 60 * 60_000;
    return { revision: sesion.revision, ...structuredClone(sesion.opcionesPorPartido.get(key)) };
  }
  async function fijarPartido(org, id, data = {}) {
    const { categoriaId, zonaId, posicionEnRonda, clave, revision } = data || {};
    if (![categoriaId, zonaId, clave, revision].every((v) => typeof v === 'string' && v) ||
        !Number.isSafeInteger(posicionEnRonda) || posicionEnRonda < 1) {
      throw error(400, 'Indicá la categoría, la zona, el partido, la clave y la revisión del pre-check.', 'FIJACION_PARTIDO_INVALIDA');
    }
    const estado = await leerEstado(prisma, org, id);
    const sesion = preCheckSessions.get(id);
    if (!sesion || sesion.expiresAt <= Date.now() || sesion.revision !== revision) {
      return rechazar(org, id, 'El pre-check cambió o venció. Volvé a pedir los horarios del partido.', 'REVISION_PRECHECK_VIEJA');
    }
    const categoria = sesion.categoriasPlan.find((c) => c.categoriaId === categoriaId);
    const zona = categoria?.zonas.find((z) => z.id === zonaId);
    if (!zona) throw error(404, 'La zona no pertenece a este pre-check.', 'ZONA_PRECHECK_NO_ENCONTRADA');
    const partido = zona.partidos.find((p) => p.posicionEnRonda === posicionEnRonda);
    if (!partido) throw error(404, 'El partido no pertenece a esta zona.', 'PARTIDO_PRECHECK_NO_ENCONTRADO');
    const slotId = sesion.opcionesCache?.get(JSON.stringify([categoriaId, zonaId, posicionEnRonda, clave]));
    if (!slotId) return rechazar(org, id, 'La opción ya no está disponible. Volvé a pedir los horarios del partido.', 'OPCION_VENCIDA');
    let recalculada, revisionGuardada;
    try {
      await prisma.$transaction(async (tx) => {
        // Toma el bloqueo sin copiar un valor leído fuera de la transacción ni cambiar updatedAt.
        await tx.$executeRaw`UPDATE "Torneo" SET "inscripcionAbierta" = "inscripcionAbierta" WHERE "id" = ${id}`;
        await comprobarRevision(tx, id, sesion.guardadoRevision);
        const actual = await leerEstado(tx, org, id);
        const categoriaActual = actual.torneo.categorias.find((c) => c.id === categoriaId);
        if (preCheckSessions.get(id) !== sesion || sesion.expiresAt <= Date.now() || sesion.revision !== revision ||
            categoriaActual?.estado !== 'BORRADOR' || !zona.parejaIds.every((pId) => categoriaActual.parejas.some((p) => p.id === pId))) {
          throw error(409, 'El pre-check cambió o venció. Volvé a pedir los horarios del partido.', 'REVISION_PRECHECK_VIEJA');
        }
        if (firma(actual, sesion) !== sesion.propuestasFirma) {
          throw error(409, 'Los horarios o el plan cambiaron. Volvé a pedir los horarios del partido.', 'ESTADO_PRECHECK_CAMBIO');
        }
        if (partido.fijadoManual || (!partido.sinHorarioAsignado && partido.fechaHora)) {
          throw error(409, 'El partido ya tiene un horario fijo. Revisá el pre-check actualizado.', 'PARTIDO_YA_FIJADO');
        }
        recalculada = recalcularOpcionPartidoZona({ ...contexto(actual, sesion, zona),
          claveZona: claveNaturalZona(actual, categoria, zona) }, posicionEnRonda, slotId);
        if (!recalculada || recalculada.clave !== clave) {
          throw error(409, 'Ese horario ya no permite programar el partido y el resto de la zona. Elegí otra opción.', 'OPCION_NO_FACTIBLE');
        }
        // Una acción válida renueva el TTL antes de los awaits de escritura/commit:
        // el recolector no debe borrar la sesión mientras se confirma la fijación.
        sesion.expiresAt = Date.now() + 60 * 60_000;
        // parejasAAmpliar sale del estado ACTUAL, nunca de la página guardada.
        const involucradas = recalculada.parejasAAmpliar;
        if (involucradas.length) {
          const pares = new Map(categoriaActual.parejas.map((p) => [p.id, p]));
          const nuevos = involucradas.filter((pId) => !pares.get(pId).slotsSeleccionados.some((s) => s.slotId === slotId));
          if (nuevos.length) await tx.slotPareja.createMany({ data: nuevos.map((parejaId) => ({ parejaId, slotId })) });
          await tx.pareja.updateMany({ where: { id: { in: involucradas } }, data: { resolucionManual: true } });
        }
        const candidata = structuredClone(sesion);
        const p = candidata.categoriasPlan.find((c) => c.categoriaId === categoriaId).zonas.find((z) => z.id === zonaId)
          .partidos.find((p) => p.posicionEnRonda === posicionEnRonda);
        Object.assign(p, { fechaHora: new Date(recalculada.fechaHora), canchaNumero: recalculada.canchaNumero,
          sinHorarioAsignado: false, fijadoManual: true, pendienteManual: false });
        revisionGuardada = await guardarPlan(tx, candidata, firma(await leerEstado(tx, org, id), candidata));
      }, { timeout: 10_000 });
    } catch (e) {
      if (e.statusCode === 409) return rechazar(org, id, e.message, e.codigo);
      throw e;
    }
    sesion.guardadoRevision = revisionGuardada;
    // La memoria se actualiza únicamente tras confirmar las altas aditivas en la base.
    Object.assign(partido, { fechaHora: new Date(recalculada.fechaHora), canchaNumero: recalculada.canchaNumero,
      sinHorarioAsignado: false, fijadoManual: true });
    reconstruirOcupacion(sesion, estado.club.cantidadCanchas);
    for (const [key, plan] of planesCache) if (plan.torneoId === id) planesCache.delete(key);
    return obtener(org, id, { isReCheck: true });
  }
  return {
    validarInicio: async (org, id, db, fila) => {
      const actual = await leerEstado(db, org, id);
      if (firma(actual, hidratarPlan(fila, org)) !== fila.firma) throw conflictoPlan();
    },
    preCheck: (org, id, opciones) => encolar(id, () => obtener(org, id, opciones)),
    solicitar: (org, id, data) => encolar(id, () => solicitar(org, id, data)),
    aplicar: (org, id, data) => encolar(id, () => aplicar(org, id, data)),
    opcionesPartido: (org, id, data) => encolar(id, () => opcionesPartido(org, id, data)),
    fijarPartido: (org, id, data) => encolar(id, () => fijarPartido(org, id, data)),
  };
}

module.exports = { crearServicioPropuestas };
