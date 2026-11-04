export function agruparInicios(opciones) {
  return ['Viernes', 'Sabado'].map((dia) => {
    const horas = new Map();
    for (const opcion of [...opciones].sort((a, b) => a.fechaHora.localeCompare(b.fechaHora))) {
      const [jornada, hora] = opcion.slotId.split('-');
      if (jornada !== dia) continue;
      const [hh, mm] = hora.split(':');
      if (!horas.has(hh)) horas.set(hh, { hora: hh, celdas: [null, null, null, null] });
      horas.get(hh).celdas[Number(mm) / 15] = opcion;
    }
    return { dia, etiqueta: dia === 'Viernes' ? 'vie' : 'sáb', filas: [...horas.values()] };
  });
}

// Recorre las celdas presentes en las filas visibles y saltea los huecos.
export function moverCelda(filas, fila, columna, tecla) {
  let f = fila, c = columna;
  if (tecla === 'Home' || tecla === 'End') {
    const columnas = [0, 1, 2, 3].filter((i) => filas[f].celdas[i]);
    return filas[f].celdas[tecla === 'Home' ? columnas[0] : columnas.at(-1)];
  }
  const paso = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[tecla];
  if (!paso) return null;
  while (true) {
    f += paso[0]; c += paso[1];
    if (c < 0) { f--; c = 3; }
    if (c > 3) { f++; c = 0; }
    if (f < 0 || f >= filas.length) return null;
    if (filas[f].celdas[c]) return filas[f].celdas[c];
  }
}

/** Qué hace falta para usar un horario: entra, pedirle a una pareja o pedirle a varias (la clave agrupa iguales). */
export function categoriaHorario(opcion) {
  if (opcion.estado === 'ENTRA') return 'entra';
  return `pedir:${[...opcion.parejasAAmpliar].sort().join(',')}`;
}

/**
 * Tramos de la grilla de un día. Cada hora se parte por categoría (las celdas conservan su columna), así el título
 * de un tramo vale para todos sus horarios. Se unen horas seguidas de la misma categoría.
 * @returns {{ categoria: string, clave: string, filas: { hora: string, celdas: (object|null)[] }[] }[]}
 */
export function armarTramos(dia, filas) {
  const unidades = [];
  for (const fila of filas) {
    const porCategoria = new Map();
    fila.celdas.forEach((opcion, columna) => {
      if (!opcion) return;
      const cat = categoriaHorario(opcion);
      if (!porCategoria.has(cat)) porCategoria.set(cat, { hora: fila.hora, celdas: [null, null, null, null], primera: columna });
      porCategoria.get(cat).celdas[columna] = opcion;
    });
    unidades.push(...[...porCategoria].sort((a, b) => a[1].primera - b[1].primera).map(([categoria, u]) => ({ categoria, ...u })));
  }
  const consecutivas = (a, b) => a === b || (Number(a) + 1) % 24 === Number(b);
  return unidades.reduce((tramos, u) => {
    const anterior = tramos.at(-1);
    const ultimaHora = anterior?.filas.at(-1).hora;
    if (anterior?.categoria === u.categoria && consecutivas(ultimaHora, u.hora) && ultimaHora !== u.hora) {
      anterior.filas.push({ hora: u.hora, celdas: u.celdas });
    } else {
      tramos.push({ categoria: u.categoria, clave: `${dia}-${u.hora}-${u.primera}`, filas: [{ hora: u.hora, celdas: u.celdas }] });
    }
    return tramos;
  }, []);
}

const minutosJornada = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h < 6 ? h + 24 : h) * 60 + m;
};
const formatoHora = (minutos) => {
  const h = Math.floor(minutos / 60) % 24, m = minutos % 60;
  return m ? `${h}:${String(m).padStart(2, '0')}` : `${h}`;
};

/** Rangos de juego (del primer inicio al final del último partido) de unas opciones, unidos si se pisan. */
function rangosDeJuego(opciones) {
  const inicios = opciones
    .map((o) => { const [dia, hora] = o.slotId.split('-'); return { dia, inicio: minutosJornada(hora) }; })
    .sort((a, b) => (a.dia === b.dia ? a.inicio - b.inicio : a.dia === 'Viernes' ? -1 : 1));
  const rangos = [];
  for (const p of inicios) {
    const ultimo = rangos.at(-1);
    if (ultimo && ultimo.dia === p.dia && p.inicio <= ultimo.fin) ultimo.fin = Math.max(ultimo.fin, p.inicio + 75);
    else rangos.push({ dia: p.dia, desde: p.inicio, fin: p.inicio + 75 });
  }
  return rangos;
}

function nombrarRangos(rangos, conDia = true) {
  const texto = rangos.map((r) => `${conDia ? `el ${r.dia === 'Viernes' ? 'vie' : 'sáb'} ` : ''}de ${formatoHora(r.desde)} a ${formatoHora(r.fin)} h`);
  return texto.length > 1 ? `${texto.slice(0, -1).join(', ')} y ${texto.at(-1)}` : texto[0];
}

/**
 * Por qué no entra un partido cuyas parejas coinciden. Usa los horarios donde todas pueden sin pedir nada y que
 * quedan bloqueados por falta de cancha (SIN_CANCHA) o porque alguna ya juega otro partido (PAREJA_OCUPADA).
 * Null si no hay ninguno.
 */
export function explicarPorQueNoEntra(opciones, esDefinicion = false) {
  const coinciden = opciones.filter((o) => ['SIN_CANCHA', 'PAREJA_OCUPADA'].includes(o.motivo) && !(o.parejasAAmpliar || []).length);
  if (!coinciden.length) return null;
  const todas = esDefinicion ? 'cuatro' : 'dos';
  const sinCancha = coinciden.filter((o) => o.motivo === 'SIN_CANCHA');
  const rangos = rangosDeJuego(coinciden);
  if (sinCancha.length === coinciden.length) {
    return `Pueden las ${todas} ${nombrarRangos(rangos)}, pero todas las canchas están ocupadas.`;
  }
  if (!sinCancha.length) {
    return `Coinciden ${nombrarRangos(rangos)}, pero en ese horario ya juegan sus otros partidos de la zona.`;
  }
  const libres = rangosDeJuego(sinCancha);
  const unSoloDia = new Set(rangos.map((r) => r.dia)).size === 1;
  return `Coinciden ${nombrarRangos(rangos)}. Libres las ${todas}, solo ${nombrarRangos(libres, !unSoloDia)}, ` +
    `y ${libres.length > 1 ? 'en esos horarios' : 'a esa hora'} todas las canchas están ocupadas.`;
}
