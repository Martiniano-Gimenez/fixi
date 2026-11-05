const ETIQUETA_DIA = { Viernes: 'vie', Sabado: 'sáb', Domingo: 'dom' };

/** Inicios por jornada: viernes y sábado siempre; el domingo solo si hay inicios ese día (partidos del cuadro). */
export function agruparInicios(opciones) {
  const conDomingo = opciones.some((o) => o.slotId.startsWith('Domingo-'));
  return ['Viernes', 'Sabado', ...(conDomingo ? ['Domingo'] : [])].map((dia) => {
    const horas = new Map();
    for (const opcion of [...opciones].sort((a, b) => a.fechaHora.localeCompare(b.fechaHora))) {
      const [jornada, hora] = opcion.slotId.split('-');
      if (jornada !== dia) continue;
      const [hh, mm] = hora.split(':');
      if (!horas.has(hh)) horas.set(hh, { hora: hh, celdas: [null, null, null, null] });
      horas.get(hh).celdas[Number(mm) / 15] = opcion;
    }
    return { dia, etiqueta: ETIQUETA_DIA[dia], filas: [...horas.values()] };
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
 * Filas visibles de un día: los horarios disponibles (sin los secundarios si van plegados), en orden y seguidos,
 * de a 4 por fila, sin agrupar por hora. `hora` es el primer horario de la fila y sirve de clave.
 * @returns {{ hora: string, celdas: (object|null)[] }[]}
 */
export function filasVisibles(filas, { conSecundarios = true } = {}) {
  const inicios = filas.flatMap((f) => f.celdas)
    .filter((o) => o && o.estado !== 'NO_DISPONIBLE' && (conSecundarios || !esSecundario(o)));
  const visibles = [];
  for (let i = 0; i < inicios.length; i += 4) {
    visibles.push({ hora: inicios[i].slotId.split('-')[1], celdas: [0, 1, 2, 3].map((j) => inicios[i + j] ?? null) });
  }
  return visibles;
}

const DIA_CORTO = { Viernes: 'vie', Sabado: 'sáb', Domingo: 'dom' };
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
