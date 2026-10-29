import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, Search } from 'lucide-react';

// Cancha de pádel vista desde arriba: perímetro, red y líneas de saque
export function Cancha() {
  return (
    <svg className="pv-cancha" viewBox="0 0 200 100" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="1" y="1" width="198" height="98" rx="1" />
      <path d="M100 1v98M30.5 1v98M169.5 1v98M30.5 50h139" />
    </svg>
  );
}

// Logo de Fixi: una F en azul eléctrico
export function Logo() {
  return <span className="pv-logo" aria-hidden="true">F</span>;
}

/**
 * Barra de arriba, fija al hacer scroll. A la izquierda la marca (inicio) o "Inicio" / "Volver"
 * para volver; a la derecha, la lupa opcional que abre la búsqueda.
 */
export default function Barra({ volver = null, onBuscar = null }) {
  const [conBorde, setConBorde] = useState(false);
  useEffect(() => {
    const revisar = () => setConBorde(window.scrollY > 8);
    revisar();
    window.addEventListener('scroll', revisar, { passive: true });
    return () => window.removeEventListener('scroll', revisar);
  }, []);

  return (
    <header className={`pv-barra ${conBorde ? 'con-borde' : ''}`}>
      <div className="pv-envolver pv-barra-fila">
        {volver ? (
          <Link
            className="pv-volver"
            to={volver.to || volver.href || '#'}
            onClick={volver.onClick}
          >
            <ChevronLeft size={22} strokeWidth={2.2} aria-hidden="true" />
            <span>{volver.texto || 'Inicio'}</span>
          </Link>
        ) : (
          <span className="pv-marca" translate="no">
            <Logo />
            Fixi
          </span>
        )}
        <span className="pv-sp" />
        {onBuscar && (
          <button type="button" className="pv-lupa" aria-label="Buscar pareja o jugador" onClick={onBuscar}>
            <Search size={22} strokeWidth={2} aria-hidden="true" />
          </button>
        )}
      </div>
    </header>
  );
}
