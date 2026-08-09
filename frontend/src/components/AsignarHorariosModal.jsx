import { useState } from 'react';
import { api } from '../api/client';

/**
 * Modal standalone para asignar horarios automáticamente (post-inicio del torneo).
 * Permite ajustar canchas y duración antes de ejecutar.
 */
export default function AsignarHorariosModal({ torneoId, cantidadCanchas, duracionPartidoMin, onClose, onSuccess }) {
  const [canchas, setCanchas] = useState(cantidadCanchas ?? 1);
  const [duracion, setDuracion] = useState(duracionPartidoMin ?? 75);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resultado, setResultado] = useState(null);

  const handleGuardarConfig = async () => {
    // Actualizar config del torneo antes de asignar
    await api.patch(`/torneos/${torneoId}`, {
      cantidadCanchas: Number(canchas),
      duracionPartidoMin: Number(duracion),
    });
  };

  const handleAsignar = async () => {
    setLoading(true);
    setError('');
    try {
      await handleGuardarConfig();
      const res = await api.post(`/torneos/${torneoId}/asignar-horarios`);
      setResultado(res);
    } catch (e) {
      setError(e.message);
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
      <div className="modal-content" style={{ maxWidth: '460px' }}>
        <h2 style={{ marginBottom: '1.25rem' }}>⏰ Asignar horarios automáticamente</h2>

        {!resultado ? (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label htmlFor="modal-canchas">Cantidad de canchas</label>
                <input
                  id="modal-canchas"
                  type="number"
                  min="1"
                  max="20"
                  value={canchas}
                  onChange={(e) => setCanchas(e.target.value)}
                />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label htmlFor="modal-duracion">Duración por partido (minutos)</label>
                <input
                  id="modal-duracion"
                  type="number"
                  min="30"
                  max="180"
                  step="5"
                  value={duracion}
                  onChange={(e) => setDuracion(e.target.value)}
                />
              </div>
            </div>

            <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', marginBottom: '1.25rem' }}>
              El sistema asignará un slot de cancha + horario a cada partido, respetando la
              disponibilidad de ambas parejas y evitando superposiciones.
            </p>

            {error && <div className="error-message" style={{ marginBottom: '1rem' }}>{error}</div>}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <button className="btn-primary" onClick={handleAsignar} disabled={loading}>
                {loading ? 'Asignando...' : 'Asignar horarios'}
              </button>
              <button
                onClick={onClose}
                style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}
              >
                Cancelar
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
              <div className="info-row">
                <span>Partidos con horario asignado</span>
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
                    horario por falta de disponibilidad compatible o canchas suficientes.
                    Podés asignarlos manualmente.
                  </div>
                </>
              )}
              {resultado.sinHorario === 0 && (
                <div className="alert-success">
                  ✅ Todos los partidos tienen horario asignado.
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
