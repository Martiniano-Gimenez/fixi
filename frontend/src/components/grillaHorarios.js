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

/** Un horario que pide a dos o más parejas: con otros mejores, queda plegado bajo "Ver más horarios". */
export const esSecundario = (opcion) => opcion.estado !== 'ENTRA' && opcion.estado !== 'PEDIR_1';

/**
 * Filas visibles de un día, una por hora. Saca los horarios no disponibles (y los secundarios si van plegados),
 * junta los que quedan desde la izquierda y omite las horas vacías. `salto` marca la fila que viene después de
 * una hora salteada (la trasnoche sigue a las 23).
 * @returns {{ hora: string, celdas: (object|null)[], salto: boolean }[]}
 */
export function filasVisibles(filas, { conSecundarios = true } = {}) {
  const visibles = [];
  for (const fila of filas) {
    const inicios = fila.celdas.filter((o) => o && o.estado !== 'NO_DISPONIBLE' && (conSecundarios || !esSecundario(o)));
    if (!inicios.length) continue;
    const anterior = visibles.at(-1);
    visibles.push({ hora: fila.hora, celdas: [0, 1, 2, 3].map((i) => inicios[i] ?? null),
      salto: Boolean(anterior) && (Number(anterior.hora) + 1) % 24 !== Number(fila.hora) });
  }
  return visibles;
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
