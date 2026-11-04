'use strict';

/**
 * Optimizador conjunto de zonas y horarios del pre-check (módulo puro: sin Prisma, reloj global ni azar).
 *
 * Parte del plan que arma hoy el pre-check y lo mejora con búsqueda por vecindarios: en cada vuelta libera
 * unas pocas zonas (las que tienen partidos sin horario y las que ocupan los horarios que esos partidos
 * necesitan), y resuelve de forma exacta con HiGHS (MIP) cómo volver a armarlas y agendarlas juntas, con el
 * resto del plan fijo. Solo acepta una vuelta si mejora estrictamente, así que nunca queda peor que la base.
 *
 * Modelo de cada vuelta (todo en la grilla de inicios de 15 min del club):
 *  - columnas de zona: subconjuntos de parejas con los tamaños de calcularConfigZonas (ROUND_ROBIN de 2 o 3,
 *    MINI_BRACKET de 4). Un par sin ningún inicio común puede quedar en una misma zona: su partido cuenta como
 *    sin horario (en 7ma Damas de Impares Noviembre no existe ninguna partición en tríos sin pares así);
 *  - variable x[partido, inicio] dentro de la disponibilidad efectiva de ambas parejas;
 *  - capacidad: en cada tick de 15 min, partidos simultáneos <= canchas - partidos externos;
 *  - una pareja no juega dos partidos a la vez;
 *  - MINI_BRACKET: P3 y P4 solo en inicios donde las 4 parejas pueden y después de que terminan P1 y P2;
 *    P3 y P4 pueden coincidir (sus parejas son disjuntas).
 * Objetivo: primero parejas en zona manual, después partidos sin horario.
 *
 * Determinismo: mismo `entrada` -> misma salida mientras las vueltas terminen por optimalidad o por tope de
 * nodos/iteraciones (el reloj es solo un seguro). PRNG con semilla fija y orden natural en todo.
 */

const TICKS_PARTIDO = 5; // 75 min en ticks de 15 min
const PESO_MANUAL = 100;
const MAX_QUADS = 25;

const pk = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const qk = (ids, pos) => `Q:${[...ids].sort().join('|')}:${pos}`;
const zk = (ids) => [...ids].sort().join('|');

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function interseccion(a, b) {
  const out = [];
  let i = 0; let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push(a[i]); i++; j++; } else if (a[i] < b[j]) i++; else j++;
  }
  return out;
}

/** Partidos de una zona: [{ key, pos, a, b, derivado }]. `ids` ya está en el orden de juego de la zona. */
function partidosDe(z) {
  const [p0, p1, p2, p3] = z.ids;
  if (z.ids.length === 2) return [{ key: pk(p0, p1), pos: 1, a: p0, b: p1 }];
  if (z.ids.length === 3) {
    return [{ key: pk(p0, p1), pos: 1, a: p0, b: p1 }, { key: pk(p0, p2), pos: 2, a: p0, b: p2 }, { key: pk(p1, p2), pos: 3, a: p1, b: p2 }];
  }
  return [
    { key: pk(p0, p1), pos: 1, a: p0, b: p1 }, { key: pk(p2, p3), pos: 2, a: p2, b: p3 },
    { key: qk(z.ids, 3), pos: 3, derivado: true }, { key: qk(z.ids, 4), pos: 4, derivado: true },
  ];
}

/**
 * Asigna número de cancha a los partidos agendados: orden por inicio, primera cancha libre (como el resto de
 * la app), respetando los externos ya puestos en canchas concretas. Un partido que no encuentra cancha queda
 * sin horario (no debería pasar si la capacidad por tick se respetó; solo con externos mal repartidos).
 * @returns {{ canchas: Map<string, number>, sinCancha: string[] }}
 */
