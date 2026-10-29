import { useEffect, useRef, useState } from 'react';
import { horaPartido, ladoDe } from './utilidades';

export function Estrella({ contorno = false, decorativa = false, className = '' }) {
  return (
    <svg
      className={`pv-estrella ${contorno ? 'contorno' : ''} ${className}`}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      {...(decorativa ? { 'aria-hidden': true } : { role: 'img', 'aria-label': 'Pareja que seguís' })}
    >
      <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z" />
    </svg>
  );
}

// Número que "salta" (escala 1 → 1,4 → 1) cuando cambia entre actualizaciones
export function Numero({ valor }) {
  const previo = useRef(valor);
  const [cambios, setCambios] = useState(0);
  useEffect(() => {
    if (previo.current !== valor) {
      previo.current = valor;
      setCambios((n) => n + 1);
    }
  }, [valor]);
  // La key nueva vuelve a montar el span y la animación corre una sola vez
  return <span key={cambios} className={cambios ? 'pv-salta' : undefined}>{valor}</span>;
}

function ganadorDe(p, lado) {
  if (p.estado !== 'FINALIZADO') return false;
  const id = lado === 1 ? p.pareja1Id : p.pareja2Id;
  const nombre = lado === 1 ? p.pareja1 : p.pareja2;
  return p.ganadorId != null && id != null ? p.ganadorId === id : Boolean(p.ganador && nombre && p.ganador === nombre);
}

/**
 * Tarjeta de partido. La pareja 1 va siempre arriba; los sets se alinean en 3 columnas fijas.
 * El resultado se lee primero: ganador en marino y peso fuerte, perdedor en gris;
 * en un partido en juego, el set que se está jugando va en un recuadro azul.
 */
export default function TarjetaPartido({ partido: p, etiqueta, conDia = true, seguidaId, clase = '', atrasado = false, origenes = null }) {
  const vivo = p.estado === 'EN_CURSO';
  const terminado = p.estado === 'FINALIZADO';
  const sets = Array.isArray(p.sets) ? p.sets : [];
  const hora = horaPartido(p.fechaHora, conDia);
  const l1 = ladoDe(p, 1, origenes);
  const l2 = ladoDe(p, 2, origenes);
  const esSeguida = Boolean(seguidaId && (l1.parejaId === seguidaId || l2.parejaId === seguidaId));

  const fila = (lado) => {
    const { nombre, definida, origen, parejaId } = lado === 1 ? l1 : l2;
    const gano = ganadorDe(p, lado);
    const clase = terminado ? (gano ? 'gano' : 'perdio') : '';
    const siguiendo = seguidaId && parejaId === seguidaId;
    return (
      <div className={`pv-p-fila ${clase}`}>
        <span className={`pv-p-nombre ${definida ? '' : 'a-definir'}`} translate="no">
          {nombre}
          {siguiendo && <Estrella />}
          {origen && <small className="pv-p-origen">{origen}</small>}
        </span>
        {[0, 1, 2].map((i) => {
          const s = sets[i];
          if (!s) return <span key={i} className="pv-set" aria-hidden="true" />;
          const mio = lado === 1 ? s.gamesPareja1 : s.gamesPareja2;
          const otro = lado === 1 ? s.gamesPareja2 : s.gamesPareja1;
          // En un partido en juego, el último set cargado es el que se está jugando
          const actual = vivo && i === sets.length - 1;
          return (
            <span key={i} className={`pv-set ${actual ? 'actual' : mio > otro ? 'gano' : ''}`}>
              <Numero valor={mio} />
            </span>
          );
        })}
      </div>
    );
  };

  const resumen =
    terminado && sets.length
      ? `Ganó ${ganadorDe(p, 1) ? l1.nombre : l2.nombre}: ${sets.map((s) => `${s.gamesPareja1} a ${s.gamesPareja2}`).join(', ')}.`
      : null;

  return (
    <article className={`pv-partido ${vivo ? 'vivo' : ''} ${esSeguida ? 'seguida' : ''} ${clase}`}>
      <div className="pv-p-meta">
        <span className="pv-p-hora num">{hora || 'Horario a definir'}</span>
        {etiqueta ? <span>{etiqueta}</span> : null}
        {vivo && (
          <span className="pv-p-estado en-juego">
            <span className="pv-punto-vivo" aria-hidden="true" />
            En juego
          </span>
        )}
        {terminado && <span className="pv-p-estado">Terminado</span>}
        {atrasado && <span className="pv-p-estado atrasado">Sin resultado cargado</span>}
      </div>
      <div className="pv-p-filas">
        {fila(1)}
        {fila(2)}
        {resumen && <span className="pv-sr">{resumen}</span>}
      </div>
    </article>
  );
}
