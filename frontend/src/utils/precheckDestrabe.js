/**
 * Aviso del modal del pre-check cuando el organizador destraba una zona manual.
 *
 * El contador de pendientes cuenta partidos: una zona manual cuenta como 1 pendiente y, al
 * destrabarse, pasa a contar los partidos que no consiguieron lugar. Por eso el contador puede
 * subir aunque se haya resuelto algo, y el aviso lo explica.
 */

const ZONA_MANUAL = 'ZONA_MANUAL_INCOMPLETA';

/** Pendientes que muestra el modal: suma de partidosSinHorario de todas las categorías. */
export function contarPendientes(conflictos) {
  return (conflictos || []).reduce((acc, c) => acc + (c.partidosSinHorario?.length || 0), 0);
}

function claveZona(categoriaId, zonaId) {
  return `${categoriaId}:${zonaId}`;
}

/**
 * Zonas que en `antes` tenían un pendiente ZONA_MANUAL_INCOMPLETA y en `despues` ya no, con la
 * cantidad de partidos de esa zona que siguen pendientes. Solo devuelve las que tienen alguno.
 */
export function detectarZonasDestrabadas(antes, despues) {
  const manualesDespues = new Set();
  const partidosDespues = new Map();
  for (const c of despues || []) {
    for (const p of c.partidosSinHorario || []) {
      const k = claveZona(c.categoriaId, p.zonaId);
      if (p.motivo === ZONA_MANUAL) {
        manualesDespues.add(k);
      } else {
        partidosDespues.set(k, (partidosDespues.get(k) || 0) + 1);
      }
    }
  }

  const zonas = [];
  for (const c of antes || []) {
    for (const p of c.partidosSinHorario || []) {
      if (p.motivo !== ZONA_MANUAL) continue;
      const k = claveZona(c.categoriaId, p.zonaId);
      if (manualesDespues.has(k)) continue;
      const partidosSinCancha = partidosDespues.get(k) || 0;
      if (partidosSinCancha === 0) continue;
      zonas.push({
        categoriaId: c.categoriaId,
        nombreCategoria: c.nombreCategoria,
        zonaId: p.zonaId,
        zona: p.zona,
        partidosSinCancha,
      });
    }
  }
  return zonas;
}

/**
 * Arma el aviso del modal, o null si ninguna zona se destrabó dejando partidos pendientes.
 * Con una sola zona y el contador en suba, la explicación va en la misma línea.
 */
export function armarAvisoDestrabe(antes, despues) {
  const zonas = detectarZonasDestrabadas(antes, despues);
  if (zonas.length === 0) return null;

  const pendientesAntes = contarPendientes(antes);
  const pendientesDespues = contarPendientes(despues);
  const subio = pendientesDespues > pendientesAntes;
  const pasaron = `los pendientes pasaron de ${pendientesAntes} a ${pendientesDespues}`;

  const lineas = zonas.map((z) => {
    const n = z.partidosSinCancha;
    const inicio = `Destrabaste la ${z.zona} de ${z.nombreCategoria}.`;
    if (subio && zonas.length === 1) {
      return `${inicio} Ya tiene sus partidos, pero ${n} ${n === 1 ? 'quedó' : 'quedaron'} sin cancha: por eso ${pasaron}.`;
    }
    return `${inicio} ${n} de sus partidos todavía no ${n === 1 ? 'tiene' : 'tienen'} cancha.`;
  });
  if (subio && zonas.length > 1) {
    lineas.push(`Por eso ${pasaron}.`);
  }

  return { zonas, pendientesAntes, pendientesDespues, subio, lineas };
}
