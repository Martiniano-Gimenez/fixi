import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../../api/client';
import ResultadoModal from '../../components/ResultadoModal';
import EditBracketMatchModal from '../../components/EditBracketMatchModal';
import ConfirmModal from '../../components/ConfirmModal';
import AsignarHorarioModal from '../../components/AsignarHorarioModal';
import BracketLines from '../../components/BracketLines';
import { ChevronLeft, GitBranch, Settings, Trophy, Edit2, Plus, Clock, AlertTriangle } from 'lucide-react';
import { formatDiaHorario } from '../../utils/dateUtils';
import './EliminatoriaView.css';

export default function EliminatoriaView() {
  const { torneoId, id: categoriaId } = useParams();
  const navigate = useNavigate();
  const [categoria, setCategoria] = useState(null);
  const [fases, setFases] = useState([]);
  const [zonas, setZonas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState(null);
  const [partidoModal, setPartidoModal] = useState(null);
  const [partidoReprogramar, setPartidoReprogramar] = useState(null);
  const [editBracketModal, setEditBracketModal] = useState(null);
  const [confirmModal, setConfirmModal] = useState({ isOpen: false, type: null });
  const bracketScrollRef = useRef(null);

  useEffect(() => {
    cargarDatos();
  }, [categoriaId]);

  async function cargarDatos() {
    try {
      setLoading(true);
      const [categoriaRes, fasesRes, zonasRes] = await Promise.all([
        api.get(`/categorias/${categoriaId}`),
        api.get(`/categorias/${categoriaId}/fases-eliminatorias`),
        api.get(`/categorias/${categoriaId}/zonas`),
      ]);
      setCategoria(categoriaRes);
      setFases(fasesRes || []);
      setZonas(zonasRes || []);
    } catch (err) {
      setError(err.message || 'Error al cargar la eliminatoria');
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerarEliminatoria() {
    setConfirmModal({ isOpen: true, type: 'generate' });
  }

  async function handleBorrarEliminatoria() {
    setConfirmModal({ isOpen: true, type: 'delete' });
  }

  async function executeConfirmAction() {
    const actionType = confirmModal.type;
    setConfirmModal({ isOpen: false, type: null });

    try {
      setGenerando(true);
      if (actionType === 'generate') {
        await api.post(`/categorias/${categoriaId}/generar-eliminatoria`);
      } else if (actionType === 'delete') {
        await api.delete(`/categorias/${categoriaId}/fases-eliminatorias`);
      }
      await cargarDatos();
    } catch (err) {
      setError(err.message || `Error al ${actionType === 'generate' ? 'generar' : 'borrar'} eliminatoria`);
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
    if (partido.pareja1Id && partido.pareja2Id) {
      setPartidoModal(partido);
    }
  }

  if (loading) {
    return <div className="loading">Cargando...</div>;
  }

  if (!categoria) {
    return <div className="error">Categoría no encontrada</div>;
  }

  const backUrl = `/admin/torneos/${torneoId || categoria.torneoId}/categorias/${categoriaId}`;

  return (
    <div className="eliminatoria-container">
      <div className="header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          <Link
            to={backUrl}
            className="back-btn"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', textDecoration: 'none' }}
          >
            <ChevronLeft size={16} strokeWidth={2} />
            Volver a Categoría {categoria.nombre}
          </Link>
          {categoria.torneo?.estado === 'EN_CURSO' && (
            <Link
              to={`/admin/torneos/${torneoId || categoria.torneoId}/en-vivo`}
              className="back-btn"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                textDecoration: 'none',
                background: 'rgba(0, 208, 132, 0.12)',
                color: 'var(--color-primary)',
                border: '1px solid rgba(0, 208, 132, 0.35)',
              }}
            >
              🏟️ Ir a Día de Torneo
            </Link>
          )}
        </div>
        <h1>
          {categoria.torneo?.nombre} — Categoría {categoria.nombre} (Fase Eliminatoria)
        </h1>
        <div className="header-actions">

          <div className="status">{categoria.estado}</div>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}

      {fases.length === 0 ? (
        <div className="no-eliminatoria">
          <p>La fase eliminatoria aún no ha sido generada.</p>
          <button
            onClick={handleGenerarEliminatoria}
            disabled={generando}
            className="btn-primary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', margin: '0 auto' }}
          >
            <GitBranch size={16} strokeWidth={2} />
            {generando ? 'Generando...' : 'Generar Eliminatoria'}
          </button>
        </div>
      ) : (
        <div className="bracket-container">
          <div className="bracket-scroll" ref={bracketScrollRef} style={{ position: 'relative' }}>
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
                      <div key={partido.id} className="bracket-match-wrapper">
                        <div className="match-card-wrapper" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <div
                            className={`match-card ${isFinalizado ? 'finalizado' : ''} ${isJugable && !isFinalizado ? 'jugable' : ''}`}
                            onClick={() => handleClickPartido(partido)}
                            title={isJugable ? (isFinalizado ? 'Click para editar resultado' : 'Click para cargar resultado') : 'Esperando clasificados'}
                          >
                            <div className="match-card-header">
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span className={`match-status-badge ${isFinalizado ? 'finalizado' : isJugable ? 'pendiente' : 'esperando'}`}>
                                  {isFinalizado ? 'Finalizado' : isJugable ? 'Pendiente' : 'Esperando...'}
                                </span>
                                {!isFinalizado && (
                                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <button
                                      className="btn-icon"
                                      title="Editar cruce"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setEditBracketModal(partido);
                                      }}
                                      style={{
                                        background: 'none',
                                        border: 'none',
                                        cursor: 'pointer',
                                        padding: '2px',
                                        color: 'var(--color-text-muted)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        transition: 'color 0.2s',
                                      }}
                                      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-primary)')}
                                      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-muted)')}
                                    >
                                      <Settings size={13} strokeWidth={2} />
                                    </button>
                                    <button
                                      className="btn-icon"
                                      title={partido.fechaHora ? "Reprogramar horario y cancha" : "Asignar horario y cancha"}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setPartidoReprogramar(partido);
                                      }}
                                      style={{
                                        background: 'none',
                                        border: 'none',
                                        cursor: 'pointer',
                                        padding: '2px',
                                        color: 'var(--color-text-muted)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        transition: 'color 0.2s',
                                      }}
                                      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-primary)')}
                                      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-muted)')}
                                    >
                                      <Clock size={13} strokeWidth={2} />
                                    </button>
                                  </div>
                                )}
                              </div>
                              <span className="match-position">#{partido.posicionEnRonda}</span>
                            </div>

                            {partido.fechaHora ? (
                              <div className="match-time-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--color-text-secondary)', fontWeight: 600 }}>
                                  <Clock size={11} style={{ color: 'var(--color-primary)' }} />
                                  {formatDiaHorario(partido.fechaHora)}
                                </div>
                              </div>
                            ) : (
                              <div className="match-time-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: 'var(--color-warning)', fontWeight: 600 }}>
                                  <AlertTriangle size={10} /> Sin horario
                                </div>
                              </div>
                            )}

                            <div className="parejas-list">
                              <div className={`pareja-row ${p1esGanador ? 'ganador' : ''}`}>
                                <div className="pareja-info">
                                  {partido.pareja1 ? (
                                    <span className="pareja-nombre">
                                      {partido.pareja1.jugador1} / {partido.pareja1.jugador2}
                                    </span>
                                  ) : (
                                    <span className="pareja-esperando">
                                      {partido.origenPareja1 ? `Esperando ${partido.origenPareja1}` : 'Esperando...'}
                                    </span>
                                  )}
                                </div>
                                {partido.sets && partido.sets.length > 0 && (
                                  <div className="sets-container">
                                    {partido.sets.map((set, idx) => (
                                      <span key={idx} className="set-score">
                                        {set.gamesPareja1}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>

                              <div className={`pareja-row ${p2esGanador ? 'ganador' : ''}`}>
                                <div className="pareja-info">
                                  {partido.pareja2 ? (
                                    <span className="pareja-nombre">
                                      {partido.pareja2.jugador1} / {partido.pareja2.jugador2}
                                    </span>
                                  ) : (
                                    <span className="pareja-esperando">
                                      {partido.origenPareja2 ? `Esperando ${partido.origenPareja2}` : 'Esperando...'}
                                    </span>
                                  )}
                                </div>
                                {partido.sets && partido.sets.length > 0 && (
                                  <div className="sets-container">
                                    {partido.sets.map((set, idx) => (
                                      <span key={idx} className="set-score">
                                        {set.gamesPareja2}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            <BracketLines scrollContainerRef={bracketScrollRef} fases={fases} />
          </div>
        </div>
      )}

      {partidoModal && (
        <ResultadoModal
          isOpen={Boolean(partidoModal)}
          partido={partidoModal}
          onClose={() => setPartidoModal(null)}
          onSuccess={() => {
            setPartidoModal(null);
            cargarDatos();
          }}
        />
      )}

      {editBracketModal && (
        <EditBracketMatchModal
          isOpen={Boolean(editBracketModal)}
          partido={editBracketModal}
          zonas={zonas}
          partidosRonda={
            fases.find((f) => f.id === editBracketModal.faseEliminatoriaId)?.partidos || []
          }
          onClose={() => setEditBracketModal(null)}
          onSuccess={() => {
            setEditBracketModal(null);
            cargarDatos();
          }}
        />
      )}

      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.type === 'generate' ? 'Generar Eliminatoria' : 'Borrar Bracket'}
        message={
          confirmModal.type === 'generate'
            ? 'Esto clasificará automáticamente a los mejores de cada zona y armará el cuadro. Si ya existen llaves, se asignarán los clasificados al diseño actual.'
            : '¿Estás seguro de que querés borrar el cuadro eliminatorio completo? Se perderán todos los cruces y resultados cargados en la llave.'
        }
        confirmText={confirmModal.type === 'generate' ? 'Generar' : 'Borrar'}
        isDanger={confirmModal.type === 'delete'}
        onConfirm={executeConfirmAction}
        onCancel={() => setConfirmModal({ isOpen: false, type: null })}
      />

      {partidoReprogramar && (
        <AsignarHorarioModal
          isOpen={!!partidoReprogramar}
          partido={partidoReprogramar}
          torneoId={torneoId}
          onClose={() => setPartidoReprogramar(null)}
          onAssigned={() => {
            setPartidoReprogramar(null);
            cargarDatos();
          }}
        />
      )}
    </div>
  );
}
