import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { Calendar, CheckCircle2, AlertTriangle, Clock } from 'lucide-react';

/**
 * Modal para iniciar la categoría por disponibilidad horaria.
 */
export default function InicioDisponibilidadModal({ torneoId, categoriaId, parejas = [], onClose, onSuccess }) {
  const [fase, setFase] = useState('confirmar'); // 'confirmar' | 'resultado'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resultado, setResultado] = useState(null);
  const targetId = categoriaId || torneoId;

  const [parejasList, setParejasList] = useState(parejas);

  useEffect(() => {
    if (parejas.length === 0 && targetId) {
      api.get(`/categorias/${targetId}/parejas`).then((res) => {
        setParejasList(res || []);
      }).catch(() => {});
    } else {
      setParejasList(parejas);
    }
  }, [parejas, targetId]);

  const conDisponibilidad = parejasList.filter((p) => (p._cantSlots || p.slotsSeleccionados?.length || 0) > 0).length;
  const sinDisponibilidad = parejasList.length - conDisponibilidad;

  const handleIniciar = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.post(`/categorias/${targetId}/sorteo`, { conDisponibilidad: true });
      setResultado(res);
      setFase('resultado');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFinalizar = () => {
    if (onSuccess) onSuccess();
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-content" style={{ maxWidth: '520px' }}>
        {/* ── Fase 1: Confirmación ── */}
        {fase === 'confirmar' && (
          <>
            <h2 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Calendar size={20} strokeWidth={2} />
              Sortear Zonas por Disponibilidad
            </h2>

            <p style={{ color: 'var(--color-text-secondary)', marginBottom: '1.25rem', fontSize: 'var(--font-size-sm)' }}>
              El sistema agrupará a las parejas en zonas buscando la mayor coincidencia de horarios disponibles.
            </p>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '0.75rem',
                marginBottom: '1.25rem',
              }}
            >
              <div
                style={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '0.75rem',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'bold', color: 'var(--color-primary)' }}>
                  {conDisponibilidad}
                </div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                  Con disponibilidad cargada
                </div>
              </div>

              <div
                style={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '0.75rem',
                  textAlign: 'center',
                }}
              >
                <div
                  style={{
                    fontSize: 'var(--font-size-2xl)',
                    fontWeight: 'bold',
                    color: sinDisponibilidad > 0 ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                  }}
                >
                  {sinDisponibilidad}
                </div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                  Sin disponibilidad cargada
                </div>
              </div>
            </div>

            {sinDisponibilidad > 0 && (
              <div
                style={{
                  display: 'flex',
                  gap: '0.5rem',
                  padding: '0.75rem',
                  background: 'rgba(234, 179, 8, 0.1)',
                  border: '1px solid rgba(234, 179, 8, 0.3)',
                  borderRadius: 'var(--radius-md)',
                  marginBottom: '1.25rem',
                  fontSize: 'var(--font-size-xs)',
                  color: 'var(--color-accent)',
                }}
              >
                <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
                <span>
                  Las parejas sin disponibilidad se agruparán en una zona manual o se distribuirán según cupo disponible.
                </span>
              </div>
            )}

            {error && <div className="error-message" style={{ marginBottom: '1rem' }}>{error}</div>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>
                Cancelar
              </button>
              <button type="button" className="btn-primary" onClick={handleIniciar} disabled={loading}>
                {loading ? 'Generando zonas...' : 'Generar Zonas'}
              </button>
            </div>
          </>
        )}

        {/* ── Fase 2: Resultado ── */}
        {fase === 'resultado' && resultado && (
          <>
            <h2 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--color-primary)' }}>
              <CheckCircle2 size={20} strokeWidth={2} />
              Zonas Generadas
            </h2>

            <div style={{ maxHeight: '300px', overflowY: 'auto', marginBottom: '1.25rem' }}>
              {resultado.zonasCreadas?.map((z, idx) => (
                <div
                  key={idx}
                  style={{
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '0.75rem',
                    marginBottom: '0.5rem',
                  }}
                >
                  <strong>{z.nombre}</strong>
                  <ul style={{ margin: '0.25rem 0 0 1rem', padding: 0, fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                    {z.parejas?.map((p, pIdx) => (
                      <li key={pIdx}>
                        {p.jugador1} / {p.jugador2}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button type="button" className="btn-primary" onClick={handleFinalizar}>
                Aceptar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
