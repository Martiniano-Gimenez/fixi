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
    <div className="cd-zone-card">
      <h3 className="cd-zone-title">{zona.nombre}</h3>

      <div className={`cd-table-wrap ${hasOverflow ? 'has-overflow' : ''}`}>
        <div className="cd-table-viewport" ref={tableContainerRef}>
          <table className="cd-zone-table">
            <thead>
              <tr>
                <th className="cd-col-pos" title="Posición">
                  <span className="cd-sr">Pos</span>
                  <span aria-hidden="true" className="cd-th-short">#</span>
                </th>
                <th className="cd-col-pareja">Pareja</th>
                <th className="cd-col-pts cd-numeric" title="Puntos">
                  <span className="cd-sr">Pts</span>
                  <span aria-hidden="true" className="cd-th-short">P</span>
                </th>
                <th className="cd-col-pj cd-numeric cd-desktop-stat" title="Partidos Jugados">PJ</th>
                <th className="cd-col-pg cd-numeric" title="Partidos Ganados">
                  <span className="cd-sr">PG</span>
                  <span aria-hidden="true" className="cd-th-short">G</span>
                </th>
                <th className="cd-col-pp cd-numeric cd-desktop-stat" title="Partidos Perdidos">PP</th>
                <th className="cd-col-sets cd-numeric" title="Sets a Favor / En Contra">
                  <span className="cd-sr">Sets</span>
                  <span aria-hidden="true" className="cd-th-short">S</span>
                </th>
                <th className="cd-col-games cd-numeric" title="Games a Favor / En Contra">
                  <span className="cd-sr">Games</span>
                  <span aria-hidden="true" className="cd-th-short">Gm</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {zonaParejas.map((zp, index) => {
                const clasifica = index < zona.clasifican;
                return (
                  <tr
                    key={zp.id}
                    className={clasifica ? 'cd-qualifies' : ''}
                  >
                    <td className="cd-col-pos"><span className="cd-position">{index + 1}</span></td>
                    <td
                      className="cd-col-pareja cd-team-name"
                      title={`${zp.pareja.jugador1} / ${zp.pareja.jugador2}`}
                    >
                      {zp.pareja.jugador1} / {zp.pareja.jugador2}
                    </td>
                    <td className="cd-col-pts cd-numeric cd-points" data-label="Puntos">{zp.puntos}</td>
                    <td className="cd-col-pj cd-numeric cd-desktop-stat" data-label="Jugados">{zp.pj}</td>
                    <td className="cd-col-pg cd-numeric cd-highlight" data-label="Ganados">{zp.pg}</td>
                    <td className="cd-col-pp cd-numeric cd-desktop-stat" data-label="Perdidos">{zp.pp}</td>
                    <td className="cd-col-sets cd-numeric" data-label="Sets"><span className="cd-stat-pair">{zp.sf}<span>–</span>{zp.sc}</span></td>
                    <td className="cd-col-games cd-numeric" data-label="Games"><span className="cd-stat-pair">{zp.gf}<span>–</span>{zp.gc}</span></td>
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
