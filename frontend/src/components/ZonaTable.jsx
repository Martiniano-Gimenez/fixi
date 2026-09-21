import { useState, useRef, useEffect } from 'react';

export default function ZonaTable({ zona }) {
  const { zonaParejas } = zona;
  const tableContainerRef = useRef(null);
  const [hasOverflow, setHasOverflow] = useState(false);

  useEffect(() => {
    const el = tableContainerRef.current;
    if (!el) return;

    const checkOverflow = () => {
      const canScrollRight = el.scrollWidth > el.clientWidth && (el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
      setHasOverflow(canScrollRight);
    };

    checkOverflow();

    const resizeObserver = new ResizeObserver(checkOverflow);
    resizeObserver.observe(el);
    el.addEventListener('scroll', checkOverflow);

    return () => {
      resizeObserver.disconnect();
      el.removeEventListener('scroll', checkOverflow);
    };
  }, [zonaParejas]);

  return (
    <div className="torneo-card" style={{ marginBottom: '1.5rem' }}>
      <div className="flex-header" style={{ marginBottom: '1rem' }}>
        <h3>{zona.nombre}</h3>
        <span className="badge badge-en_curso">
          Clasifican {zona.clasifican}
        </span>
      </div>

      <div className={`table-responsive-wrapper ${hasOverflow ? 'has-overflow' : ''}`}>
        <div className="table-responsive" ref={tableContainerRef}>
          <table className="zona-table">
            <thead>
              <tr>
                <th title="Posición">
                  <span className="sr-only">Pos</span>
                  <span aria-hidden="true" className="th-short">#</span>
                </th>
                <th>Pareja</th>
                <th className="text-center" title="Puntos">
                  <span className="sr-only">Pts</span>
                  <span aria-hidden="true" className="th-short">P</span>
                </th>
                <th className="text-center hide-on-mobile" title="Partidos Jugados">PJ</th>
                <th className="text-center" title="Partidos Ganados">
                  <span className="sr-only">PG</span>
                  <span aria-hidden="true" className="th-short">G</span>
                </th>
                <th className="text-center hide-on-mobile" title="Partidos Perdidos">PP</th>
                <th className="text-center" title="Sets a Favor / En Contra">
                  <span className="sr-only">Sets</span>
                  <span aria-hidden="true" className="th-short">S</span>
                </th>
                <th className="text-center" title="Games a Favor / En Contra">
                  <span className="sr-only">Games</span>
                  <span aria-hidden="true" className="th-short">Gm</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {zonaParejas.map((zp, index) => {
                const clasifica = index < zona.clasifican;
                return (
                  <tr 
                    key={zp.id} 
                    style={{ 
                      backgroundColor: clasifica ? 'var(--color-primary-light)' : 'transparent',
                      borderLeft: clasifica ? '4px solid var(--color-primary)' : '4px solid transparent',
                    }}
                  >
                    <td><span className="pos-number">{index + 1}</span></td>
                    <td className="team-name">
                      {zp.pareja.jugador1} / {zp.pareja.jugador2}
                    </td>
                    <td className="text-center stat-pts">{zp.puntos}</td>
                    <td className="text-center hide-on-mobile">{zp.pj}</td>
                    <td className="text-center stat-highlight">{zp.pg}</td>
                    <td className="text-center hide-on-mobile">{zp.pp}</td>
                    <td className="text-center">{zp.sf} - {zp.sc}</td>
                    <td className="text-center">{zp.gf} - {zp.gc}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
