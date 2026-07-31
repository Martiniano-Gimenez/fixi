import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import ResultadoModal from '../../components/ResultadoModal';
import DateTimeInput from '../../components/DateTimeInput';
import './EliminatoriaView.css';

export default function EliminatoriaView() {
  const { id: torneoId } = useParams();
  const navigate = useNavigate();
  const [torneo, setTorneo] = useState(null);
  const [fases, setFases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState(null);
  const [partidoModal, setPartidoModal] = useState(null);

  useEffect(() => {
    cargarDatos();
  }, [torneoId]);

  async function cargarDatos() {
    try {
      setLoading(true);
      const [torneoRes, fasesRes] = await Promise.all([
        api.get(`/torneos/${torneoId}`),
        api.get(`/torneos/${torneoId}/fases-eliminatorias`),
      ]);
      setTorneo(torneoRes);
      setFases(fasesRes || []);
    } catch (err) {
      setError(err.message || 'Error al cargar la eliminatoria');
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerarEliminatoria() {
    if (!window.confirm('¿Seguro que querés generar la fase eliminatoria?')) {
      return;
    }

    try {
      setGenerando(true);
      await api.post(`/torneos/${torneoId}/generar-eliminatoria`);
      await cargarDatos();
    } catch (err) {
      setError(err.message || 'Error al generar eliminatoria');
    } finally {
      setGenerando(false);
    }
  }

  async function handleBorrarEliminatoria() {
    if (!window.confirm('¿Estás seguro de que querés borrar toda la fase eliminatoria? Esto desbloqueará la edición de las zonas y se perderán todos los resultados cargados en los brackets.')) {
      return;
    }

    try {
      setGenerando(true);
      await api.delete(`/torneos/${torneoId}/fases-eliminatorias`);
      await cargarDatos();
    } catch (err) {
      setError(err.message || 'Error al borrar eliminatoria');
    } finally {
      setGenerando(false);
    }
  }

  async function handleUpdateFechaHora(partidoId, newTimeStr) {
    try {
      if (!newTimeStr) {
        await api.put(`/partidos/${partidoId}/fecha-hora`, { fechaHora: null });
      } else {
        await api.put(`/partidos/${partidoId}/fecha-hora`, { fechaHora: new Date(newTimeStr).toISOString() });
      }
      await cargarDatos();
    } catch (err) {
      alert(err.message || 'Error al actualizar horario');
    }
  }

  function handleClickPartido(partido) {
    // Solo abrir modal si tiene ambas parejas definidas
    if (partido.pareja1Id && partido.pareja2Id) {
      setPartidoModal(partido);
    }
  }

  if (loading) {
    return <div className="loading">Cargando...</div>;
  }

  if (!torneo) {
    return <div className="error">Torneo no encontrado</div>;
  }

  return (
    <div className="eliminatoria-container">
      <div className="header">
        <button onClick={() => navigate(`/admin/torneos/${torneoId}`)} className="back-btn">
          ← Volver
        </button>
        <h1>{torneo.nombre} — Fase Eliminatoria</h1>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          {fases.length > 0 && (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button 
                onClick={handleGenerarEliminatoria} 
                disabled={generando} 
                style={{
                  width: 'auto',
                  marginTop: 0,
                  padding: '0.5rem 1rem',
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: 'bold',
                  background: 'var(--color-bg-input)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--color-text-secondary)',
                  transition: 'all 0.2s ease',
                  cursor: 'pointer'
                }}
                onMouseEnter={(e) => e.target.style.color = 'var(--color-text)'}
                onMouseLeave={(e) => e.target.style.color = 'var(--color-text-secondary)'}
              >
                {generando ? 'Cargando...' : '🔄 Re-sortear'}
              </button>
              <button 
                onClick={handleBorrarEliminatoria} 
                disabled={generando} 
                style={{
                  width: 'auto',
                  marginTop: 0,
                  padding: '0.5rem 1rem',
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: 'bold',
                  background: 'var(--color-bg-input)',
                  border: '1px solid var(--color-danger)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--color-danger)',
                  transition: 'all 0.2s ease',
                  cursor: 'pointer'
                }}
                onMouseEnter={(e) => {
                  e.target.style.background = 'rgba(239, 68, 68, 0.1)';
                }}
                onMouseLeave={(e) => {
                  e.target.style.background = 'var(--color-bg-input)';
                }}
              >
                🗑️ Borrar Bracket
              </button>
            </div>
          )}
          <div className="status">{torneo.estado}</div>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}

      {fases.length === 0 ? (
        <div className="no-eliminatoria">
          <p>La fase eliminatoria aún no ha sido generada.</p>
          <button onClick={handleGenerarEliminatoria} disabled={generando} className="btn-primary">
            {generando ? 'Generando...' : '🚀 Generar Eliminatoria'}
          </button>
        </div>
      ) : (
        <div className="bracket-container">
          <div className="bracket-scroll">
            {fases.map((fase) => (
              <div key={fase.id} className="ronda-section bracket-section">
                <h3 className="ronda-title">{fase.nombre}</h3>
                <div className="ronda-matches bracket-matches-column">
                  {fase.partidos.map((partido) => {
                    const isFinalizado = partido.estado === 'FINALIZADO';
                    const isJugable = !!(partido.pareja1Id && partido.pareja2Id);
                    const p1esGanador = isFinalizado && partido.ganadorId === partido.pareja1Id;
                    const p2esGanador = isFinalizado && partido.ganadorId === partido.pareja2Id;

                    return (
                      <div key={partido.id} className="bracket-match-wrapper" style={{ padding: '8px 0' }}>
                        <div className="match-card-wrapper" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <div className="match-time-editor">
                          <DateTimeInput
                            value={partido.fechaHora ? new Date(new Date(partido.fechaHora).getTime() - (new Date().getTimezoneOffset() * 60000)).toISOString().slice(0, 16) : ''}
                            onUpdate={(val) => handleUpdateFechaHora(partido.id, val)}
                            title="Establecer horario"
                            style={{
                              padding: '2px',
                              borderRadius: '4px',
                              border: '1px solid var(--color-border)',
                              background: 'var(--color-bg-input)',
                              color: 'var(--color-text)',
                              fontSize: '0.65rem',
                              width: '110px',
                              cursor: 'pointer'
                            }}
                          />
                        </div>
                        <div
                          className={`match-card ${isFinalizado ? 'finalizado' : ''} ${isJugable && !isFinalizado ? 'jugable' : ''}`}
                          onClick={() => handleClickPartido(partido)}
                          title={isJugable ? (isFinalizado ? 'Click para editar resultado' : 'Click para cargar resultado') : 'Esperando clasificados'}
                        >
                          {/* Encabezado con estado */}
                          <div className="match-card-header">
                            <span className={`match-status-badge ${isFinalizado ? 'finalizado' : isJugable ? 'pendiente' : 'esperando'}`}>
                              {isFinalizado ? 'Finalizado' : isJugable ? 'Pendiente' : 'Esperando...'}
                            </span>
                            {isJugable && (
                              <span className="match-action-hint">
                                {isFinalizado ? '✏️' : '➕'}
                              </span>
                            )}
                          </div>

                        {/* Pareja 1 */}
                        <div className={`match-pareja p1 ${p1esGanador ? 'ganador' : ''}`}>
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            {partido.origenPareja1 && (
                              <span style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px', fontWeight: 'bold' }}>
                                {partido.origenPareja1}
                              </span>
                            )}
                            <span className="pareja-name">
                              {partido.pareja1
                                ? `${partido.pareja1.jugador1} / ${partido.pareja1.jugador2}`
                                : <span className="por-definirse">Por definirse</span>}
                            </span>
                          </div>
                          {p1esGanador && <span className="winner-indicator">🏆</span>}
                        </div>

                        {/* Sets o VS */}
                        {isFinalizado && partido.sets && partido.sets.length > 0 ? (
                          <div className="match-sets">
                            {partido.sets.map((s, idx) => (
                              <span key={idx} className="set-score">
                                {s.gamesPareja1}-{s.gamesPareja2}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <div className="match-vs">vs</div>
                        )}

                        {/* Pareja 2 */}
                        <div className={`match-pareja p2 ${p2esGanador ? 'ganador' : ''}`}>
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            {partido.origenPareja2 && (
                              <span style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px', fontWeight: 'bold' }}>
                                {partido.origenPareja2}
                              </span>
                            )}
                            <span className="pareja-name">
                              {partido.pareja2
                                ? `${partido.pareja2.jugador1} / ${partido.pareja2.jugador2}`
                                : <span className="por-definirse">Por definirse</span>}
                            </span>
                          </div>
                            {p2esGanador && <span className="winner-indicator">🏆</span>}
                          </div>
                        </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal para cargar resultado */}
      {partidoModal && (
        <ResultadoModal
          partido={partidoModal}
          onClose={() => setPartidoModal(null)}
          onSaved={() => {
            setPartidoModal(null);
            cargarDatos();
          }}
        />
      )}
    </div>
  );
}
