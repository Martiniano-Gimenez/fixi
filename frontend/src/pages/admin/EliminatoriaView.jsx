import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import './EliminatoriaView.css';

export default function EliminatoriaView() {
  const { id: torneoId } = useParams();
  const navigate = useNavigate();
  const [torneo, setTorneo] = useState(null);
  const [fases, setFases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState(null);
  const [selectedMatch, setSelectedMatch] = useState(null);

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
        <div className="status">{torneo.estado}</div>
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
              <div key={fase.id} className="ronda-section">
                <h3 className="ronda-title">{fase.nombre}</h3>
                <div className="ronda-matches">
                  {fase.partidos.map((partido) => (
                    <div
                      key={partido.id}
                      className={`match-card ${selectedMatch?.id === partido.id ? 'selected' : ''}`}
                      onClick={() => setSelectedMatch(partido)}
                    >
                      <div className="match-pareja p1">
                        <span className="pareja-name">
                          {partido.pareja1
                            ? `${partido.pareja1.jugador1} / ${partido.pareja1.jugador2}`
                            : 'Por definirse'}
                        </span>
                        {partido.estado === 'FINALIZADO' && partido.ganadorId === partido.pareja1Id && (
                          <span className="winner-indicator">✓</span>
                        )}
                      </div>
                      {partido.estado === 'FINALIZADO' ? (
                        <div className="match-score">
                          {/* Mostrar sets si existen */}
                          <span>{partido.pareja1Id === partido.ganadorId ? '✓' : ''}</span>
                        </div>
                      ) : (
                        <div className="match-vs">vs</div>
                      )}
                      <div className="match-pareja p2">
                        <span className="pareja-name">
                          {partido.pareja2
                            ? `${partido.pareja2.jugador1} / ${partido.pareja2.jugador2}`
                            : 'Por definirse'}
                        </span>
                        {partido.estado === 'FINALIZADO' && partido.ganadorId === partido.pareja2Id && (
                          <span className="winner-indicator">✓</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
