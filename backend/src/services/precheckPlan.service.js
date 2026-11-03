'use strict';

const crypto = require('node:crypto');

function conflictoPlan() {
  return Object.assign(new Error('El plan cambió. Volvé a verificar antes de seguir.'), {
    statusCode: 409, codigo: 'ESTADO_PRECHECK_CAMBIO',
  });
}

// Solo se guardan datos: los índices, opciones y propuestas se reconstruyen al leer.
function contenidoSesion(sesion, plan = null) {
  return JSON.parse(JSON.stringify({ categoriasPlan: sesion.categoriasPlan,
    refFecha: sesion.refFecha, nominaCategorias: sesion.nominaCategorias, plan }));
}

function hidratarPlan(fila, organizadorId) {
  if (fila.version !== 1) throw conflictoPlan();
  const categoriasPlan = structuredClone(fila.contenido.categoriasPlan);
  for (const c of categoriasPlan) for (const z of c.zonas) for (const p of z.partidos) {
    if (p.fechaHora) p.fechaHora = new Date(p.fechaHora);
  }
  return { torneoId: fila.torneoId, organizadorId, categoriasPlan,
    refFecha: new Date(fila.contenido.refFecha), parejaIdsHash: fila.nomina,
    nominaCategorias: fila.contenido.nominaCategorias,
    guardadoRevision: fila.revision, createdAt: Date.now(), expiresAt: Date.now() + 60 * 60_000 };
}

async function comprobarRevision(db, torneoId, revision) {
  const fila = await db.precheckPlan.findUnique({ where: { torneoId } });
  if ((fila?.revision || null) !== (revision || null)) throw conflictoPlan();
  return fila;
}

async function guardarPlan(db, sesion, firma, plan = null) {
  await comprobarRevision(db, sesion.torneoId, sesion.guardadoRevision);
  const revision = crypto.randomUUID();
  const data = { contenido: contenidoSesion(sesion, plan), revision, firma, nomina: sesion.parejaIdsHash };
  if (sesion.guardadoRevision) {
    const res = await db.precheckPlan.updateMany({
      where: { torneoId: sesion.torneoId, revision: sesion.guardadoRevision }, data,
    });
    if (res.count !== 1) throw conflictoPlan();
  } else {
    await db.precheckPlan.create({ data: { torneoId: sesion.torneoId, ...data } });
  }
  return revision;
}

module.exports = { hidratarPlan, guardarPlan, comprobarRevision, conflictoPlan };