function asignarCanchas({ sched, gridTick, canchas, externosPorCancha = [] }) {
  const ocupado = Array.from({ length: canchas + 1 }, () => []);
  for (const e of externosPorCancha) if (e.cancha >= 1 && e.cancha <= canchas) ocupado[e.cancha].push([e.tick, e.tick + TICKS_PARTIDO]);
  const items = [...sched].map(([key, i]) => ({ key, tick: gridTick[i] }))
    .sort((a, b) => a.tick - b.tick || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const out = new Map(); const sinCancha = [];
  for (const it of items) {
    let elegida = 0;
    for (let c = 1; c <= canchas && !elegida; c++) {
      if (!ocupado[c].some(([s, e]) => it.tick < e && s < it.tick + TICKS_PARTIDO)) elegida = c;
    }
    if (!elegida) { sinCancha.push(it.key); continue; }
    ocupado[elegida].push([it.tick, it.tick + TICKS_PARTIDO]);
    out.set(it.key, elegida);
  }
  return { canchas: out, sinCancha };
}

/** Verificador independiente del modelo: devuelve la lista de violaciones (vacía si el plan es válido). */
function validarSolucion({ zonas, sched, dominio, gridTick, canchas, uso = new Map(), config }) {
  const errores = [];
  const porTick = new Map(); const porPareja = new Map();
  const zonaDe = new Map();
  for (const z of zonas) {
    for (const id of z.ids) {
      if (zonaDe.has(id)) errores.push(`pareja ${id} en dos zonas`);
      zonaDe.set(id, z);
    }
  }
  const finDe = new Map(); // key de P1/P2 -> tick de fin
  for (const z of zonas) for (const p of partidosDe(z)) {
    const i = sched.get(p.key);
    if (i === undefined) continue;
    const t0 = gridTick[i];
    const involucradas = p.derivado ? z.ids : [p.a, p.b];
    for (const id of involucradas) if (!dominio.get(id)?.includes(i)) errores.push(`${p.key}: fuera de disponibilidad (${id})`);
    for (let k = 0; k < TICKS_PARTIDO; k++) {
      porTick.set(t0 + k, (porTick.get(t0 + k) || 0) + 1);
      if (!p.derivado) for (const id of [p.a, p.b]) { const kk = `${id}@${t0 + k}`; porPareja.set(kk, (porPareja.get(kk) || 0) + 1); }
    }
    if (!p.derivado) finDe.set(`${zk(z.ids)}#${p.pos}`, t0 + TICKS_PARTIDO);
  }
  for (const z of zonas) if (z.ids.length === 4) {
    for (const pos of [3, 4]) {
      const i = sched.get(qk(z.ids, pos));
      if (i === undefined) continue;
      for (const base of [1, 2]) {
        const fin = finDe.get(`${zk(z.ids)}#${base}`);
        if (fin === undefined || gridTick[i] < fin) errores.push(`P${pos} de ${zk(z.ids)} antes de terminar P${base}`);
      }
    }
  }
  for (const [t, n] of porTick) if (n + (uso.get(t) || 0) > canchas) errores.push(`canchas excedidas en el tick ${t}`);
  for (const [k, n] of porPareja) if (n > 1) errores.push(`pareja doble ${k}`);
  if (config) {
    for (const [catKey, cfg] of Object.entries(config)) {
      const tam = { 2: 0, 3: 0, 4: 0 };
      for (const z of zonas.filter((x) => x.catKey === catKey)) tam[z.ids.length]++;
      for (const s of [2, 3, 4]) if (tam[s] > cfg.filter((c) => c === s).length) errores.push(`${catKey}: demasiadas zonas de ${s}`);
    }
  }
  return errores;
}

/**
 * @param {object} entrada
 *   canchas, gridTick[], uso: [[tick, n]], categorias: [{ key, parejas: [{ id, orden, dominio[] }], config: [4,3,3,2] }],
 *   base: { zonas: [{ catKey, ids: [] }], sched: [[key, gridIdx]] }   (plan que arma hoy el pre-check)
 *   semilla, presupuestoMs, maxIteraciones, estancamiento, tiempoPorVueltaMs, maxColumnas
 * @param {{ highs: object }} deps  instancia ya cargada de highs-js
 */
async function optimizar(entrada, { highs }) {
  const t0 = Date.now();
  const {
    canchas, gridTick, categorias, base, semilla = 1, presupuestoMs = 9500, maxIteraciones = 100000, estancamiento = 400,
    tiempoPorVueltaMs = 3000, maxColumnas = 900,
  } = entrada;
  const uso = new Map(entrada.uso || []);
  const rnd = mulberry32(semilla);

  const dom = new Map(); const orden = new Map(); const catDe = new Map();
  const cats = categorias.map((c) => {
    const o = { key: c.key, ids: [...c.parejas].sort((a, b) => a.orden - b.orden || (a.id < b.id ? -1 : 1)).map((p) => p.id),
      n4: c.config.filter((s) => s === 4).length, n3: c.config.filter((s) => s === 3).length, n2: c.config.filter((s) => s === 2).length };
    for (const p of c.parejas) { dom.set(p.id, Int32Array.from(p.dominio)); orden.set(p.id, p.orden); catDe.set(p.id, o); }
    return o;
  });
  const cacheDom = new Map();
  const domPar = (a, b) => {
    const k = pk(a, b); let d = cacheDom.get(k);
    if (!d) { d = interseccion(dom.get(a), dom.get(b)); cacheDom.set(k, d); }
    return d;
  };
  const domCuarteto = (ids) => interseccion(domPar(ids[0], ids[1]), domPar(ids[2], ids[3]));

  // ---- estado ----
  let zonas = base.zonas.map((z) => ({ cat: catDe.get(z.ids[0]), ids: [...z.ids] }));
  const sched = new Map(base.sched);
  const enZona = new Set();
  const refrescar = () => { enZona.clear(); zonas.forEach((z) => z.ids.forEach((id) => enZona.add(id))); };
  refrescar();
  const manuales = () => cats.flatMap((c) => c.ids.filter((id) => !enZona.has(id)));
  const sinHorarioDe = (z) => partidosDe(z).filter((p) => !sched.has(p.key));
  const sinHorario = () => zonas.reduce((a, z) => a + sinHorarioDe(z).length, 0);
  const costo = () => PESO_MANUAL * manuales().length + sinHorario();
  const inicial = { manual: manuales().length, sinHorario: sinHorario() };

  function resolverVuelta(libres, { maxMalos, maxMalosCuarteto, maxColumnas = Infinity, catSemilla = null }, limiteMs) {
    const libresSet = new Set(libres);
    const fijas = zonas.filter((z) => !libresSet.has(z));
    const usado = new Map(uso);
    for (const z of fijas) for (const p of partidosDe(z)) {
      const i = sched.get(p.key); if (i === undefined) continue;
      for (let k = 0; k < TICKS_PARTIDO; k++) usado.set(gridTick[i] + k, (usado.get(gridTick[i] + k) || 0) + 1);
    }
    const universo = new Map();
    for (const z of libres) { const c = z.cat; if (!universo.has(c)) universo.set(c, []); universo.get(c).push(...z.ids); }
    if (catSemilla && !universo.has(catSemilla)) universo.set(catSemilla, []); // categoría sin ninguna zona armada
    for (const id of manuales()) { const c = catDe.get(id); if (universo.has(c)) universo.get(c).push(id); }

    for (const ids of universo.values()) ids.sort((p, q) => orden.get(p) - orden.get(q) || (p < q ? -1 : 1));
    const cols = []; const bin = []; const filas = [];
    const capTick = new Map(); const parTick = new Map();
    let nx = 0; let nz = 0; let nm = 0;
    const lin = (terms) => { const o = []; for (let i = 0; i < terms.length; i += 8) o.push(terms.slice(i, i + 8).join(' ')); return o.join('\n   '); };
    const pos = (v) => `+ ${v}`;
    const nuevaCol = (nm_, obj, meta) => { bin.push(nm_); cols.push({ nm: nm_, obj, ...meta }); };
    const registrarX = (nombre, ids, i, extra) => {
      for (let k = 0; k < TICKS_PARTIDO; k++) {
        const t = gridTick[i] + k;
        if (!capTick.has(t)) capTick.set(t, []);
        capTick.get(t).push(nombre);
        if (extra !== 'derivado') for (const id of ids) { const kk = `${id}@${t}`; if (!parTick.has(kk)) parTick.set(kk, []); parTick.get(kk).push(nombre); }
      }
    };

    const zonasCol = []; // { nm, z }
    const xCols = []; // { nm, key, i }
    for (const [c, ids] of universo) {
      const n = ids.length;
      const fijasC = fijas.filter((z) => z.cat === c);
      const n4 = c.n4 - fijasC.filter((z) => z.ids.length === 4).length;
      const n3 = c.n3 - fijasC.filter((z) => z.ids.length === 3).length;
      const n2 = c.n2 - fijasC.filter((z) => z.ids.length === 2).length;
      const rr = n3 > 0 || n2 > 0;
      const malo = (a, b) => (domPar(ids[a], ids[b]).length ? 0 : 1);
      // x compartidas por par (zonas ROUND_ROBIN)
      const xPar = new Map();
      if (rr) {
        for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
          const d = domPar(ids[a], ids[b]); if (!d.length) continue;
          const nombres = [];
          for (const i of d) { const nombre = `x${nx++}`; nombres.push(nombre); nuevaCol(nombre, -1, { tipo: 'x' }); registrarX(nombre, [ids[a], ids[b]], i); xCols.push({ nm: nombre, key: pk(ids[a], ids[b]), i }); }
          xPar.set(`${a}|${b}`, nombres);
        }
      }
      const porPareja = ids.map(() => []); const porPar = new Map();
      const z3 = []; const z2 = []; const z4 = [];
      const agregarRR = (miembros, costoZ) => {
        const nombre = `z${nz++}`; nuevaCol(nombre, costoZ, { tipo: 'z' });
        zonasCol.push({ nm: nombre, z: { cat: c, ids: miembros.map((m) => ids[m]).sort((p, q) => orden.get(p) - orden.get(q)) } });
        miembros.forEach((m) => porPareja[m].push(nombre));
        for (let x = 0; x < miembros.length; x++) for (let y = x + 1; y < miembros.length; y++) {
          const kk = `${Math.min(miembros[x], miembros[y])}|${Math.max(miembros[x], miembros[y])}`;
          if (!porPar.has(kk)) porPar.set(kk, []); porPar.get(kk).push(nombre);
        }
        return nombre;
      };
      // las zonas actuales siempre son candidatas: son el punto de partida
      const yaRR = new Set();
      for (const z of libres) if (z.cat === c && z.ids.length <= 3) {
        const miembros = z.ids.map((id) => ids.indexOf(id));
        yaRR.add(zk(z.ids));
        (z.ids.length === 3 ? z3 : z2).push(agregarRR(miembros, z.ids.length === 3 ? 3 : 1));
      }
      if (n3 > 0) for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let d = b + 1; d < n; d++) {
        if (malo(a, b) + malo(a, d) + malo(b, d) <= maxMalos && !yaRR.has(zk([ids[a], ids[b], ids[d]]))) z3.push(agregarRR([a, b, d], 3));
      }
      if (n2 > 0) for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) if (!yaRR.has(zk([ids[a], ids[b]]))) z2.push(agregarRR([a, b], 1));

      // zonas de 4 (MINI_BRACKET): columnas propias con sus x/y
      const miniCols = [];
      if (n4 > 0) {
        const idx = new Map(ids.map((id, k) => [id, k]));
        const candidatos = [];
        const vistos = new Set();
        const empujar = (zIds, esBase) => {
          const clave = zk(zIds); if (vistos.has(clave)) return; vistos.add(clave);
          candidatos.push({ ids: zIds, base: esBase });
        };
        for (const z of libres) if (z.cat === c && z.ids.length === 4) empujar(z.ids, true);
        const rank = [];
        for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let d = b + 1; d < n; d++) for (let e = d + 1; e < n; e++) {
          const m = [a, b, d, e];
          let malos = 0;
          for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) malos += malo(m[p], m[q]);
          if (malos > maxMalosCuarteto) continue;
          // mejor emparejamiento: maximiza el mínimo de inicios comunes de P1 y P2
          let mejor = null;
          for (const [[p, q], [r, s]] of [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]]) {
            const v = Math.min(domPar(ids[m[p]], ids[m[q]]).length, domPar(ids[m[r]], ids[m[s]]).length);
            if (!mejor || v > mejor.v) mejor = { v, orden: [m[p], m[q], m[r], m[s]] };
          }
          const miembros = mejor.orden.map((k) => ids[k]);
          const ordenado = [[miembros[0], miembros[1]], [miembros[2], miembros[3]]].map((par) => par.sort((u, w) => orden.get(u) - orden.get(w)));
          rank.push({ malos, dom: domCuarteto(miembros).length, v: mejor.v, ids: [...ordenado[0], ...ordenado[1]], clave: m.join(',') });
        }
        rank.sort((u, w) => u.malos - w.malos || w.dom - u.dom || w.v - u.v || (u.clave < w.clave ? -1 : 1));
        for (const r of rank.slice(0, MAX_QUADS)) empujar(r.ids, false);
        for (const cand of candidatos) {
          const nombre = `z${nz++}`; nuevaCol(nombre, 4, { tipo: 'z' });
          const zonaCand = { cat: c, ids: cand.ids };
          zonasCol.push({ nm: nombre, z: zonaCand });
          cand.ids.forEach((id) => porPareja[idx.get(id)].push(nombre));
          z4.push(nombre);
          const partidos = partidosDe(zonaCand);
          const vars = {};
          for (const p of partidos) {
            const dd = p.derivado ? domCuarteto(cand.ids) : domPar(p.a, p.b);
            vars[p.pos] = [];
            for (const i of dd) {
              const nombreV = `${p.derivado ? 'y' : 'x'}${nx++}`;
              nuevaCol(nombreV, -1, { tipo: 'x' });
              registrarX(nombreV, p.derivado ? cand.ids : [p.a, p.b], i, p.derivado ? 'derivado' : undefined);
              xCols.push({ nm: nombreV, key: p.key, i, mini: true });
              vars[p.pos].push({ nm: nombreV, i });
            }
            if (vars[p.pos].length) filas.push(` mn_${nombre}_${p.pos}: ${lin(vars[p.pos].map((v) => pos(v.nm)))} - ${nombre} <= 0`);
          }
          // P3/P4 solo después de que terminan P1 y P2
          for (const pd of [3, 4]) for (const v of vars[pd]) {
            for (const base_ of [1, 2]) {
              const previos = vars[base_].filter((u) => gridTick[u.i] + TICKS_PARTIDO <= gridTick[v.i]);
              filas.push(` pr_${v.nm}_${base_}: + ${v.nm} ${previos.map((u) => `- ${u.nm}`).join(' ')} <= 0`);
            }
          }
          miniCols.push(nombre);
        }
      }

      for (let a = 0; a < n; a++) {
        const m = `m${nm++}`; nuevaCol(m, PESO_MANUAL, { tipo: 'm', id: ids[a] });
        filas.push(` pt_${m}: ${lin([...porPareja[a], m].map(pos))} = 1`);
      }
      if (z3.length) filas.push(` n3_${nm}: ${lin(z3.map(pos))} <= ${n3}`);
      if (z2.length) filas.push(` n2_${nm}: ${lin(z2.map(pos))} <= ${n2}`);
      if (z4.length) filas.push(` n4_${nm}: ${lin(z4.map(pos))} <= ${n4}`);
      for (const [kk, nombres] of xPar) {
        const [a, b] = kk.split('|').map(Number);
        const kpar = `${a}|${b}`;
        filas.push(` lk_${nm}_${a}_${b}: ${lin(nombres.map(pos))} ${(porPar.get(kpar) || []).map((v) => `- ${v}`).join(' ')} <= 0`);
      }
    }
    for (const [t, nombres] of capTick) {
      const cap = Math.max(0, canchas - (usado.get(t) || 0));
      if (nombres.length > cap) filas.push(` cp_${t}: ${lin(nombres.map(pos))} <= ${cap}`);
    }
    let np = 0;
    for (const nombres of parTick.values()) if (nombres.length > 1) filas.push(` q${np++}: ${lin(nombres.map(pos))} <= 1`);
    if (!cols.length) return null;
    if (cols.length > maxColumnas) return { mejora: false, demasiado: true };

    const cuerpo = `Minimize
 obj: ${lin(cols.map((c) => `${c.obj >= 0 ? '+' : '-'} ${Math.abs(c.obj)} ${c.nm}`))}
Subject To
${filas.join('\n')}
`;
    const lp = `${cuerpo}Binary
 ${lin(bin)}
End
`;
    const idx = new Map(cols.map((c, k) => [c.nm, k]));
    // punto de partida: la solución actual de las zonas liberadas
    const v0 = new Float64Array(cols.length);
    const colZona = new Map(zonasCol.map((c) => [zk(c.z.ids) + (c.z.ids.length === 4 ? `/${c.z.ids.join(',')}` : ''), c.nm]));
    const colX = new Map(xCols.map((x) => [`${x.mini ? 'M' : 'R'}${x.key}@${x.i}`, x.nm]));
    const enLibres = new Set();
    for (const z of libres) {
      const nombre = colZona.get(zk(z.ids) + (z.ids.length === 4 ? `/${z.ids.join(',')}` : ''));
      if (!nombre) return null; // la base debe poder representarse: si no, no hay punto de partida válido
      v0[idx.get(nombre)] = 1; z.ids.forEach((id) => enLibres.add(id));
      for (const p of partidosDe(z)) {
        const i = sched.get(p.key); if (i === undefined) continue;
        const nx_ = colX.get(`${z.ids.length === 4 ? 'M' : 'R'}${p.key}@${i}`);
        if (!nx_) return null;
        v0[idx.get(nx_)] = 1;
      }
    }
    cols.forEach((c, k) => { if (c.tipo === 'm' && !enLibres.has(c.id)) v0[k] = 1; });
    const costoBase = cols.reduce((a, c, k) => a + c.obj * v0[k], 0);

    // Poda exacta: los costos son enteros, así que mejorar exige llegar a costoBase - 1. Si ni la relajación
    // lineal (milisegundos) lo permite, la vuelta no puede mejorar y no hace falta resolver el MIP.
    const relajado = `${cuerpo}Bounds
${bin.map((x) => ` 0 <= ${x} <= 1`).join('\n')}
End
`;
    const lineal = highs.solve(relajado, { output_flag: false });
    if (lineal.Status === 'Optimal' && lineal.ObjectiveValue > costoBase - 1 + 1e-6) return { mejora: false, podada: true };

    const modelo = highs.createModel({ format: 'lp', data: lp });
    try {
      // Sin límite de tiempo útil por vuelta (solo un seguro): cada vuelta termina por optimalidad o al llegar a una
      // solución que mejora la actual, así el resultado no depende de la velocidad de la máquina.
      modelo.options.set({ time_limit: Math.max(0.05, Math.min(limiteMs, 250 + 0.6 * cols.length) / 1000), mip_rel_gap: 0, random_seed: 0, output_flag: false,
        presolve: 'off', objective_target: costoBase - 0.5 });
      modelo.setSolution({ colValue: v0 });
      modelo.run();
      const sol = modelo.getSolution().colValue;
      if (!sol || sol.length !== cols.length) return null;
      const val = (k) => Math.round(sol[k]);
      const costoNuevo = cols.reduce((a, c, k) => a + c.obj * val(k), 0);
      if (costoNuevo >= costoBase - 1e-6) return { mejora: false };
      const nuevasZonas = zonasCol.filter((c) => val(idx.get(c.nm)) === 1).map((c) => ({ cat: c.z.cat, ids: [...c.z.ids] }));
      const nuevoSched = xCols.filter((x) => val(idx.get(x.nm)) === 1).map((x) => [x.key, x.i]);
      return { mejora: true, nuevasZonas, nuevoSched, costoBase, costoNuevo, columnas: cols.length };
    } finally {
      modelo.dispose();
    }
  }

  // ---- búsqueda por vecindarios ----
  const fallos = new Map();
  let iter = 0; let mejoras = 0; let sinMejora = 0; let motivoFin = 'presupuesto';
  const tamanios = [3, 4, 3, 5, 3, 4];
  const dominioDe = (key, z) => {
    if (key.startsWith('Q:')) return domCuarteto(z.ids);
    const [a, b] = key.split('|'); return domPar(a, b);
  };
  while (true) {
    if (costo() === 0) { motivoFin = 'sin_pendientes'; break; }
    if (Date.now() - t0 >= presupuestoMs) { motivoFin = 'presupuesto'; break; }
    if (iter >= maxIteraciones) { motivoFin = 'iteraciones'; break; }
    if (sinMejora >= estancamiento) { motivoFin = 'estancamiento'; break; }
    iter++; sinMejora++;
    const pendientes = zonas.flatMap((z) => sinHorarioDe(z).map((p) => ({ z, p })));
    const man = manuales();
    // Semilla al azar, pero las que ya fallaron seguido pesan menos (una mejora en otro lado las reactiva).
    const claveSemilla = (k) => (k < pendientes.length ? pendientes[k].p.key : `M:${man[k - pendientes.length]}`);
    const total = pendientes.length + man.length;
    const pesos = Array.from({ length: total }, (_, k) => 1 / (1 + (fallos.get(claveSemilla(k)) || 0)) ** 2);
    let tiro = rnd() * pesos.reduce((x, y) => x + y, 0);
    let eleccion = 0;
    while (eleccion < total - 1 && tiro >= pesos[eleccion]) { tiro -= pesos[eleccion]; eleccion++; }
    const semillaClave = claveSemilla(eleccion);
    const K = tamanios[iter % tamanios.length];
    let semillas; let candidatas; let manualSemilla = false; let imposible = false;
    let pesosCand;
    if (eleccion < pendientes.length) {
      const { z, p } = pendientes[eleccion];
      semillas = [z];
      const d = dominioDe(p.key, z);
      imposible = d.length === 0;
      const ticks = new Set(); for (const i of d) for (let k = 0; k < TICKS_PARTIDO; k++) ticks.add(gridTick[i] + k);
      const invol = p.key.startsWith('Q:') ? z.ids : p.key.split('|');
      candidatas = zonas.filter((o) => o !== z);
      pesosCand = candidatas.map((o) => {
        // ocupan los horarios que este partido necesita (cualquier categoría)
        const ocupa = Math.min(2, partidosDe(o).filter((q) => { const i = sched.get(q.key); return i !== undefined && ticks.has(gridTick[i]); }).length);
        // parejas que podrían ocupar su lugar en esta zona (misma categoría)
        let compat = 0;
        if (o.cat === z.cat) for (const c of o.ids) compat += invol.some((x) => (d.length ? interseccion(dom.get(c), d).length > 0 : domPar(c, x).length > 0)) ? 1 : 0;
        return 0.05 + ocupa + compat * 0.7;
      });
    } else {
      const m = man[eleccion - pendientes.length];
      semillas = []; manualSemilla = true;
      candidatas = zonas.filter((o) => o.cat === catDe.get(m));
      pesosCand = candidatas.map((o) => 0.05 + o.ids.filter((c) => domPar(c, m).length > 0).length);
    }
    // muestreo ponderado sin reposición
    const elegidas = [];
    const cand = candidatas.map((o, i) => ({ o, w: pesosCand[i] }));
    while (elegidas.length < Math.max(0, K - semillas.length) && cand.length) {
      let tiroC = rnd() * cand.reduce((a, c) => a + c.w, 0); let k = 0;
      while (k < cand.length - 1 && tiroC >= cand[k].w) { tiroC -= cand[k].w; k++; }
      elegidas.push(cand[k].o); cand.splice(k, 1);
    }
    const libres = [...semillas, ...elegidas];
    if (!libres.length && !manualSemilla) continue;
    const restante = presupuestoMs - (Date.now() - t0);
    let r;
    for (;;) {
      r = resolverVuelta(libres, { maxMalos: manualSemilla ? 3 : (imposible ? 1 : 0), maxMalosCuarteto: manualSemilla ? 2 : 0, maxColumnas, catSemilla: manualSemilla ? catDe.get(man[eleccion - pendientes.length]) : null },
        Math.min(tiempoPorVueltaMs, restante + 200));
      if (r && r.demasiado && libres.length > Math.max(1, semillas.length) + 1) { libres.pop(); continue; }
      break;
    }
    if (!r || !r.mejora) { fallos.set(semillaClave, (fallos.get(semillaClave) || 0) + 1); continue; }
    const libresSet = new Set(libres);
    const quedan = zonas.filter((z) => !libresSet.has(z));
    for (const z of libres) for (const p of partidosDe(z)) sched.delete(p.key);
    zonas = [...quedan, ...r.nuevasZonas];
    for (const [key, i] of r.nuevoSched) sched.set(key, i);
    refrescar();
    mejoras++; sinMejora = 0; fallos.clear();
  }

  // ---- cierre: orden estable de zonas, canchas y verificación ----
  const tamOrden = (z) => -z.ids.length;
  zonas.sort((u, w) => (u.cat.key < w.cat.key ? -1 : u.cat.key > w.cat.key ? 1 : 0) || tamOrden(u) - tamOrden(w)
    || Math.min(...u.ids.map((i) => orden.get(i))) - Math.min(...w.ids.map((i) => orden.get(i))));
  const externosPorCancha = entrada.externosPorCancha || [];
  const { canchas: canchaDe, sinCancha } = asignarCanchas({ sched, gridTick, canchas, externosPorCancha });
  for (const k of sinCancha) sched.delete(k);
  const config = Object.fromEntries(categorias.map((c) => [c.key, c.config]));
  const errores = validarSolucion({ zonas: zonas.map((z) => ({ catKey: z.cat.key, ids: z.ids })), sched, dominio: dom, gridTick, canchas, uso, config });
  return {
    zonas: zonas.map((z) => ({ catKey: z.cat.key, ids: z.ids })),
    sinGrupo: manuales(),
    horarios: [...sched].map(([key, i]) => [key, i, canchaDe.get(key)]),
    errores,
    metricas: { inicial, final: { manual: manuales().length, sinHorario: sinHorario() }, iteraciones: iter, mejoras, ms: Date.now() - t0, motivoFin },
  };
}

module.exports = { optimizar, validarSolucion, asignarCanchas, partidosDe, pk, qk, zk, TICKS_PARTIDO };
