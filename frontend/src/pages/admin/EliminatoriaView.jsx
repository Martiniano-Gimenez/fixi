import { useEffect, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../../api/client';
import ResultadoModal from '../../components/ResultadoModal';
import EditBracketMatchModal from '../../components/EditBracketMatchModal';
import ConfirmModal from '../../components/ConfirmModal';
import AsignarHorarioModal from '../../components/AsignarHorarioModal';
import BracketLines from '../../components/BracketLines';
import { ChevronLeft, GitBranch, Settings, Clock, AlertTriangle } from 'lucide-react';
import { formatDiaHorario } from '../../utils/dateUtils';
import { estadoLabel } from '../../utils/estadoLabels';
import './EliminatoriaView.css';

export default function EliminatoriaView() {
  const { torneoId, id: categoriaId } = useParams();
  const [categoria, setCategoria] = useState(null);
  const [fases, setFases] = useState([]);
  const [zonas, setZonas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generando, setGenerando] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [estadoCuadro, setEstadoCuadro] = useState(null);
  const [sincronizarModalOpen, setSincronizarModalOpen] = useState(false);
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
      const [categoriaRes, fasesRes, zonasRes, estadoCuadroRes] = await Promise.all([
        api.get(`/categorias/${categoriaId}`),
        api.get(`/categorias/${categoriaId}/fases-eliminatorias`),
        api.get(`/categorias/${categoriaId}/zonas`),
        api.get(`/categorias/${categoriaId}/cuadro-estado`).catch(() => null),
      ]);
      setCategoria(categoriaRes);
      setFases(fasesRes || []);
      setZonas(zonasRes || []);
      setEstadoCuadro(estadoCuadroRes);
    } catch (err) {
      setError(err.message || 'Error al cargar la eliminatoria');
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmarSincronizar() {
    try {
      setSincronizando(true);
      setError(null);
      await api.post(`/categorias/${categoriaId}/sincronizar-cuadro`);
      setSincronizarModalOpen(false);
      await cargarDatos();
    } catch (err) {
      setError(err.message || 'Error al sincronizar el cuadro eliminatorio');
    } finally {
      setSincronizando(false);
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

          <span className={`badge badge-${(categoria.estado || '').toLowerCase()}`}>
            {estadoLabel(categoria.estado)}
          </span>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}

      {estadoCuadro?.desactualizado && (
        <div
          className="cuadro-desactualizado-banner"
          style={{
            background: 'rgba(234, 179, 8, 0.12)',
            border: '1px solid rgba(234, 179, 8, 0.4)',
            borderRadius: 'var(--radius-md, 8px)',
            padding: '0.85rem 1.25rem',
            marginBottom: '1rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.75rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <AlertTriangle size={20} color="#eab308" />
            <div>
              <span style={{ fontWeight: 600, color: 'var(--color-text, #fff)' }}>
                El cuadro está desactualizado:
              </span>{' '}
              <span style={{ color: 'var(--color-text-muted, #ccc)' }}>
                las zonas esperan {estadoCuadro.totalClasificadosEsperados} clasificados y el cuadro reserva{' '}
                {estadoCuadro.lugaresEnPrimeraRonda} lugares.
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              className="btn-primary"
              onClick={() => setSincronizarModalOpen(true)}
              disabled={estadoCuadro.huboJuegoEliminatoria || sincronizando}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.45rem 0.9rem',
                fontSize: '0.85rem',
                opacity: estadoCuadro.huboJuegoEliminatoria ? 0.5 : 1,
                cursor: estadoCuadro.huboJuegoEliminatoria ? 'not-allowed' : 'pointer',
              }}
              title={
                estadoCuadro.huboJuegoEliminatoria
                  ? 'No se puede sincronizar porque ya hay partidos eliminatorios jugados o en juego'
                  : 'Sincronizar el cuadro eliminatorio con las zonas actuales'
              }
            >
              <GitBranch size={14} />
              Sincronizar cuadro
            </button>
            {estadoCuadro.huboJuegoEliminatoria && (
              <span style={{ fontSize: '0.8rem', color: '#ef4444' }}>
                (Bloqueado: ya hay partidos eliminatorios jugados)
              </span>
            )}
          </div>
        </div>
      )}

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

      {sincronizarModalOpen && estadoCuadro?.simulacion && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1200,
            backdropFilter: 'blur(4px)',
            padding: '1rem',
          }}
        >
          <div
            className="card"
            style={{
              maxWidth: '520px',
              width: '100%',
              background: 'var(--color-bg-card, #1e293b)',
              border: '1px solid var(--color-border, #334155)',
              borderRadius: 'var(--radius-lg, 12px)',
              padding: '1.5rem',
              boxShadow: 'var(--shadow-xl)',
            }}
          >
            <h3 style={{ margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--color-text, #fff)' }}>
              <GitBranch size={20} color="var(--color-primary, #00d084)" />
              Sincronizar Cuadro Eliminatorio
            </h3>
            <p style={{ color: 'var(--color-text-muted, #94a3b8)', fontSize: '0.9rem', marginBottom: '1.25rem' }}>
              Los clasificados de las zonas cambiaron. Esta acción regenerará la estructura de la llave y reprogramará los horarios respetando las zonas ya disputadas:
            </p>

            <div
              style={{
                background: 'rgba(0, 0, 0, 0.25)',
                border: '1px solid var(--color-border, #334155)',
                borderRadius: 'var(--radius-md, 8px)',
                padding: '1rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.6rem',
                fontSize: '0.9rem',
                marginBottom: '1.5rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--color-text-muted, #94a3b8)' }}>Estructura de llaves:</span>
                <strong style={{ color: 'var(--color-primary, #00d084)' }}>{estadoCuadro.simulacion.rondasTexto}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--color-text-muted, #94a3b8)' }}>Tamaño del cuadro:</span>
                <span>{estadoCuadro.simulacion.tamanoActual} cupos → <strong>{estadoCuadro.simulacion.tamanoNuevo} cupos</strong></span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--color-text-muted, #94a3b8)' }}>Clasificados totales:</span>
                <span>{estadoCuadro.simulacion.totalClasificadosActual} → <strong>{estadoCuadro.simulacion.totalClasificadosNuevo} parejas</strong></span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--color-text-muted, #94a3b8)' }}>Pases directos (BYEs):</span>
                <span>{estadoCuadro.simulacion.byesActuales} → <strong>{estadoCuadro.simulacion.byesNuevos} BYEs</strong></span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--color-text-muted, #94a3b8)' }}>Partidos creados / reemplazados:</span>
                <span><strong>{estadoCuadro.simulacion.partidosACrear} partidos</strong> (se reemplazan {estadoCuadro.simulacion.partidosAEliminar})</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--color-text-muted, #94a3b8)' }}>Horarios a reprogramar:</span>
                <span style={{ color: '#eab308' }}><strong>{estadoCuadro.simulacion.horariosQueCambian} cruces</strong> en cronograma</span>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setSincronizarModalOpen(false)}
                disabled={sincronizando}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleConfirmarSincronizar}
                disabled={sincronizando}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
              >
                {sincronizando ? 'Sincronizando...' : 'Confirmar Sincronización'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
