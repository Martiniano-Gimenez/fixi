import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../../api/client';
import { copiarTexto } from '../../utils/portapapeles';
import ConfirmModal from '../../components/ConfirmModal';
import ActionsMenu from '../../components/ActionsMenu';
import {
  ChevronLeft,
  Plus,
  Play,
  Calendar,
  RotateCcw,
  Copy,
  Check,
  Trash2,
  Layers,
  Users,
  RefreshCw,
  Eye,
  Settings,
  Activity,
  Edit2,
  X,
  GitBranch,
} from 'lucide-react';
import InscripcionLinkPanel from '../../components/InscripcionLinkPanel';
import PartidosPendientesSection from '../../components/PartidosPendientesSection';
import { estadoLabel } from '../../utils/estadoLabels';
import { formatFechaTorneo, getZonedParts, isViernes } from '../../utils/dateUtils';

export default function TorneoDetail() {
  const { id } = useParams();

  const [torneo, setTorneo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Modales y estados
  const [copiado, setCopiado] = useState(false);
  const [errorCopia, setErrorCopia] = useState(false);
  const copiaTimeoutRef = useRef(null);
  const [nuevaCatModalOpen, setNuevaCatModalOpen] = useState(false);
  const [nombreNuevaCat, setNombreNuevaCat] = useState('');
  const [creandoCat, setCreandoCat] = useState(false);

  const [categoriaAEliminar, setCategoriaAEliminar] = useState(null);
  const [eliminandoCat, setEliminandoCat] = useState(false);

  const [reiniciarModalOpen, setReiniciarModalOpen] = useState(false);
  const [reiniciando, setReiniciando] = useState(false);

  // Editar Fecha del Torneo
  const [editTorneoModalOpen, setEditTorneoModalOpen] = useState(false);
  const [editFecha, setEditFecha] = useState('');
  const [guardandoTorneo, setGuardandoTorneo] = useState(false);
  const [editTorneoError, setEditTorneoError] = useState('');

  // Edición rápida / inline del nombre del torneo
  const [isEditingNombre, setIsEditingNombre] = useState(false);
  const [nombreInline, setNombreInline] = useState('');
  const [guardandoNombreInline, setGuardandoNombreInline] = useState(false);
  const [nombreInlineError, setNombreInlineError] = useState('');
  const inlineNombreInputRef = useRef(null);

  const fetchData = useCallback(async () => {
    try {
      const data = await api.get(`/torneos/${id}`);
      setTorneo(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCopyLink = async () => {
    if (!torneo?.slug) return;
    const url = `${window.location.origin}/torneo/${torneo.slug}`;
    const resultado = await copiarTexto(url);
    setCopiado(resultado);
    setErrorCopia(!resultado);
    clearTimeout(copiaTimeoutRef.current);
    copiaTimeoutRef.current = setTimeout(() => {
      setCopiado(false);
      setErrorCopia(false);
    }, 2000);
  };

  useEffect(() => {
    if (isEditingNombre && inlineNombreInputRef.current) {
      inlineNombreInputRef.current.focus();
      inlineNombreInputRef.current.select();
    }
  }, [isEditingNombre]);

  const handleStartEditingNombre = () => {
    if (!torneo) return;
    setNombreInline(torneo.nombre || '');
    setNombreInlineError('');
    setIsEditingNombre(true);
  };

  const handleCancelEditingNombre = () => {
    setIsEditingNombre(false);
    setNombreInline(torneo?.nombre || '');
    setNombreInlineError('');
  };

  const handleSaveNombreInline = async (e) => {
    if (e) e.preventDefault();
    const trimmed = nombreInline.trim();
    if (!trimmed) {
      setNombreInlineError('El nombre no puede estar vacío.');
      return;
    }
    if (trimmed === torneo.nombre) {
      setIsEditingNombre(false);
      return;
    }
    setGuardandoNombreInline(true);
    setNombreInlineError('');
    try {
      const updated = await api.put(`/torneos/${torneo.id}`, {
        nombre: trimmed,
      });
      setTorneo((prev) => ({ ...prev, ...updated }));
      setIsEditingNombre(false);
    } catch (err) {
      setNombreInlineError(err.message || 'Error al actualizar el nombre.');
    } finally {
      setGuardandoNombreInline(false);
    }
  };

  const handleOpenEditTorneo = () => {
    if (!torneo || torneo.estado !== 'BORRADOR') return;
    if (torneo.fecha) {
      const match = typeof torneo.fecha === 'string' && torneo.fecha.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) {
        setEditFecha(`${match[1]}-${match[2]}-${match[3]}`);
      } else {
        const parts = getZonedParts(torneo.fecha);
        if (parts) {
          const yyyy = parts.year;
          const mm = String(parts.month).padStart(2, '0');
          const dd = String(parts.day).padStart(2, '0');
          setEditFecha(`${yyyy}-${mm}-${dd}`);
        } else {
          setEditFecha('');
        }
      }
    } else {
      setEditFecha('');
    }
    setEditTorneoError('');
    setEditTorneoModalOpen(true);
  };

  const handleGuardarTorneo = async (e) => {
    e.preventDefault();
    if (!editFecha) {
      setEditTorneoError('La fecha de inicio del torneo es obligatoria.');
      return;
    }
    if (!isViernes(editFecha)) {
      setEditTorneoError('La fecha de inicio debe ser un viernes.');
      return;
    }
    setGuardandoTorneo(true);
    setEditTorneoError('');
    try {
      const updated = await api.put(`/torneos/${torneo.id}`, {
        fecha: editFecha,
      });
      setTorneo((prev) => ({ ...prev, ...updated }));
      setEditTorneoModalOpen(false);
    } catch (err) {
      setEditTorneoError(err.message || 'Error al actualizar la fecha del torneo.');
    } finally {
      setGuardandoTorneo(false);
    }
  };

  const handleCrearCategoria = async (e) => {
    e.preventDefault();
    if (!nombreNuevaCat.trim()) return;
    setCreandoCat(true);
    try {
      await api.post(`/torneos/${id}/categorias`, { nombre: nombreNuevaCat.trim() });
      setNombreNuevaCat('');
      setNuevaCatModalOpen(false);
      fetchData();
    } catch (err) {
      alert(err.message || 'Error al crear la categoría.');
    } finally {
      setCreandoCat(false);
    }
  };

  const executeEliminarCategoria = async () => {
    if (!categoriaAEliminar) return;
    setEliminandoCat(true);
    try {
      await api.delete(`/categorias/${categoriaAEliminar.id}`);
      setCategoriaAEliminar(null);
      fetchData();
    } catch (err) {
      alert(err.message || 'Error al eliminar categoría.');
    } finally {
      setEliminandoCat(false);
    }
  };

  const executeReiniciarTorneo = async () => {
    setReiniciando(true);
    try {
      await api.post(`/torneos/${id}/reiniciar`);
      setReiniciarModalOpen(false);
      fetchData();
    } catch (err) {
      alert(err.message || 'Error al reiniciar el torneo.');
    } finally {
      setReiniciando(false);
    }
  };

  if (loading) return <div className="td-loading">Cargando torneo…</div>;
  if (error || !torneo) return <div className="td-error td-load-error">{error || 'Torneo no encontrado'}</div>;

  const categoriasBorrador = (torneo.categorias || []).filter((c) => c.estado === 'BORRADOR');
  const puedeIniciar = categoriasBorrador.length > 0 && categoriasBorrador.some((c) => c.parejas?.length >= 2);

  return (
    <div className="page td-screen">
      {/* Volver */}
      <div className="td-back-row">
        <Link
          to="/admin"
          className="panel-back"
        >
          <ChevronLeft size={16} /> Volver a mis torneos
        </Link>
      </div>

      {/* Header del Torneo */}
      <div className="td-card td-header">
        <div className="td-header-layout">
          <div>
            <div className="td-title-row">
              {!isEditingNombre ? (
                <div className="td-name-row">
                  <h1
                    className="td-name"
                    onClick={handleStartEditingNombre}
                    title="Hacé click para cambiar el nombre del torneo"
                  >
                    <span>{torneo.nombre}</span>
                  </h1>
                  <button
                    type="button"
                    onClick={handleStartEditingNombre}
                    className="td-button td-edit-name"
                    title="Cambiar nombre del torneo"
                    aria-label="Cambiar nombre del torneo"
                  >
                    <Edit2 size={14} className="td-brand-icon" />
                  </button>
                  <span className={`td-state td-state-${torneo.estado.toLowerCase()}`}>{estadoLabel(torneo.estado)}</span>
                </div>
              ) : (
                <form
                  onSubmit={handleSaveNombreInline}
                  className="td-name-form"
                >
                  <input
                    aria-label="Nombre del torneo"
                    ref={inlineNombreInputRef}
                    type="text"
                    value={nombreInline}
                    onChange={(e) => {
                      setNombreInline(e.target.value);
                      if (nombreInlineError) setNombreInlineError('');
                    }}
                    disabled={guardandoNombreInline}
                    placeholder="Nombre del torneo…"
                    className="td-input td-name-input"
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        handleCancelEditingNombre();
                      }
                    }}
                  />
                  <div className="td-inline-actions">
                    <button
                      type="submit"
                      disabled={guardandoNombreInline || !nombreInline.trim() || nombreInline.trim() === torneo.nombre}
                      title="Guardar nombre (Enter)"
                      className="td-button"
                    >
                      {guardandoNombreInline ? (
                        <RefreshCw size={14} className="td-spin" />
                      ) : (
                        <Check size={15} strokeWidth={2.5} />
                      )}
                      <span>Guardar</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelEditingNombre}
                      disabled={guardandoNombreInline}
                      title="Cancelar (Esc)"
                      className="td-button"
                    >
                      <X size={15} />
                      <span>Cancelar</span>
                    </button>
                  </div>
                  {nombreInlineError && (
                    <div className="td-error td-name-error">
                      {nombreInlineError}
                    </div>
                  )}
                </form>
              )}
            </div>

            <div className="td-meta">
              {torneo.estado === 'BORRADOR' ? (
                <button
                  type="button"
                  onClick={handleOpenEditTorneo}
                  className="td-button td-date-button"
                  title="Click para cambiar la fecha del torneo"
                >
                  <Calendar size={15} className="td-brand-icon" />
                  <span>
                    {torneo.fecha ? formatFechaTorneo(torneo.fecha) : 'Fecha a confirmar'}
                  </span>
                  <Edit2 size={12} className="td-date-edit-icon" />
                </button>
              ) : (
                <span className="td-meta-item">
                  <Calendar size={15} />
                  <span>
                    {torneo.fecha ? formatFechaTorneo(torneo.fecha) : 'Fecha a confirmar'}
                  </span>
                </span>
              )}
            </div>
          </div>

          {/* Acciones principales */}
          <div className="td-actions">
            <button
              type="button"
              className="td-button"
              onClick={handleCopyLink}
              title="Copiar link público para compartir con jugadores"
            >
              {copiado ? <Check size={16} className="td-brand-icon" /> : <Copy size={16} />}
              {copiado ? 'Link copiado' : errorCopia ? 'No se pudo copiar' : 'Copiar link público'}
            </button>

            <Link
              to={`/torneo/${torneo.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="td-button"
              title="Abrir vista pública en nueva pestaña"
            >
              <Eye size={16} /> Ver público
            </Link>

            {torneo.estado !== 'BORRADOR' && (
              <ActionsMenu>
                <button
                  type="button"
                  className="actions-menu-item danger"
                  role="menuitem"
                  onClick={() => setReiniciarModalOpen(true)}
                >
                  <RotateCcw size={15} /> Reiniciar torneo
                </button>
              </ActionsMenu>
            )}

            {torneo.estado === 'EN_CURSO' && (
              <Link
                to={`/admin/torneos/${torneo.id}/en-vivo`}
                className="td-button td-primary"
                title="Abrir panel de control en vivo y reprogramación por lluvia"
              >
                <Activity size={16} /> Día de Torneo
              </Link>
            )}

            {puedeIniciar && (
              <Link
                to={`/admin/torneos/${id}/iniciar`}
                className={`td-button${torneo.estado === 'EN_CURSO' ? '' : ' td-primary'}`}
              >
                <Play size={16} /> {torneo.estado === 'EN_CURSO' ? 'Armar categorías pendientes' : 'Iniciar torneo'}
              </Link>
            )}
          </div>
        </div>
      </div>


      {/* Inscripción de parejas por link (solo en borrador) */}
      {torneo.estado === 'BORRADOR' && (torneo.categorias?.length > 0 || torneo.inscripcionAbierta) && (
        <InscripcionLinkPanel
          torneo={torneo}
          onCambio={(inscripcionAbierta) => setTorneo((prev) => ({ ...prev, inscripcionAbierta }))}
        />
      )}

      {/* Sección de partidos pendientes de horario si el torneo está en curso */}
      {torneo.estado === 'EN_CURSO' && (
        <PartidosPendientesSection
          torneoId={torneo.id}
          torneoEstado={torneo.estado}
          onPartidosActualizados={fetchData}
        />
      )}

      {/* Listado de Categorías */}
      <div className="td-section-heading">
        <div>
          <h2 className="td-section-title">
            <Layers size={22} className="td-brand-icon" />
            Categorías
            {torneo.categorias?.length > 0 && (
              <span className="td-category-count">{torneo.categorias.length}</span>
            )}
          </h2>
        </div>

        {torneo.categorias?.length > 0 && (
          <div className="td-category-tools">
            <button
              type="button"
              className="td-button"
              onClick={() => setNuevaCatModalOpen(true)}
            >
              <Plus size={16} /> Nueva categoría
            </button>
          </div>
        )}
      </div>

      {(!torneo.categorias || torneo.categorias.length === 0) ? (
        <div className="td-card td-empty">
          <Layers size={44} className="td-empty-icon" />
          <h3 className="td-empty-title">No hay categorías cargadas</h3>
          <p className="td-empty-copy">
            Agregá las categorías que se juegan en este torneo.
          </p>
          <button
            type="button"
            onClick={() => setNuevaCatModalOpen(true)}
            className="td-button td-primary"
          >
            <Plus size={16} /> Agregar categoría
          </button>
        </div>
      ) : (
        <div className="td-category-grid">
          {torneo.categorias.map((cat) => {
            const totalParejas = cat.parejas?.length || 0;
            const totalZonas = cat.zonas?.length || 0;
            // Los "pasa directo" (esBye) de la llave no se juegan: no cuentan como partidos
            const partidosReales = (cat.partidos || []).filter((p) => !p.esBye);
            const totalPartidos = partidosReales.length;
            const partidosFinalizados = partidosReales.filter((p) => p.estado === 'FINALIZADO').length;

            return (
              <div
                key={cat.id}
                className="td-card td-category"
              >
                <div>
                  <div className="td-category-heading">
                    <h3 className="td-category-title">{cat.nombre}</h3>
                    <div className="td-category-state">
                      {cat.estado !== torneo.estado && (
                        <span className={`td-state td-state-${cat.estado.toLowerCase()}`}>{estadoLabel(cat.estado)}</span>
                      )}
                    </div>
                  </div>

                  <div className="td-category-meta">
                    <span className="td-meta-item">
                      <Users size={15} className="td-brand-icon" />
                      <strong className="td-strong">{totalParejas}</strong> parejas
                    </span>
                    {totalZonas > 0 && (
                      <span className="td-meta-item">
                        <Layers size={15} />
                        <strong className="td-strong">{totalZonas}</strong> zonas
                      </span>
                    )}
                    {totalPartidos > 0 && (
                      <div className="td-progress">
                        <span className="td-progress-label">
                          <strong className="td-strong">{partidosFinalizados}</strong>/{totalPartidos} jugados
                        </span>
                        <div className="td-progress-track">
                          <div
                            className="td-progress-fill"
                            style={{
                              width: `${Math.round((partidosFinalizados / totalPartidos) * 100)}%`,
                            }}
                            role="progressbar"
                            aria-valuenow={partidosFinalizados}
                            aria-valuemin={0}
                            aria-valuemax={totalPartidos}
                            aria-label={`${partidosFinalizados} de ${totalPartidos} partidos jugados`}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="td-card-actions">
                  <Link
                    to={`/admin/torneos/${torneo.id}/categorias/${cat.id}`}
                    className="td-button td-category-action"
                  >
                    <Settings size={15} /> Administrar
                  </Link>

                  {cat.estado !== 'BORRADOR' && (
                    <Link
                      to={`/admin/torneos/${torneo.id}/categorias/${cat.id}/eliminatoria`}
                      className="td-button td-category-action"
                      title="Ver cuadro eliminatorio"
                    >
                      <GitBranch size={15} /> Cuadro
                    </Link>
                  )}

                  <button
                    type="button"
                    className="td-button td-delete"
                    title="Eliminar categoría"
                    aria-label={`Eliminar categoría ${cat.nombre}`}
                    onClick={() => setCategoriaAEliminar(cat)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal para editar fecha del torneo */}
      {editTorneoModalOpen && (
        <div className="pm-overlay">
          <div className="pm-modal td-date-modal" role="dialog" aria-modal="true" aria-labelledby="td-date-title">
            <div className="pm-header">
              <h2 id="td-date-title" className="pm-title td-modal-title">
                <Calendar size={20} className="td-brand-icon" /> Editar fecha del torneo
              </h2>
            </div>

            <form onSubmit={handleGuardarTorneo} className="td-modal-form">
              <div className="pm-body">
                {editTorneoError && (
                  <div className="pm-alert td-modal-alert" role="alert">
                    {editTorneoError}
                  </div>
                )}
                <div className="td-field">
                  <label className="td-label" htmlFor="td-edit-date">
                    Fecha de inicio (viernes)
                  </label>
                  <input
                    id="td-edit-date"
                    type="date"
                    value={editFecha}
                    onChange={(e) => setEditFecha(e.target.value)}
                    required
                    className="td-input"
                  />
                </div>
              </div>
              <div className="pm-footer">
                <button
                  type="button"
                  className="pm-button"
                  onClick={() => setEditTorneoModalOpen(false)}
                  disabled={guardandoTorneo}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="pm-button pm-primary"
                  disabled={guardandoTorneo}
                >
                  {guardandoTorneo ? 'Guardando…' : 'Guardar cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal para crear categoría */}
      {nuevaCatModalOpen && (
        <div className="pm-overlay">
          <div className="pm-modal td-category-modal" role="dialog" aria-modal="true" aria-labelledby="td-category-title">
            <div className="pm-header">
              <h2 id="td-category-title" className="pm-title td-modal-title">
                <Plus size={20} className="td-brand-icon" /> Nueva categoría
              </h2>
            </div>

            <form onSubmit={handleCrearCategoria} className="td-modal-form">
              <div className="pm-body">
                <div className="td-field">
                  <label className="td-label" htmlFor="td-new-category">
                    Nombre de la categoría:
                  </label>
                  <input
                    id="td-new-category"
                    type="text"
                    required
                    value={nombreNuevaCat}
                    onChange={(e) => setNombreNuevaCat(e.target.value)}
                    autoFocus
                    className="td-input"
                  />
                </div>
              </div>
              <div className="pm-footer">
                <button
                  type="button"
                  className="pm-button"
                  onClick={() => {
                    setNuevaCatModalOpen(false);
                    setNombreNuevaCat('');
                  }}
                  disabled={creandoCat}
                >
                  Cancelar
                </button>
                <button type="submit" className="pm-button pm-primary" disabled={creandoCat || !nombreNuevaCat.trim()}>
                  {creandoCat ? 'Creando…' : 'Crear categoría'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de confirmación para eliminar categoría */}
      <ConfirmModal
        isOpen={Boolean(categoriaAEliminar)}
        title="Eliminar Categoría"
        message={
          <>
            ¿Estás seguro de que querés eliminar la categoría{' '}
            <strong>"{categoriaAEliminar?.nombre}"</strong>?
            <br />
            <br />
            Se eliminarán sus parejas inscriptas, zonas y partidos.
          </>
        }
        confirmText="Eliminar Categoría"
        isDanger={true}
        isLoading={eliminandoCat}
        onConfirm={executeEliminarCategoria}
        onCancel={() => setCategoriaAEliminar(null)}
      />

      {/* Modal de confirmación para reiniciar torneo */}
      <ConfirmModal
        isOpen={reiniciarModalOpen}
        title="Reiniciar Torneo a Borrador"
        message={
          <>
            ¿Estás seguro de que querés reiniciar el torneo a <strong>BORRADOR</strong>?
            <br />
            <br />
            Se resetearán todas las zonas, partidos, llaves eliminatorias y horarios de todas las categorías. Las parejas y sus disponibilidades se mantendrán intactas.
          </>
        }
        confirmText="Sí, reiniciar torneo"
        isDanger={true}
        isLoading={reiniciando}
        onConfirm={executeReiniciarTorneo}
        onCancel={() => setReiniciarModalOpen(false)}
      />

    </div>
  );
}
