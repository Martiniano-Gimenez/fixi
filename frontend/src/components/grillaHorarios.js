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

// Los inicios no disponibles también se recorren para poder consultar su motivo.
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
