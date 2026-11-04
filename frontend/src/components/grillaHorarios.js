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

/**
 * "Pueden las dos el vie de 18 a 21 h, pero todas las canchas están ocupadas." Se arma con los horarios donde
 * todas las parejas pueden (sin pedir nada) y que no tienen cancha libre (motivo SIN_CANCHA). Null si no hay.
 */
export function resumirCanchasSaturadas(opciones, esDefinicion = false) {
  const posibles = opciones.filter((o) => o.motivo === 'SIN_CANCHA' && !(o.parejasAAmpliar || []).length)
    .map((o) => { const [dia, hora] = o.slotId.split('-'); return { dia, inicio: minutosJornada(hora) }; })
    .sort((a, b) => (a.dia === b.dia ? a.inicio - b.inicio : a.dia === 'Viernes' ? -1 : 1));
  if (!posibles.length) return null;
  const tramos = [];
  for (const p of posibles) {
    const ultimo = tramos.at(-1);
    if (ultimo && ultimo.dia === p.dia && p.inicio <= ultimo.fin) ultimo.fin = Math.max(ultimo.fin, p.inicio + 75);
    else tramos.push({ dia: p.dia, desde: p.inicio, fin: p.inicio + 75 });
  }
  const texto = tramos.map((t) => `el ${t.dia === 'Viernes' ? 'vie' : 'sáb'} de ${formatoHora(t.desde)} a ${formatoHora(t.fin)} h`);
  const lista = texto.length > 1 ? `${texto.slice(0, -1).join(', ')} y ${texto.at(-1)}` : texto[0];
  return `Pueden las ${esDefinicion ? 'cuatro' : 'dos'} ${lista}, pero todas las canchas están ocupadas.`;
}
