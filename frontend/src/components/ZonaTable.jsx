import { useState } from 'react';

export default function ZonaTable({ zona }) {
  const { zonaParejas } = zona;

  return (
    <div className="torneo-card" style={{ marginBottom: '1.5rem' }}>
      <div className="flex-header" style={{ marginBottom: '1rem' }}>
        <h3>{zona.nombre}</h3>
        <span className="badge badge-en_curso">
          Clasifican {zona.clasifican}
        </span>
      </div>

      <div className="table-responsive">
        <table>
          <thead>
            <tr>
              <th>Pos</th>
              <th>Pareja</th>
              <th className="text-center" title="Puntos">Pts</th>
              <th className="text-center hide-on-mobile" title="Partidos Jugados">PJ</th>
              <th className="text-center" title="Partidos Ganados">PG</th>
              <th className="text-center hide-on-mobile" title="Partidos Perdidos">PP</th>
              <th className="text-center" title="Sets a Favor / En Contra">Sets</th>
              <th className="text-center" title="Games a Favor / En Contra">Games</th>
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
  );
}
