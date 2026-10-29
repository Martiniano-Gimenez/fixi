import { useEffect, useRef, useState } from 'react';

const DURACION_MS = 3000;

function marcador(p, ganaPareja1) {
  return (p.sets || [])
    .map((s) => (ganaPareja1 ? `${s.gamesPareja1}-${s.gamesPareja2}` : `${s.gamesPareja2}-${s.gamesPareja1}`))
    .join(' ');
}

function partidosDe(categoria) {
  return [
    ...(categoria.zonas || []).flatMap((z) => z.partidos || []),
    ...(categoria.eliminatoria || []).flatMap((f) => (f.partidos || []).filter((p) => !p.esBye)),
  ];
}

/**
 * Aviso de resultados nuevos que llegan con la actualización periódica.
 * - Nunca en la primera carga.
 * - Si se sigue a una pareja: solo sus partidos.
 * - Si no: solo la categoría visible, y varios juntos en un único aviso.
 */
export default function useAvisoResultados(data, categoriaActiva, seguidaId) {
  const [aviso, setAviso] = useState(null);
  const terminadosPrevios = useRef(null);
  const timer = useRef(null);

  useEffect(() => {
    if (!data?.categorias) return;
    const ahora = new Set();
    data.categorias.forEach((c) => partidosDe(c).forEach((p) => p.estado === 'FINALIZADO' && ahora.add(p.id)));
    const previos = terminadosPrevios.current;
    terminadosPrevios.current = ahora;
    if (!previos || !categoriaActiva) return; // primera carga

    const nuevos = partidosDe(categoriaActiva).filter((p) => ahora.has(p.id) && !previos.has(p.id));
    const relevantes = seguidaId ? nuevos.filter((p) => p.pareja1Id === seguidaId || p.pareja2Id === seguidaId) : nuevos;
    if (!relevantes.length) return;

    let siguiente;
    if (relevantes.length === 1) {
      const p = relevantes[0];
      const ganaP1 = p.ganadorId != null ? p.ganadorId === p.pareja1Id : p.ganador === p.pareja1;
      const ganador = (ganaP1 ? p.pareja1 : p.pareja2) || p.ganador;
      siguiente = { titulo: 'Resultado cargado', texto: ganador ? `${ganador} ganó ${marcador(p, ganaP1)}`.trim() : `Terminó un partido de ${categoriaActiva.nombre}` };
    } else {
      siguiente = { titulo: `${relevantes.length} resultados nuevos en ${categoriaActiva.nombre}`, texto: 'Las tablas y los cruces ya están actualizados.' };
    }
    setAviso({ ...siguiente, id: Date.now() });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setAviso(null), DURACION_MS);
  }, [data, categoriaActiva, seguidaId]);

  useEffect(() => () => clearTimeout(timer.current), []);
  return aviso;
}
