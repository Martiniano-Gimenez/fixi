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
 * Tramos de la grilla de un día. Cada hora se parte por categoría (sus horarios quedan juntos a la izquierda), así el título
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
      if (!porCategoria.has(cat)) porCategoria.set(cat, { hora: fila.hora, inicios: [], primera: columna });
      porCategoria.get(cat).inicios.push(opcion);
    });
    // Los horarios de cada hora van seguidos desde la izquierda, sin huecos.
    unidades.push(...[...porCategoria].sort((a, b) => a[1].primera - b[1].primera).map(([categoria, u]) => ({
      categoria, hora: u.hora, primera: u.primera, celdas: [0, 1, 2, 3].map((i) => u.inicios[i] ?? null),
    })));
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

const DIA_CORTO = { Viernes: 'vie', Sabado: 'sáb' };
const horaCorta = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return m ? `${h}:${String(m).padStart(2, '0')}` : `${h}`; };

/** "2 h", "45 min", "1 h 15 min". */
export function formatoDuracion(minutos) {
  const h = Math.floor(minutos / 60), m = minutos % 60;
  return [h > 0 && `${h} h`, m > 0 && `${m} min`].filter(Boolean).join(' ');
}

/**
 * Horario cargado de una pareja ("vie de 18 a 21:30 h y sáb de 10 a 13 h"). Null si no cargó horario.
 * @param {{ cargado: boolean, ventanas: { dia: string, desde: string, hasta: string }[] }} horario
 */
export function describirHorarioPareja(horario) {
  if (!horario?.cargado) return null;
  const partes = horario.ventanas.map((v, i) => {
    const mismoDia = i > 0 && horario.ventanas[i - 1].dia === v.dia;
    return `${mismoDia ? '' : `${DIA_CORTO[v.dia] || v.dia} `}de ${horaCorta(v.desde)} a ${horaCorta(v.hasta)} h`;
  });
  return partes.length > 1 ? `${partes.slice(0, -1).join(', ')} y ${partes.at(-1)}` : partes[0];
}

/** Lo que hay que pedirle a una pareja para un horario: "2 h antes", "45 min después", "el sáb, que no tenía cargado". */
export function describirAmpliacion(ampliacion, dia) {
  if (ampliacion.diaNuevo) return `el ${DIA_CORTO[dia] || dia}, que no tenía cargado`;
  const partes = [ampliacion.minutosAntes > 0 && `${formatoDuracion(ampliacion.minutosAntes)} antes`,
    ampliacion.minutosDespues > 0 && `${formatoDuracion(ampliacion.minutosDespues)} después`].filter(Boolean);
  return partes.join(' y ') || 'sumar este horario';
}

/** Detalle por pareja de un horario que pide ampliar: [{ parejaId, nombre, texto }]. Vacío si entra sin pedir nada. */
export function detallePorPareja(opcion, nombres = new Map()) {
  const dia = opcion.slotId.split('-')[0];
  const lista = opcion.ampliacionPorPareja || opcion.parejasAAmpliar.map((parejaId) => ({ parejaId }));
  return lista.map((a) => ({ parejaId: a.parejaId, nombre: nombres.get(a.parejaId) || 'La pareja',
    texto: 'diaNuevo' in a ? describirAmpliacion(a, dia) : 'sumar este horario' }));
}

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
