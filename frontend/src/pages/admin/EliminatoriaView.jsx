import { useEffect, useState, useRef, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../../api/client';
import ResultadoModal from '../../components/ResultadoModal';
import EditBracketMatchModal from '../../components/EditBracketMatchModal';
import ConfirmModal from '../../components/ConfirmModal';
import AsignarHorarioModal from '../../components/AsignarHorarioModal';
import AdvertenciasHorarioModal from '../../components/AdvertenciasHorarioModal';
import BracketLines from '../../components/BracketLines';
import { ChevronLeft, GitBranch, Settings, Clock, AlertTriangle, Trophy } from 'lucide-react';
import { formatDiaHorario } from '../../utils/dateUtils';
import { estadoLabel } from '../../utils/estadoLabels';

function formatParejaDisplay(pareja) {
  if (!pareja) return '';
  if (typeof pareja === 'string') return pareja;
  if (pareja.jugador1 && pareja.jugador2) return `${pareja.jugador1} / ${pareja.jugador2}`;
  if (pareja.jugador1) return pareja.jugador1;
  return pareja.nombre || '';
}

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
  const [advertenciasModal, setAdvertenciasModal] = useState(null);
  const [editBracketModal, setEditBracketModal] = useState(null);
  const [confirmModal, setConfirmModal] = useState({ isOpen: false, type: null });
  const [activeRoundId, setActiveRoundId] = useState(null);
  const bracketScrollRef = useRef(null);

  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 768px)').matches;
  });

  useEffect(() => {
    const mql = window.matchMedia('(max-width: 768px)');
    const onChange = (e) => setIsMobile(e.matches);
    if (mql.addEventListener) {
      mql.addEventListener('change', onChange);
    } else {
      mql.addListener(onChange);
    }
    return () => {
      if (mql.removeEventListener) {
        mql.removeEventListener('change', onChange);
      } else {
        mql.removeListener(onChange);
      }
    };
  }, []);

  const rondaMasAvanzadaConParejas = useMemo(() => {
    if (!fases || fases.length === 0) return null;
    for (let i = fases.length - 1; i >= 0; i--) {
      const fase = fases[i];
      const tieneDefinido = fase.partidos.some(
        (p) => Boolean(p.pareja1 && p.pareja2) || p.estado === 'FINALIZADO' || p.estado === 'EN_CURSO'
      );
      if (tieneDefinido) return fase.id;
    }
    return fases[0].id;
  }, [fases]);

  const activeFaseMobile = useMemo(() => {
    if (!fases || fases.length === 0) return null;
    return (
      fases.find((f) => f.id === activeRoundId) ||
      fases.find((f) => f.id === rondaMasAvanzadaConParejas) ||
      fases[0]
    );
  }, [fases, activeRoundId, rondaMasAvanzadaConParejas]);

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

  const renderMatch = (partido) => {
    const isBye = Boolean(partido.esBye);
    const isFinalizado = partido.estado === 'FINALIZADO';
    const isJugable = !isBye && Boolean(partido.pareja1Id && partido.pareja2Id);
    const p1esGanador = isFinalizado && partido.ganadorId === partido.pareja1Id;
    const p2esGanador = isFinalizado && partido.ganadorId === partido.pareja2Id;

    // Lados definidos en la tarjeta (para identificar el slot BYE)
    const lado1Definido = Boolean(partido.pareja1 || partido.pareja1Id || partido.origenPareja1);
    const lado2Definido = Boolean(partido.pareja2 || partido.pareja2Id || partido.origenPareja2);

    // Parejas y orígenes a mostrar (incluyendo campos derivados de display de la ronda siguiente)
    const p1Pareja = partido.pareja1 || partido.displayPareja1;
    let p1Origen = partido.origenPareja1 || partido.displayOrigenPareja1;
    const p2Pareja = partido.pareja2 || partido.displayPareja2;
    let p2Origen = partido.origenPareja2 || partido.displayOrigenPareja2;

    // Fallback para rondas siguientes si aún no tienen pareja ni origen definido
    if (!p1Pareja && !p1Origen && fases && fases.length > 0) {
      const fIdx = fases.findIndex((f) => f.id === partido.faseEliminatoriaId || f.partidos?.some((p) => p.id === partido.id));
      if (fIdx > 0) {
        const fPrev = fases[fIdx - 1];
        const nCorto = (fPrev.nombre || '').replace(/\s+de\s+Final$/i, '').trim();
        p1Origen = `Ganador ${nCorto} #${2 * partido.posicionEnRonda - 1}`;
      }
    }
    if (!p2Pareja && !p2Origen && fases && fases.length > 0) {
      const fIdx = fases.findIndex((f) => f.id === partido.faseEliminatoriaId || f.partidos?.some((p) => p.id === partido.id));
      if (fIdx > 0) {
        const fPrev = fases[fIdx - 1];
        const nCorto = (fPrev.nombre || '').replace(/\s+de\s+Final$/i, '').trim();
        p2Origen = `Ganador ${nCorto} #${2 * partido.posicionEnRonda}`;
      }
    }

    let titleTexto = 'Esperando clasificados';
    if (isBye) {
      titleTexto = 'Pase directo por BYE';
    } else if (isJugable) {
      titleTexto = isFinalizado ? 'Click para editar resultado' : 'Click para cargar resultado';
    } else if (p1Origen || p2Origen) {
      titleTexto = 'Esperando definición de cruces previos';
    }

    return (
      <div key={partido.id} className="cb-match-wrap">
        <div className="cb-card-wrap">
          <div
            className={`match-card cb-card ${isBye ? 'bye-card' : ''} ${isFinalizado && !isBye ? 'finalizado' : ''} ${isJugable && !isFinalizado ? 'jugable' : ''}`}
            onClick={() => {
              if (!isBye && isJugable) {
                handleClickPartido(partido);
              }
            }}
            title={titleTexto}
          >
            <div className="cb-match-header">
              <div className="cb-match-tools">
                {(isFinalizado || isJugable) && !isBye && (
                  <span className={`cb-state${partido.estado === 'EN_CURSO' ? ' is-live' : ''}`}>
                    {isFinalizado ? 'Finalizado' : partido.estado === 'EN_CURSO' ? 'En juego' : 'Pendiente'}
                  </span>
                )}
                {!isFinalizado && !isBye && (
                  <div className="cb-match-actions">
                    <button

                      title="Editar cruce"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditBracketModal(partido);
                      }}
                      className="pm-button cb-icon-button"
                    >
                      <Settings size={13} strokeWidth={2} />
                    </button>
                    <button

                      title={partido.fechaHora ? "Reprogramar horario y cancha" : "Asignar horario y cancha"}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPartidoReprogramar(partido);
                      }}
                      className="pm-button cb-icon-button"
                    >
                      <Clock size={13} strokeWidth={2} />
                    </button>
                  </div>
                )}
              </div>
              <span className="cb-position">#{partido.posicionEnRonda}</span>
            </div>

            {!isBye && (
              partido.fechaHora ? (
                <div className="cb-time-row">
                  <div className="cb-time">
                    <Clock size={11} className="cb-brand-icon" />
                    {formatDiaHorario(partido.fechaHora)}
                  </div>
                  {partido.horarioManual === true && Array.isArray(partido.advertencias) && partido.advertencias.length > 0 && (
                    <button
                      type="button"

                      className="pm-button cb-review"
                      onClick={(e) => {
                        e.stopPropagation();
                        setAdvertenciasModal(partido.advertencias);
                      }}
                    >
                      Revisar horario
                    </button>
                  )}
                </div>
              ) : (
                <div className="cb-time-row">
                  <div className="cb-no-time">
                    <AlertTriangle size={10} /> Sin horario
                  </div>
                </div>
              )
            )}

            <div className="cb-pairs">
              <div className={`cb-pair ${p1esGanador ? 'ganador' : ''}${isFinalizado && !p1esGanador ? ' is-loser' : ''}`}>
                <div className="cb-pair-info">
                  {isBye && !lado1Definido ? (
                    <span className="cb-bye">BYE</span>
                  ) : p1Pareja ? (
                    <span className="cb-name">
                      {formatParejaDisplay(p1Pareja)}
                    </span>
                  ) : (
                    <span className="cb-placeholder">
                      {p1Origen || 'Esperando...'}
                    </span>
                  )}
                </div>
                {partido.sets && partido.sets.length > 0 && (
                  <div className="cb-sets">
                    {partido.sets.map((set, idx) => (
                      <span key={idx} className="cb-set-score">
                        {set.gamesPareja1}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className={`cb-pair ${p2esGanador ? 'ganador' : ''}${isFinalizado && !p2esGanador ? ' is-loser' : ''}`}>
                <div className="cb-pair-info">
                  {isBye && !lado2Definido ? (
                    <span className="cb-bye">BYE</span>
                  ) : p2Pareja ? (
                    <span className="cb-name">
                      {formatParejaDisplay(p2Pareja)}
                    </span>
                  ) : (
                    <span className="cb-placeholder">
                      {p2Origen || 'Esperando...'}
                    </span>
                  )}
                </div>
                {partido.sets && partido.sets.length > 0 && (
                  <div className="cb-sets">
                    {partido.sets.map((set, idx) => (
                      <span key={idx} className="cb-set-score">
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
  };

  if (loading) {
    return <div className="cb-page cb-loading">Cargando…</div>;
  }

  if (!categoria) {
    return <div className="cb-page pm-alert">Categoría no encontrada</div>;
  }

  const backUrl = `/admin/torneos/${torneoId || categoria.torneoId}/categorias/${categoriaId}`;

  return (
    <div className="cb-page">
      <div className="cb-heading">
        <div className="cb-navigation">
          <Link
            to={backUrl}
            className="panel-back"
          >
            <ChevronLeft size={16} strokeWidth={2} />
            Volver a categoría {categoria.nombre}
          </Link>
          {categoria.torneo?.estado === 'EN_CURSO' && (
            <Link
              to={`/admin/torneos/${torneoId || categoria.torneoId}/en-vivo`}

              className="pm-button pm-blue-button"
            >
              Ir a Día de Torneo
            </Link>
          )}
        </div>
        <div className="cb-title-group">
          {categoria.torneo?.nombre && (
            <>
              <span className="cb-tournament">{categoria.torneo.nombre}</span>
              <span className="cb-title-sep">—</span>
            </>
          )}
          <h1 className="cb-title">
            {categoria.nombre}
          </h1>
        </div>
        <div className="cb-heading-actions">

          <span className="cb-state">
            {estadoLabel(categoria.estado)}
          </span>
        </div>
      </div>

      {error && <div className="pm-alert">{error}</div>}

      {estadoCuadro?.desactualizado && (
        <div

          className="pm-alert cb-stale"
        >
          <div className="cb-alert-main">
            <AlertTriangle size={20} className="cb-alert-icon" />
            <div>
              <span className="pm-strong">
                El cuadro está desactualizado:
              </span>{' '}
              <span className="cb-alert-copy">
                las zonas esperan {estadoCuadro.totalClasificadosEsperados} clasificados y el cuadro reserva{' '}
                {estadoCuadro.lugaresEnPrimeraRonda} lugares.
              </span>
            </div>
          </div>
          <div className="cb-alert-actions">
            <button

              onClick={() => setSincronizarModalOpen(true)}
              disabled={estadoCuadro.huboJuegoEliminatoria || sincronizando}
              className="pm-button pm-blue-button"
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
              <span className="cb-blocked">
                (Bloqueado: ya hay partidos eliminatorios jugados)
              </span>
            )}
          </div>
        </div>
      )}

      {fases.length === 0 ? (
        <div className="cb-empty">
          <p>La fase eliminatoria aún no ha sido generada.</p>
          <button
            onClick={handleGenerarEliminatoria}
            disabled={generando}

            className="pm-button pm-primary"
          >
            <GitBranch size={16} strokeWidth={2} />
            {generando ? 'Generando…' : 'Generar eliminatoria'}
          </button>
        </div>
      ) : isMobile ? (
        <div className="cb-mobile">
          <div className="cb-tabs" role="tablist" aria-label="Rondas eliminatorias">
            {fases.map((fase) => {
              const isActive = (activeFaseMobile ? activeFaseMobile.id : activeRoundId) === fase.id;
              return (
                <button
                  key={fase.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`cb-tab ${isActive ? 'active' : ''}`}
                  onClick={() => setActiveRoundId(fase.id)}
                >
                  {fase.ronda === 2 && <Trophy size={16} className="cb-trophy" />}
                  <span>{fase.nombre}</span>
                </button>
              );
            })}
          </div>

          {activeFaseMobile && (
            <div className="cb-mobile-matches">
              {activeFaseMobile.partidos.map((partido) => renderMatch(partido))}
            </div>
          )}
        </div>
      ) : (
        <div className="cb-viewport">
          <div ref={bracketScrollRef} className="cb-scroll">
            {fases.map((fase) => (
              <div key={fase.id} className="bracket-section cb-round">
                <h3 className="cb-round-title">
                  {fase.ronda === 2 && <Trophy size={18} className="cb-trophy" />}
                  {fase.nombre}
                </h3>
                <div className="cb-matches-column">
                  {fase.partidos.map((partido) => renderMatch(partido))}
                </div>
              </div>
            ))}
            <BracketLines scrollContainerRef={bracketScrollRef} fases={fases} color="var(--linea-fuerte)" />
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

      {advertenciasModal && (
        <AdvertenciasHorarioModal
          isOpen={!!advertenciasModal}
          advertencias={advertenciasModal}
          onClose={() => setAdvertenciasModal(null)}
        />
      )}

      {sincronizarModalOpen && estadoCuadro?.simulacion && (
        <div
          className="pm-overlay"
        >
          <div

            className="pm-modal pm-sync"
            role="dialog"
            aria-modal="true"
            aria-label="Sincronizar cuadro eliminatorio"
          >
            <h3 className="pm-header pm-title">
              <GitBranch size={20} className="cb-brand-icon" />
              Sincronizar cuadro eliminatorio
            </h3>
            <div className="pm-body">
            <p className="cb-sync-copy">
              Los clasificados de las zonas cambiaron. Esta acción regenerará la estructura de la llave y reprogramará los horarios respetando las zonas ya disputadas:
            </p>

            <div
              className="cb-sync-summary"
            >
              <div className="cb-sync-row">
                <span className="pm-muted">Estructura de llaves:</span>
                <strong className="cb-sync-value">{estadoCuadro.simulacion.rondasTexto}</strong>
              </div>
              <div className="cb-sync-row">
                <span className="pm-muted">Tamaño del cuadro:</span>
                <span>{estadoCuadro.simulacion.tamanoActual} cupos → <strong>{estadoCuadro.simulacion.tamanoNuevo} cupos</strong></span>
              </div>
              <div className="cb-sync-row">
                <span className="pm-muted">Clasificados totales:</span>
                <span>{estadoCuadro.simulacion.totalClasificadosActual} → <strong>{estadoCuadro.simulacion.totalClasificadosNuevo} parejas</strong></span>
              </div>
              <div className="cb-sync-row">
                <span className="pm-muted">Pases directos (BYEs):</span>
                <span>{estadoCuadro.simulacion.byesActuales} → <strong>{estadoCuadro.simulacion.byesNuevos} BYEs</strong></span>
              </div>
              <div className="cb-sync-row">
                <span className="pm-muted">Partidos creados / reemplazados:</span>
                <span><strong>{estadoCuadro.simulacion.partidosACrear} partidos</strong> (se reemplazan {estadoCuadro.simulacion.partidosAEliminar})</span>
              </div>
              <div className="cb-sync-row">
                <span className="pm-muted">Horarios a reprogramar:</span>
                <span className="cb-blocked"><strong>{estadoCuadro.simulacion.horariosQueCambian} cruces</strong> en cronograma</span>
              </div>
            </div>

            </div>
            <div className="pm-footer">
              <button
                type="button"
                className="pm-button"
                onClick={() => setSincronizarModalOpen(false)}
                disabled={sincronizando}
              >
                Cancelar
              </button>
              <button
                type="button"

                onClick={handleConfirmarSincronizar}
                disabled={sincronizando}
                className="pm-button pm-primary"
              >
                {sincronizando ? 'Sincronizando…' : 'Confirmar sincronización'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
