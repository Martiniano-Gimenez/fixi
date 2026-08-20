import { useState } from 'react';
import { api } from '../api/client';
import { Calendar, CheckCircle2, AlertTriangle, Clock } from 'lucide-react';

/**
 * Modal para iniciar el torneo por disponibilidad horaria.
 * Flujo: confirmación → resultado (zonas armadas + manuales) → opción de asignar horarios.
 */
export default function InicioDisponibilidadModal({ torneoId, parejas, onClose, onSuccess }) {
  const [fase, setFase] = useState('confirmar'); // 'confirmar' | 'resultado' | 'asignando'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resultado, setResultado] = useState(null);
  const [resultadoHorarios, setResultadoHorarios] = useState(null);

  const conDisponibilidad = parejas.filter((p) => (p._cantSlots || 0) > 0).length;
  const sinDisponibilidad = parejas.length - conDisponibilidad;

  const handleIniciar = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.post(`/torneos/${torneoId}/iniciar-disponibilidad`);
      setResultado(res);
      setFase('resultado');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAsignarHorarios = async () => {
    setFase('asignando');
    setLoading(true);
    setError('');
    try {
      const res = await api.post(`/torneos/${torneoId}/asignar-horarios`);
      setResultadoHorarios(res);
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
      <div className="modal-content" style={{ maxWidth: '520px' }}>

        {/* ── Fase 1: Confirmación ── */}
        {fase === 'confirmar' && (
          <>
            <h2 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Calendar size={20} strokeWidth={2} />
              Iniciar por disponibilidad horaria
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
              <div className="info-row">
                <span>Parejas con horarios cargados</span>
                <strong style={{ color: 'var(--color-success)' }}>{conDisponibilidad}</strong>
              </div>
              <div className="info-row">
                <span>Parejas sin horarios definidos</span>
                <strong style={{ color: sinDisponibilidad > 0 ? 'var(--color-warning)' : 'var(--color-text-secondary)' }}>
                  {sinDisponibilidad}
                </strong>
              </div>
            </div>

            {sinDisponibilidad > 0 && (
              <div className="alert-warning" style={{ marginBottom: '1.25rem', display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                <AlertTriangle size={16} strokeWidth={2} style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  Las {sinDisponibilidad} pareja{sinDisponibilidad > 1 ? 's' : ''} sin horarios cargados no
                  podrán compatibilizarse automáticamente y quedarán en una zona de armado manual.
                </div>
              </div>
            )}

            {error && <div className="error-message" style={{ marginBottom: '1rem' }}>{error}</div>}

            <div style={{ display: 'flex', gap: '0.75rem', flexDirection: 'column' }}>
              <button className="btn-primary" onClick={handleIniciar} disabled={loading}>
                {loading ? 'Generando zonas...' : 'Confirmar inicio'}
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
        )}

        {/* ── Fase 2: Resultado del inicio ── */}
        {fase === 'resultado' && resultado && (
          <>
            <h2 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <CheckCircle2 size={20} strokeWidth={2} style={{ color: 'var(--color-success)' }} />
              Torneo iniciado
            </h2>

            {resultado.zonasCreadas.length > 0 && (
              <div style={{ marginBottom: '1.25rem' }}>
                <h3 style={{ marginBottom: '0.5rem', fontSize: 'var(--font-size-base)' }}>
                  Zonas armadas automáticamente ({resultado.zonasCreadas.length})
                </h3>
                <ul style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {resultado.zonasCreadas.map((z) => (
                    <li key={z.nombre} className="zona-resumen-item zona-auto">
                      <span className="zona-nombre">✓ {z.nombre}</span>
                      <span className="zona-parejas">
                        {z.parejas.map((p) => `${p.jugador1}/${p.jugador2}`).join(' · ')}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {resultado.zonasManual.length > 0 && (
              <div style={{ marginBottom: '1.25rem' }}>
                <h3 style={{ marginBottom: '0.5rem', fontSize: 'var(--font-size-base)', color: 'var(--color-warning)' }}>
                  Zonas que requieren armado manual ({resultado.zonasManual.length})
                </h3>
                <ul style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {resultado.zonasManual.map((z) => (
                    <li key={z.nombre} className="zona-resumen-item zona-manual">
                      <span className="zona-nombre">{z.nombre}</span>
                      <span className="zona-parejas" style={{ color: 'var(--color-warning)' }}>
                        Sin asignar: {z.parejas.map((p) => `${p.jugador1}/${p.jugador2}`).join(' · ')}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {error && <div className="error-message" style={{ marginBottom: '1rem' }}>{error}</div>}

            <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '1rem', marginTop: '0.5rem' }}>
              <p style={{ marginBottom: '0.75rem', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
                ¿Querés asignar los horarios de partidos automáticamente ahora?
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <button
                  className="btn-primary"
                  onClick={handleAsignarHorarios}
                  disabled={loading}
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
                >
                  <Clock size={16} strokeWidth={2} />
                  {loading ? 'Asignando horarios...' : 'Sí, asignar horarios ahora'}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleFinalizar}
                >
                  No por ahora, ir al torneo
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── Fase 3: Resultado asignación de horarios ── */}
        {fase === 'asignando' && (
          <>
            <h2 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Clock size={20} strokeWidth={2} />
              Asignación de horarios
            </h2>

            {loading && (
              <p style={{ color: 'var(--color-text-secondary)' }}>Asignando horarios y canchas...</p>
            )}

            {resultadoHorarios && !loading && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
                <div className="info-row">
                  <span>Partidos con horario y cancha</span>
                  <strong style={{ color: 'var(--color-success)' }}>{resultadoHorarios.asignados}</strong>
                </div>
                <div className="info-row">
                  <span>Partidos sin horario (ajuste manual)</span>
                  <strong style={{ color: resultadoHorarios.sinHorario > 0 ? 'var(--color-warning)' : 'var(--color-text-secondary)' }}>
                    {resultadoHorarios.sinHorario}
                  </strong>
                </div>
                {resultadoHorarios.sinHorario > 0 && (
                  <div className="alert-warning" style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                    <AlertTriangle size={16} strokeWidth={2} style={{ flexShrink: 0, marginTop: '2px' }} />
                    <div>
                      {resultadoHorarios.sinHorario} partido{resultadoHorarios.sinHorario > 1 ? 's' : ''} quedaron
                      sin horario asignado por incompatibilidad o canchas completas. Podés asignarles horario manualmente.
                    </div>
                  </div>
                )}
                {resultadoHorarios.sinHorario === 0 && (
                  <div className="alert-success" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <CheckCircle2 size={16} strokeWidth={2} />
                    Todos los partidos tienen horario y cancha asignados.
                  </div>
                )}
              </div>
            )}

            {error && <div className="error-message" style={{ marginBottom: '1rem' }}>{error}</div>}

            {!loading && (
              <button className="btn-primary" onClick={handleFinalizar} style={{ width: '100%' }}>
                Ir al torneo
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
