// Funciones auxiliares de la vista pública (diseño v2). Sin estado: solo leen los datos de /api/public/:slug.
import { formatDiaNombre, formatHora, getDiaCalendarioCordoba } from '../../../utils/dateUtils';

export const DIAS_LARGOS = { Vie: 'viernes', 'Sáb': 'sábado', Dom: 'domingo' };

// Búsqueda sin acentos y sin mayúsculas
export const normalizar = (texto) =>
  (texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

export const nombrePareja1 = (p) =>
  p.pareja1 || p.displayPareja1 || p.origenPareja1 || p.displayOrigenPareja1 || 'A definir';
export const nombrePareja2 = (p) =>
  p.pareja2 || p.displayPareja2 || p.origenPareja2 || p.displayOrigenPareja2 || 'A definir';

export function partidoCoincide(p, q) {
  if (!q) return true;
  const n = normalizar(q);
  return normalizar(`${p.pareja1 || ''} ${p.pareja2 || ''}`).includes(n);
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

// Días del torneo (claves YYYY-MM-DD) según los horarios de todos los partidos
export function diasDelTorneo(categorias) {
  const dias = new Map();
  categorias.forEach((c) =>
    partidosDeCategoria(c).forEach((p) => {
      const info = getDiaCalendarioCordoba(p.fechaHora);
      if (info && !dias.has(info.key)) dias.set(info.key, info.diaNombre);
    })
  );
  return [...dias.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, diaNombre]) => ({ key, diaNombre }));
}

// Qué día muestra "Hoy": hoy si es día de torneo; antes del torneo, el primero; después, el último
export function diaDeHoy(dias, ahora = Date.now()) {
  if (!dias.length) return null;
  const hoy = getDiaCalendarioCordoba(new Date(ahora))?.key;
  if (dias.some((d) => d.key === hoy)) return { ...dias.find((d) => d.key === hoy), momento: 'durante' };
  if (hoy < dias[0].key) return { ...dias[0], momento: 'antes' };
  return { ...dias[dias.length - 1], momento: 'despues' };
}

export const diaDe = (p) => getDiaCalendarioCordoba(p.fechaHora)?.key || null;
export const porHorario = (a, b) => new Date(a.fechaHora) - new Date(b.fechaHora);
