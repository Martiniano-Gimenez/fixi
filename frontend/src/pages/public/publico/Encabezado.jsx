import { estadoLabel } from '../../../utils/estadoLabels';
import { formatFechaTorneo } from '../../../utils/dateUtils';

// Cancha de pádel vista desde arriba: perímetro, red y líneas de saque
function Cancha() {
  return (
    <svg className="pv-cancha" viewBox="0 0 200 100" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="1" y="1" width="198" height="98" rx="1" />
      <path d="M100 1v98M30.5 1v98M169.5 1v98M30.5 50h139" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="pv-marca-logo" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0d1512" strokeWidth="2.4" strokeLinecap="round">
        <circle cx="12" cy="12" r="8" />
        <path d="M6.5 6.5c3 2.2 3 8.8 0 11M17.5 6.5c-3 2.2-3 8.8 0 11" />
      </svg>
    </span>
  );
}

export default function Encabezado({ torneo, cifras, enVivo, actualizacion, animar, fechas }) {
  const c = (i) => (animar ? { className: 'pv-cascada', style: { '--i': i } } : {});
  return (
    <header className="pv-cab">
      <div className="pv-envolver pv-cab-envolver">
        <Cancha />
        <div className="pv-cab-contenido">
          <div className={`pv-cab-fila ${animar ? 'pv-cascada' : ''}`} style={animar ? { '--i': 0 } : undefined}>
            <div className="pv-marca" translate="no">
              <Logo />
              Fixi
              <span className="pv-marca-club">{torneo.organizador}</span>
            </div>
            <span className="pv-estado">
              {enVivo && <span className="pv-punto-vivo" aria-hidden="true" />}
              {enVivo ? 'En vivo' : estadoLabel(torneo.estado)}
            </span>
          </div>
          <h1 {...c(1)}>{torneo.nombre}</h1>
          {(fechas || torneo.fecha) && (
            <p className={`pv-cab-fecha ${animar ? 'pv-cascada' : ''}`} style={animar ? { '--i': 1 } : undefined}>
              {fechas || formatFechaTorneo(torneo.fecha)}
            </p>
          )}
          <p className={`pv-cifras ${animar ? 'pv-cascada' : ''}`} style={animar ? { '--i': 2 } : undefined}>
            <span><b className="num">{cifras.parejas}</b> parejas</span>
            {cifras.total > 0 && (
              <span><b className="num">{cifras.jugados}</b> de {cifras.total} partidos jugados</span>
            )}
            {actualizacion}
          </p>
        </div>
      </div>
    </header>
  );
}
