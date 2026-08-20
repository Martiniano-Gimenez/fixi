import { useState } from 'react';
import { api } from '../api/client';

/**
 * Modal standalone para asignar horarios automáticamente (post-inicio del torneo).
 */
export default function AsignarHorariosModal({ torneoId, onClose, onSuccess }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resultado, setResultado] = useState(null);

  const handleAsignar = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.post(`/torneos/${torneoId}/asignar-horarios`);
      setResultado(res);
    } catch (e) {
      setError(e.message || 'Error al asignar horarios.');
    } finally {
      setLoading(false);
    }
  };

  const handleFinalizar = () => {
    onSuccess();
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-content" style={{ maxWidth: '480px' }}>
        <h2 style={{ marginBottom: '1.25rem' }}>⏰ Asignar horarios automáticamente</h2>

        {!resultado ? (
          <>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', marginBottom: '1rem', lineHeight: 1.5 }}>
              El sistema asignará un turno (slot de 75 min) y cancha a cada partido pendiente, respetando
              los horarios seleccionados por ambas parejas y evitando superposiciones.
            </p>

            <div className="alert-warning" style={{ marginBottom: '1.25rem', fontSize: 'var(--font-size-xs)' }}>
              ℹ️ <strong>Canchas compartidas del club:</strong> Las canchas se comparten entre todos los torneos del club.
              Los partidos ya programados en otros torneos del mismo fin de semana actúan como restricción y no serán solapados.
            </div>

            {error && <div className="error-message" style={{ marginBottom: '1rem' }}>{error}</div>}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <button className="btn-primary" onClick={handleAsignar} disabled={loading}>
                {loading ? 'Asignando turnos y canchas...' : 'Asignar horarios'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={onClose}
                disabled={loading}
              >
                Cancelar
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
              <div className="info-row">
                <span>Partidos con horario y cancha asignada</span>
                <strong style={{ color: 'var(--color-success)' }}>{resultado.asignados}</strong>
              </div>
              <div className="info-row">
                <span>Total de partidos procesados</span>
                <strong>{resultado.total}</strong>
              </div>
              {resultado.sinHorario > 0 && (
                <>
                  <div className="info-row">
                    <span>Sin horario (ajuste manual)</span>
                    <strong style={{ color: 'var(--color-warning)' }}>{resultado.sinHorario}</strong>
                  </div>
                  <div className="alert-warning">
                    ⚠️ {resultado.sinHorario} partido{resultado.sinHorario > 1 ? 's' : ''} quedaron sin
                    horario por falta de turnos compatibles o canchas libres disponibles. Podés asignarles horario manualmente.
                  </div>
                </>
              )}
              {resultado.sinHorario === 0 && (
                <div className="alert-success">
                  ✅ Todos los partidos tienen horario y cancha asignados sin colisiones.
                </div>
              )}
            </div>

            <button className="btn-primary" onClick={handleFinalizar} style={{ width: '100%' }}>
              Ver partidos
            </button>
          </>
        )}
      </div>
    </div>
  );
}
