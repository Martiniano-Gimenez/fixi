// Funciones auxiliares de la vista pública (diseño v2). Sin estado: solo leen los datos de /api/public/:slug.
import { formatDiaNombre, formatHora, getDiaCalendarioConTrasnoche } from '../../../utils/dateUtils';

// Duración fija de un partido (DURACION_PARTIDO_MIN en el backend)
export const DURACION_PARTIDO_MIN = 75;

export const DIAS_LARGOS = { Vie: 'viernes', 'Sáb': 'sábado', Dom: 'domingo' };

// Búsqueda sin acentos y sin mayúsculas
export const normalizar = (texto) =>
  (texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

// "Ganador Dieciseisavos #2" → "Ganador 16avos #2"; "Ganador Partido 1" → "Ganador partido 1"
const RONDAS_CORTAS = { Dieciseisavos: '16avos', Semifinal: 'semi', Semifinales: 'semi', Semis: 'semi' };
export const acortarOrigen = (t) =>
  (t || '').replace(/^(Ganador|Perdedor) ([A-Za-zÁÉÍÓÚáéíóú]+)(?: de Final)?/, (m, quien, ronda) => `${quien} ${RONDAS_CORTAS[ronda] || ronda.toLowerCase()}`);

export const origenPareja1 = (p) => p.origenPareja1 || p.displayOrigenPareja1 || null;
export const origenPareja2 = (p) => p.origenPareja2 || p.displayOrigenPareja2 || null;
export const nombrePareja1 = (p) => p.pareja1 || p.displayPareja1 || acortarOrigen(origenPareja1(p)) || 'A definir';
export const nombrePareja2 = (p) => p.pareja2 || p.displayPareja2 || acortarOrigen(origenPareja2(p)) || 'A definir';

const empateExacto = (a, b) =>
  a.puntos === b.puntos && a.pg === b.pg && a.sf - a.sc === b.sf - b.sc && a.gf - a.gc === b.gf - b.gc;

/**
 * Parejas ya ubicadas en la llave por su lugar ("1° Zona A" → pareja), con la misma regla que usa el
 * backend para completar el cuadro: la zona terminó (todos sus partidos FINALIZADO) y la posición sale
 * de tabla[], que viene ordenada con ordenarZonaParejas. Si en round robin hay un empate exacto en
 * todos los criterios, el orden no está garantizado y esa posición no se resuelve.
 */
export function clasificadosPorOrigen(categoria) {
  const mapa = new Map();
  (categoria?.zonas || []).forEach((z) => {
    const ps = z.partidos || [];
    if (!ps.length || !ps.every((p) => p.estado === 'FINALIZADO')) return;
    const t = z.tabla || [];
    for (let i = 0; i < Math.min(z.clasifican, t.length); i++) {
      if (z.formato !== 'MINI_BRACKET' && [t[i - 1], t[i + 1]].some((o) => o && empateExacto(o, t[i]))) continue;
      mapa.set(`${i + 1}° ${z.nombre}`, { nombre: t[i].pareja, parejaId: t[i].parejaId });
    }
  });
  return mapa;
}

// Pareja de cada lado, con el nombre resuelto por su lugar en la llave cuando corresponde
export function ladoDe(p, lado, origenes) {
  const definida = Boolean(lado === 1 ? p.pareja1 : p.pareja2);
  const origen = lado === 1 ? origenPareja1(p) : origenPareja2(p);
  const resuelto = !definida && origen && origenes ? origenes.get(origen) : null;
  return {
    nombre: resuelto ? resuelto.nombre : lado === 1 ? nombrePareja1(p) : nombrePareja2(p),
    parejaId: resuelto ? resuelto.parejaId : lado === 1 ? p.pareja1Id : p.pareja2Id,
    origen: resuelto ? origen : null,
    definida: definida || Boolean(resuelto),
  };
}

export function partidoCoincide(p, q, origenes = null) {
  if (!q) return true;
  const n = normalizar(q);
  // Solo nombres de parejas (no textos como "1° Zona A" sin pareja detrás)
  const nombre = (l) => { const x = ladoDe(p, l, origenes); return x.definida ? x.nombre : ''; };
  const nombres = `${nombre(1)} ${nombre(2)}`;
  return normalizar(nombres).includes(n);
}

// "Sáb 13:30"; sin día cuando la vista ya está filtrada por día
export function horaPartido(fechaHora, conDia = true) {
  if (!fechaHora) return null;
  const hora = formatHora(fechaHora);
  return conDia ? `${formatDiaNombre(fechaHora).slice(0, 3)} ${hora}` : hora;
}

// Etiqueta de un partido de zona (mini-bracket: qué partido es)
export function etiquetaRonda(zona, p) {
  if (zona?.formato !== 'MINI_BRACKET') return null;
  return { 1: 'partido 1', 2: 'partido 2', 3: 'final de zona', 4: 'por el 3.er puesto' }[p.posicionEnRonda] || null;
}

// Todos los partidos de una categoría, sin los "pasa directo", con su etiqueta
export function partidosDeCategoria(cat) {
  if (!cat) return [];
  const zonas = (cat.zonas || []).flatMap((z) =>
    (z.partidos || []).map((p) => {
      const r = etiquetaRonda(z, p);
      return { ...p, etiqueta: r ? `${z.nombre}, ${r}` : z.nombre, zonaId: z.id };
    })
  );
  const llave = (cat.eliminatoria || []).flatMap((f) =>
    (f.partidos || []).filter((p) => !p.esBye).map((p) => ({ ...p, etiqueta: fraseFase(f.nombre), faseId: f.id }))
  );
  return [...zonas, ...llave];
}

// Parejas de todas las categorías que coinciden con la búsqueda, con su categoría
export function parejasQueCoinciden(categorias, q) {
  if (!q || !q.trim()) return [];
  const n = normalizar(q.trim());
  const palabras = n.split(/\s+/).filter(Boolean);
  const out = [];

  (categorias || []).forEach((c) => {
    const mapa = new Map();

    // 1. Parejas registradas en la categoría
    (c.parejas || []).forEach((p) => {
      const nombre = `${p.jugador1} / ${p.jugador2}`;
      mapa.set(p.id, { parejaId: p.id, nombre, cat: c });
    });

    // 2. Parejas en zonas (tabla y partidos)
    (c.zonas || []).forEach((z) => {
      (z.tabla || []).forEach((row) => {
        if (row.parejaId && row.pareja && !mapa.has(row.parejaId)) {
          mapa.set(row.parejaId, { parejaId: row.parejaId, nombre: row.pareja, cat: c });
        }
      });
      (z.partidos || []).forEach((p) => {
        if (p.pareja1Id && p.pareja1 && !mapa.has(p.pareja1Id)) {
          mapa.set(p.pareja1Id, { parejaId: p.pareja1Id, nombre: p.pareja1, cat: c });
        }
        if (p.pareja2Id && p.pareja2 && !mapa.has(p.pareja2Id)) {
          mapa.set(p.pareja2Id, { parejaId: p.pareja2Id, nombre: p.pareja2, cat: c });
        }
      });
    });

    // 3. Parejas en cuadro eliminatorio
    (c.eliminatoria || []).forEach((f) => {
      (f.partidos || []).forEach((p) => {
        if (p.pareja1Id && p.pareja1 && !mapa.has(p.pareja1Id)) {
          mapa.set(p.pareja1Id, { parejaId: p.pareja1Id, nombre: p.pareja1, cat: c });
        }
        if (p.pareja2Id && p.pareja2 && !mapa.has(p.pareja2Id)) {
          mapa.set(p.pareja2Id, { parejaId: p.pareja2Id, nombre: p.pareja2, cat: c });
        }
      });
    });

    mapa.forEach((pareja) => {
      const norm = normalizar(pareja.nombre);
      const coincide = norm.includes(n) || (palabras.length > 1 && palabras.every((pal) => norm.includes(pal)));
      if (coincide) out.push(pareja);
    });
  });

  return out;
}

// Todos los partidos de una pareja en una categoría, con sus orígenes resueltos
export function partidosDePareja(cat, parejaId, parejaNombre) {
  if (!cat) return [];
  const origenes = clasificadosPorOrigen(cat);
  const partidos = partidosDeCategoria(cat);
  return partidos.filter((p) => {
    const l1 = ladoDe(p, 1, origenes);
    const l2 = ladoDe(p, 2, origenes);
    if (parejaId) {
      if (l1.parejaId === parejaId || l2.parejaId === parejaId) return true;
      if (p.pareja1Id === parejaId || p.pareja2Id === parejaId) return true;
    }
    if (parejaNombre) {
      if (l1.definida && l1.nombre === parejaNombre) return true;
      if (l2.definida && l2.nombre === parejaNombre) return true;
      if (p.pareja1 === parejaNombre || p.pareja2 === parejaNombre) return true;
    }
    return false;
  });
}

// Partidos agrupados por jornada ("Sábado 5", "Domingo 6") respetando la regla de trasnoche
export function agruparPartidosPorJornada(partidos, dias) {
  const conHora = partidos.filter((p) => Boolean(p.fechaHora)).sort(porHorario);
  const sinHora = partidos.filter((p) => !p.fechaHora);

  const diasMap = new Map();
  conHora.forEach((p) => {
    const key = diaDe(p);
    if (!key) return;
    if (!diasMap.has(key)) {
      const dTorneo = dias.find((d) => d.key === key);
      const info = jornada(p.fechaHora);
      const dia = dTorneo || (info ? { key: info.key, diaNombre: info.diaNombre } : { key, diaNombre: '' });
      diasMap.set(key, { dia, partidos: [] });
    }
    diasMap.get(key).partidos.push(p);
  });

  const jornadas = [...diasMap.values()].sort((a, b) => a.dia.key.localeCompare(b.dia.key));
  return { jornadas, sinHora };
}

// Jornada de un horario: la madrugada (hasta las 6) cuenta para el día anterior, como en el resto de Fixi
const jornada = (fechaHora) => getDiaCalendarioConTrasnoche(fechaHora);

// Días del torneo (claves YYYY-MM-DD, por jornada) según los horarios de todos los partidos
export function diasDelTorneo(categorias) {
  const dias = new Map();
  categorias.forEach((c) =>
    partidosDeCategoria(c).forEach((p) => {
      const info = jornada(p.fechaHora);
      if (info && !dias.has(info.key)) dias.set(info.key, info.diaNombre);
    })
  );
  return [...dias.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, diaNombre]) => ({ key, diaNombre }));
}

