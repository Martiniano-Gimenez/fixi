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
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
              <th style={{ textAlign: 'left', padding: '0.5rem' }}>Pareja</th>
              <th title="Puntos" style={{ padding: '0.5rem' }}>Pts</th>
              <th title="Partidos Jugados" className="hide-on-mobile" style={{ padding: '0.5rem' }}>PJ</th>
              <th title="Partidos Ganados" style={{ padding: '0.5rem' }}>PG</th>
              <th title="Partidos Perdidos" className="hide-on-mobile" style={{ padding: '0.5rem' }}>PP</th>
              <th title="Sets a Favor / En Contra" style={{ padding: '0.5rem' }}>Sets</th>
              <th title="Games a Favor / En Contra" style={{ padding: '0.5rem' }}>Games</th>
            </tr>
          </thead>
          <tbody>
            {zonaParejas.map((zp, index) => {
              const clasifica = index < zona.clasifican;
              return (
                <tr 
                  key={zp.id} 
                  style={{ 
                    borderBottom: '1px solid var(--color-border)',
                    backgroundColor: clasifica ? 'rgba(16, 185, 129, 0.05)' : 'transparent',
                    borderLeft: clasifica ? '4px solid var(--color-success)' : '4px solid transparent',
                  }}
                >
                  <td style={{ textAlign: 'left', padding: '0.75rem 0.5rem', fontWeight: 500 }}>
                    {zp.pareja.jugador1} / {zp.pareja.jugador2}
                  </td>
                  <td style={{ padding: '0.75rem 0.5rem', fontWeight: 'bold', color: 'var(--color-primary)' }}>{zp.puntos}</td>
                  <td className="hide-on-mobile" style={{ padding: '0.75rem 0.5rem' }}>{zp.pj}</td>
                  <td style={{ padding: '0.75rem 0.5rem' }}>{zp.pg}</td>
                  <td className="hide-on-mobile" style={{ padding: '0.75rem 0.5rem' }}>{zp.pp}</td>
                  <td style={{ padding: '0.75rem 0.5rem' }}>{zp.sf} - {zp.sc}</td>
                  <td style={{ padding: '0.75rem 0.5rem' }}>{zp.gf} - {zp.gc}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
