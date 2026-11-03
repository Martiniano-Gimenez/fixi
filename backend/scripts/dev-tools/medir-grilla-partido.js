'use strict';

// node scripts/dev-tools/medir-grilla-partido.js
// FIXI_MUESTRAS (20 por defecto), FIXI_TORNEO_NOMBRE (Impares Noviembre).
// Frío = caché de opciones vacío; caliente = misma revisión y partido cacheados.
// No fija partidos ni altera disponibilidades. Toda consulta de la app va a la copia.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');

const repo = path.resolve(__dirname, '../../..');
const origen = path.join(repo, 'backend/prisma/dev.db');
const hash = () => crypto.createHash('sha256').update(fs.readFileSync(origen)).digest('hex');
const antes = hash();
const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'fixi-grilla-'));
const copia = path.join(carpeta, 'copia.db');
const backup = spawnSync('python', ['-c', [
  'import sqlite3,sys,pathlib',
  'origen=sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+"?mode=ro",uri=True)',
  'destino=sqlite3.connect(sys.argv[2])',
  'origen.backup(destino)',
  'destino.close(); origen.close()',
].join('\n'), origen, copia], { encoding: 'utf8' });
if (backup.status !== 0) throw new Error(backup.stderr || 'Falló la copia consistente');
process.env.DATABASE_URL = `file:${copia.replace(/\\/g, '/')}`;
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
const prisma = require('../../src/lib/prisma');
const servicio = require('../../src/services/organizador.service');
const jwt = require('jsonwebtoken');
const { startTestServer } = require('../utils/testServer');
const cantidad = Number(process.env.FIXI_MUESTRAS || 20);
assert.ok(Number.isInteger(cantidad) && cantidad >= 20);
const nombre = process.env.FIXI_TORNEO_NOMBRE || 'Impares Noviembre';
const resumen = (valores) => {
  const ordenados = [...valores].sort((a, b) => a - b);
  return { medianaMs: +(ordenados.length % 2 ? ordenados[(ordenados.length - 1) / 2]
    : (ordenados[ordenados.length / 2 - 1] + ordenados[ordenados.length / 2]) / 2).toFixed(2),
  p95Ms: +ordenados[Math.ceil(ordenados.length * .95) - 1].toFixed(2) };
};

async function main() {
  const conexiones = await prisma.$queryRawUnsafe('PRAGMA database_list');
  assert.equal(path.resolve(conexiones.find((r) => r.name === 'main').file), path.resolve(copia));
  assert.ok(!path.resolve(copia).startsWith(repo + path.sep));
  const torneo = await prisma.torneo.findFirst({ where: { nombre }, select: { id: true, organizadorId: true } });
  assert.ok(torneo, `No se encontró ${nombre}`);
  const { server, baseUrl } = await startTestServer();
  try {
    const token = jwt.sign({ id: torneo.organizadorId }, process.env.JWT_SECRET);
    async function post(accion, body) {
      const inicio = performance.now();
      const respuesta = await fetch(`${baseUrl}/torneos/${torneo.id}/pre-check-inicio${accion}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const datos = await respuesta.json();
      assert.equal(respuesta.status, 200, JSON.stringify(datos));
      return { ms: performance.now() - inicio, datos };
    }
    const pre = (await post('', {})).datos;
    const casos = pre.conflictos.flatMap((c) => c.partidosSinHorario.map((p) => ({ ...p, categoriaId: c.categoriaId, nombreCategoria: c.nombreCategoria })));
    const zonaE = casos.find((p) => p.nombreCategoria === '7ma Damas' && /(?:zona\s+)?E$/i.test(p.zona));
    const saturado = casos.find((p) => p.motivo === 'SIN_CANCHA_DISPONIBLE');
    assert.ok(zonaE, 'No se encontró zona E de 7ma Damas');
    assert.ok(saturado, 'No se encontró un conflicto real SIN_CANCHA_DISPONIBLE');
    const sesion = servicio.preCheckSessions.get(torneo.id);
    const resultados = [];
    for (const [caso, p] of [['zona E', zonaE], ['canchas saturadas', saturado]]) {
      const posicionEnRonda = p.posicionEnRonda || p.partidosZona.find((q) => q.estado === 'PENDIENTE').posicionEnRonda;
      const body = { categoriaId: p.categoriaId, zonaId: p.zonaId, posicionEnRonda, revision: pre.revision };
      const frio = [], cache = [];
      let datos;
      for (let i = 0; i < cantidad; i++) {
        sesion.opcionesPorPartido.clear(); sesion.opcionesCache.clear();
        const r = await post('/partidos/opciones', body); frio.push(r.ms); datos = r.datos;
        const caliente = await post('/partidos/opciones', body); cache.push(caliente.ms);
        assert.deepEqual(caliente.datos, datos);
      }
      const zona = sesion.categoriasPlan.find((c) => c.categoriaId === p.categoriaId).zonas.find((z) => z.id === p.zonaId);
      const partido = zona.partidos.find((q) => q.posicionEnRonda === posicionEnRonda);
      const parejas = await prisma.pareja.findMany({ where: { id: { in: [partido.pareja1Id, partido.pareja2Id].filter(Boolean) } },
        orderBy: { orden: 'asc' }, select: { jugador1: true, jugador2: true } });
      resultados.push({ caso, categoria: p.nombreCategoria, zona: p.zona, posicionEnRonda,
        parejas: parejas.map((q) => `${q.jugador1} / ${q.jugador2}`),
        inicios: datos.opciones.length, sinCancha: datos.opciones.filter((o) => o.motivo === 'SIN_CANCHA').length,
        incompletas: datos.opciones.filter((o) => o.estado !== 'NO_DISPONIBLE' && !o.verificada).length,
        frio: resumen(frio), cache: resumen(cache), muestrasFrio: frio, muestrasCache: cache });
    }
    const reporte = { copia, hashAntes: antes, hashDespues: hash(), cantidad, resultados,
      superaLimite: resultados.some((r) => r.frio.p95Ms > 1000) };
    assert.equal(reporte.hashAntes, reporte.hashDespues, 'dev.db cambió');
    fs.mkdirSync(path.join(repo, 'capturas'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'capturas/medicion-grilla.json'), JSON.stringify(reporte, null, 2));
    console.log(JSON.stringify(reporte, null, 2));
  } finally {
    await new Promise((r) => server.close(r));
    await prisma.$disconnect();
    assert.equal(hash(), antes, 'dev.db cambió');
  }
}
main().then(() => process.exit(0)).catch(async (e) => {
  console.error(e); await prisma.$disconnect(); assert.equal(hash(), antes); process.exit(1);
});