// Qué jornada muestra "Hoy": la actual si es del torneo; antes del torneo, la primera; después, la última
export function diaDeHoy(dias, ahora = Date.now()) {
  if (!dias.length) return null;
  const hoy = jornada(new Date(ahora))?.key;
  if (dias.some((d) => d.key === hoy)) return { ...dias.find((d) => d.key === hoy), momento: 'durante' };
  if (hoy < dias[0].key) return { ...dias[0], momento: 'antes' };
  return { ...dias[dias.length - 1], momento: 'despues' };
}

const MES = new Intl.DateTimeFormat('es-AR', { month: 'long', timeZone: 'UTC' });
const partesClave = (key) => key.split('-').map(Number); // [año, mes, día]
const mesDe = (key) => { const [a, m, d] = partesClave(key); return MES.format(new Date(Date.UTC(a, m - 1, d))); };

// "Sábado 5": nombre de una jornada
export const nombreJornada = (dia) => `${dia.diaNombre} ${partesClave(dia.key)[2]}`;

// "Viernes 4 al domingo 6 de septiembre" con la primera y la última jornada; null si hay una sola o ninguna
export function rangoFechas(dias) {
  if (dias.length < 2) return null;
  const a = dias[0];
  const b = dias[dias.length - 1];
  const mesA = mesDe(a.key);
  const mesB = mesDe(b.key);
  const desde = mesA === mesB ? nombreJornada(a) : `${nombreJornada(a)} de ${mesA}`;
  return `${desde} al ${b.diaNombre.toLowerCase()} ${partesClave(b.key)[2]} de ${mesB}`;
}

