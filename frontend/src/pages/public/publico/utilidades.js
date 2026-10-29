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
    (f.partidos || []).filter((p) => !p.esBye).map((p) => ({ ...p, etiqueta: f.nombre, faseId: f.id }))
  );
  return [...zonas, ...llave];
}

// Cifras del encabezado: parejas y partidos jugados (sin "pasa directo")
export function cifrasTorneo(categorias) {
  let parejas = 0;
  let total = 0;
  let jugados = 0;
  categorias.forEach((c) => {
    parejas += c.totalParejas || 0;
    partidosDeCategoria(c).forEach((p) => {
      total++;
      if (p.estado === 'FINALIZADO') jugados++;
    });
  });
  return { parejas, total, jugados };
}

// Parejas de todas las categorías que coinciden con la búsqueda, con su categoría y zona
export function parejasQueCoinciden(categorias, q) {
  if (!q) return [];
  const n = normalizar(q);
  const out = [];
  categorias.forEach((c) =>
    (c.zonas || []).forEach((z) =>
      (z.tabla || []).forEach((row) => {
        if (row.pareja && normalizar(row.pareja).includes(n)) {
          out.push({ parejaId: row.parejaId, nombre: row.pareja, catId: c.id, zonaId: z.id });
        }
      })
    )
  );
  return out;
}

// Campeón de cada categoría: ganador de la final (la fase con la ronda más chica)
export function campeones(categorias) {
  return categorias
    .map((c) => {
      const fases = c.eliminatoria || [];
      if (!fases.length) return null;
      const final = fases.reduce((a, f) => (f.ronda < a.ronda ? f : a), fases[0]);
      const p = final.partidos?.[0];
      return p?.estado === 'FINALIZADO' && p.ganador ? { categoria: c.nombre, pareja: p.ganador } : null;
    })
    .filter(Boolean);
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

export const diaDe = (p) => jornada(p.fechaHora)?.key || null;

// Pendiente cuyo horario ya pasó (inicio + duración) y todavía no tiene resultado
export const sinResultado = (p, ahora = Date.now()) =>
  p.estado === 'PENDIENTE' && Boolean(p.fechaHora) && new Date(p.fechaHora).getTime() + DURACION_PARTIDO_MIN * 60000 < ahora;

// "Dieciseisavos de Final" → "Dieciseisavos de final" (mayúscula solo al principio)
export const fraseFase = (texto) => (texto || '').replace(/ de Final(?![a-záéíóú])/g, ' de final');
export const porHorario = (a, b) => new Date(a.fechaHora) - new Date(b.fechaHora);