export const diaDe = (p) => jornada(p.fechaHora)?.key || null;

// Pendiente cuyo horario ya pasó (inicio + duración) y todavía no tiene resultado
export const sinResultado = (p, ahora = Date.now()) =>
  p.estado === 'PENDIENTE' && Boolean(p.fechaHora) && new Date(p.fechaHora).getTime() + DURACION_PARTIDO_MIN * 60000 < ahora;

// "Dieciseisavos de Final" → "Dieciseisavos de final" (mayúscula solo al principio)
export const fraseFase = (texto) => (texto || '').replace(/ de Final(?![a-záéíóú])/g, ' de final');
export const porHorario = (a, b) => new Date(a.fechaHora) - new Date(b.fechaHora);

// ─── Estructura por categorías (v3) ───

// Etiqueta corta de cada fase en el recorrido ("16avos", "8vos", "4tos", "Semi", "Final")
const ETAPA_CORTA = { 32: '16avos', 16: '8vos', 8: '4tos', 4: 'Semi', 2: 'Final', 1: 'Final' };
export const etapaCorta = (fase) => ETAPA_CORTA[fase.ronda] || fraseFase(fase.nombre);

// Final de la categoría: la fase con la ronda más chica
const faseFinal = (cat) => {
  const fases = cat?.eliminatoria || [];
  return fases.length ? fases.reduce((a, f) => (f.ronda < a.ronda ? f : a), fases[0]) : null;
};

// Campeones y subcampeones de una categoría (ganador de la final), o null si todavía no se jugó
export function podioDe(cat) {
  const p = faseFinal(cat)?.partidos?.find((x) => !x.esBye);
  if (!p || p.estado !== 'FINALIZADO' || !p.ganador) return null;
  const ganaP1 = p.ganadorId != null && p.pareja1Id != null ? p.ganadorId === p.pareja1Id : p.ganador === p.pareja1;
  return { campeones: p.ganador, subcampeones: (ganaP1 ? p.pareja2 : p.pareja1) || null };
}

// Etapas del recorrido: las zonas y cada fase del cuadro, con sus partidos jugados (sin "pasa directo")
export function etapasDe(cat) {
  const etapas = [];
  const zonas = (cat?.zonas || []).flatMap((z) => z.partidos || []);
  if (zonas.length) etapas.push({ key: 'zonas', corta: 'Zonas', larga: 'Zonas', partidos: zonas });
  (cat?.eliminatoria || []).forEach((f) =>
    etapas.push({ key: f.id, corta: etapaCorta(f), larga: fraseFase(f.nombre), partidos: (f.partidos || []).filter((p) => !p.esBye) })
  );
  // La primera que no terminó es la actual; las anteriores, hechas; las siguientes, futuras
  let hayActual = false;
  return etapas.map((e) => {
    const total = e.partidos.length;
    const jugados = e.partidos.filter((p) => p.estado === 'FINALIZADO').length;
    let estado = 'futura';
    if (total && jugados === total) estado = 'hecha';
    else if (!hayActual) { estado = 'actual'; hayActual = true; }
    return { key: e.key, corta: e.corta, larga: e.larga, total, jugados, estado };
  });
}

// Estado de una categoría para su tarjeta y su encabezado
export function estadoDe(cat, ahora = Date.now()) {
  const ps = partidosDeCategoria(cat);
  const total = ps.length;
  const jugados = ps.filter((p) => p.estado === 'FINALIZADO').length;
  const vivos = ps.filter((p) => p.estado === 'EN_CURSO').length;
  const terminada = total > 0 && jugados === total;
  const proximo = ps
    .filter((p) => p.estado === 'PENDIENTE' && p.fechaHora && new Date(p.fechaHora).getTime() >= ahora)
    .sort(porHorario)[0] || null;
  const preparacion = !(cat?.zonas || []).length && !(cat?.eliminatoria || []).length;
  return { total, jugados, vivos, terminada, proximo, preparacion, podio: terminada ? podioDe(cat) : null };
}
