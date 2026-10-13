import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { api } from '../../api/client';
import ConfirmModal from '../../components/ConfirmModal';
import DisponibilidadEditor from '../../components/DisponibilidadEditor';
import AgregarParejaModal from '../../components/AgregarParejaModal';
import ZonaDropdownFilter from '../../components/ZonaDropdownFilter';
import { estadoLabel } from '../../utils/estadoLabels';
import { formatHorasDisponibles } from '../../utils/dateUtils';
import { normalizeText } from '../../utils/textUtils';
import { ChevronLeft, Plus, Clock, Trash2, Users, Info, AlertTriangle, Search, X } from 'lucide-react';

const DURACION_PARTIDO_MIN = 75;
const MINUTOS_POR_SLOT = 15;
const SLOTS_MINIMOS_PARTIDO = Math.ceil(DURACION_PARTIDO_MIN / MINUTOS_POR_SLOT); // 5 turnos de 15m
const UMBRAL_BUSCADOR_PAREJAS = 8;

export default function ParejasManager() {
  const { torneoId, id } = useParams();
  const [searchParams] = useSearchParams();
  const queryParejaId = searchParams.get('parejaId');

  const [categoria, setCategoria] = useState(null);
  const [zonas, setZonas] = useState([]);
  const [partidos, setPartidos] = useState([]);
  const [parejas, setParejas] = useState([]);
  const [busqueda, setBusqueda] = useState('');
  const [zonaFiltro, setZonaFiltro] = useState('todas');
  const [jugador1, setJugador1] = useState('');
  const [jugador2, setJugador2] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [parejaToDelete, setParejaToDelete] = useState(null);
  const [expandedParejaId, setExpandedParejaId] = useState(queryParejaId || null);
  const [agregarModalOpen, setAgregarModalOpen] = useState(false);
  const [cuadroDesactualizadoAviso, setCuadroDesactualizadoAviso] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  useEffect(() => {
    if (queryParejaId) {
      setExpandedParejaId(queryParejaId);
    }
  }, [queryParejaId]);

  const fetchData = useCallback(async () => {
    try {
      const [categoriaData, parejasData] = await Promise.all([
        api.get(`/categorias/${id}`),
        api.get(`/categorias/${id}/parejas`),
      ]);
      setCategoria(categoriaData);

      let zonasData = [];
      let partidosData = [];
      if (categoriaData.estado !== 'BORRADOR') {
        const [zData, pData] = await Promise.all([
          api.get(`/categorias/${id}/zonas`),
          api.get(`/categorias/${id}/partidos`),
        ]);
        zonasData = zData || [];
        partidosData = pData || [];
      }
      setZonas(zonasData);
      setPartidos(partidosData);

      // Cargar disponibilidades de cada pareja para mostrar el badge
      const parejasConSlots = await Promise.all(
        parejasData.map(async (p) => {
          try {
            const slots = await api.get(`/parejas/${p.id}/disponibilidad`);
            return { ...p, _cantSlots: slots.length };
          } catch {
            return { ...p, _cantSlots: 0 };
          }
        })
      );
      setParejas(parejasConSlots);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();

    // Refetch al enfocar la ventana para sincronizar si se cambió la jornada en otra pestaña
    const onFocus = () => fetchData();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [fetchData]);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (categoria?.estado !== 'BORRADOR') return;
    try {
      await api.post(`/categorias/${id}/parejas`, { jugador1, jugador2 });
      setJugador1('');
      setJugador2('');
      fetchData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDelete = (parejaId) => {
    if (categoria?.estado !== 'BORRADOR') return;
    setParejaToDelete(parejaId);
  };

  const executeDelete = async () => {
    if (!parejaToDelete || categoria?.estado !== 'BORRADOR') return;
    try {
      await api.delete(`/parejas/${parejaToDelete}`);
      setParejaToDelete(null);
      fetchData();
    } catch (err) {
      alert(err.message);
    }
  };

  const toggleDisponibilidad = (parejaId) => {
    setExpandedParejaId((prev) => (prev === parejaId ? null : parejaId));
  };

  const handleSlotsChanged = (parejaId, cantSlots) => {
    setParejas((prev) =>
      prev.map((p) => (p.id === parejaId ? { ...p, _cantSlots: cantSlots } : p))
    );
  };

  const parejasFiltradas = useMemo(() => {
    const q = normalizeText(busqueda);
    return parejas.filter((p) => {
      if (zonaFiltro !== 'todas') {
        const pZonaId = p.zonaParejas?.[0]?.zonaId || p.zonaParejas?.[0]?.zona?.id;
        if (pZonaId !== zonaFiltro) return false;
      }
      if (!q) return true;
      const j1 = p.jugador1 || '';
      const j2 = p.jugador2 || '';
      return (
        normalizeText(j1).includes(q) ||
        normalizeText(j2).includes(q) ||
        normalizeText(`${j1} ${j2}`).includes(q) ||
        normalizeText(`${j2} ${j1}`).includes(q)
      );
    });
  }, [parejas, busqueda, zonaFiltro]);

  const mostrarFiltros = parejas.length > 0 && (parejas.length > UMBRAL_BUSCADOR_PAREJAS || zonas.length > 0);

  if (loading) return <div className="loading">Cargando parejas...</div>;
  if (error || !categoria) return <div className="error-message">{error || 'Categoría no encontrada'}</div>;

  const isBorrador = categoria.estado === 'BORRADOR';
  const backUrl = `/admin/torneos/${torneoId || categoria.torneoId}/categorias/${id}`;

  const renderFormularioAlta = () => (
    <div className="torneo-card">
      <h3>Agregar Pareja</h3>
      <form onSubmit={handleAdd} style={{ marginTop: '1rem' }}>
        <div className="form-group">
          <label>Jugador 1</label>
          <input
            type="text"
            value={jugador1}
            onChange={(e) => setJugador1(e.target.value)}
            placeholder="Nombre y apellido"
            required
          />
        </div>
        <div className="form-group">
          <label>Jugador 2</label>
          <input
            type="text"
            value={jugador2}
            onChange={(e) => setJugador2(e.target.value)}
            placeholder="Nombre y apellido"
            required
          />
        </div>
        <button
          type="submit"
          className="btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
        >
          <Plus size={16} strokeWidth={2} />
          Añadir Pareja
        </button>
      </form>
    </div>
  );

  const renderBannerInformativo = () => (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: '0.65rem 0.9rem',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.6rem',
        fontSize: 'var(--font-size-xs)',
        color: 'var(--color-text-secondary)',
        lineHeight: 1.5,
      }}
    >
      <Info size={16} style={{ color: 'var(--color-primary)', flexShrink: 0, marginTop: '2px' }} />
      <div>
        {categoria.estado === 'EN_CURSO' ? (
          <span>
            Con el torneo en curso no se pueden eliminar parejas. Para sumar una nueva pareja a una zona, usá el botón <strong>«Agregar pareja a zona»</strong>.
          </span>
        ) : categoria.estado === 'FINALIZADO' ? (
          <span>
            Esta categoría está finalizada. El listado de parejas y sus datos se encuentran en modo solo lectura.
          </span>
        ) : (
          <span>
            Categoría en estado <strong>{estadoLabel(categoria.estado)}</strong>. El listado de parejas se encuentra en modo solo lectura.
          </span>
        )}
      </div>
    </div>
  );

  const renderListaCard = () => (
    <div className="torneo-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h3 style={{ margin: 0 }}>
          Parejas Inscriptas ({busqueda.trim() || zonaFiltro !== 'todas' ? `${parejasFiltradas.length} de ${parejas.length}` : parejas.length})
        </h3>
        {categoria?.estado === 'EN_CURSO' && (
          <button
            type="button"
            className="btn-primary"
            onClick={() => setAgregarModalOpen(true)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              fontSize: 'var(--font-size-xs)',
              padding: '0.4rem 0.75rem',
            }}
          >
            <Plus size={15} strokeWidth={2.5} />
            Agregar pareja a zona
          </button>
        )}
      </div>

      {mostrarFiltros && (
        <div
          style={{
            marginBottom: '1rem',
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            flexWrap: 'wrap',
          }}
        >
          <div className="public-search-box" style={{ flex: '1 1 200px', minWidth: '180px' }}>
            <Search size={16} className="public-search-icon" aria-hidden="true" />
            <input
              type="text"
              className="public-search-input"
              placeholder="Buscar por jugador o pareja..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              aria-label="Buscar pareja o jugador"
            />
            {busqueda && (
              <button
                type="button"
                className="public-search-clear"
                onClick={() => setBusqueda('')}
                aria-label="Limpiar búsqueda"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {zonas.length > 0 && (
            <ZonaDropdownFilter
              zonas={zonas}
              selectedZonaId={zonaFiltro}
              onSelectZona={setZonaFiltro}
            />
          )}
        </div>
      )}

      {parejas.length === 0 ? (
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
          No hay parejas cargadas en esta categoría aún.
        </p>
      ) : parejasFiltradas.length === 0 ? (
        <div
          style={{
            padding: '1.5rem 1rem',
            textAlign: 'center',
            background: 'var(--color-bg)',
            borderRadius: 'var(--radius-md)',
            border: '1px dashed var(--color-border)',
          }}
        >
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', margin: '0 0 0.5rem 0' }}>
            Ninguna pareja coincide con los filtros aplicados.
          </p>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setBusqueda('');
              setZonaFiltro('todas');
            }}
            style={{
              fontSize: 'var(--font-size-xs)',
              padding: '0.35rem 0.75rem',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              margin: '0 auto',
            }}
          >
            <X size={12} />
            Limpiar filtros
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {parejasFiltradas.map((pareja, index) => {
            const isExpanded = expandedParejaId === pareja.id;
            const cantSlots = pareja._cantSlots || 0;
            const isCritico = cantSlots > 0 && cantSlots < SLOTS_MINIMOS_PARTIDO;

            let textoDisponibilidad = '';
            let titleDisponibilidad = '';

            if (cantSlots === 0) {
              textoDisponibilidad = isBorrador ? 'Sin cargar' : 'Libre';
              titleDisponibilidad = isBorrador
                ? 'Sin disponibilidad cargada (clic para configurar)'
                : 'Sin restricción de horario (disponible para todo el torneo)';
            } else {
              textoDisponibilidad = formatHorasDisponibles(cantSlots);
              titleDisponibilidad = isCritico
                ? `${textoDisponibilidad} disponibles · Disponibilidad insuficiente para un partido (mínimo 75 min)`
                : `${textoDisponibilidad} disponibles (${isBorrador ? 'clic para configurar' : 'clic para ver'})`;
            }

            const zp = pareja.zonaParejas?.[0];
            const zonaNombre = zp?.zona?.nombre;
            const formatoZona = zp?.zona?.formato;
            const partidosZona = zp?.zona?.partidos?.filter(
              (p) => p.pareja1Id === pareja.id || p.pareja2Id === pareja.id
            ) || [];
            const partidosJugados = zp?.pj ?? partidosZona.filter((p) => p.estado === 'FINALIZADO').length;

            let partidosTotales = 0;
            if (formatoZona === 'MINI_BRACKET') {
              partidosTotales = 2;
            } else if (formatoZona === 'ROUND_ROBIN') {
              const cantParejas = zp?.zona?._count?.zonaParejas || (zp?.zona?.partidos?.length === 1 ? 2 : 3);
              partidosTotales = Math.max(1, cantParejas - 1);
            } else {
              partidosTotales = partidosZona.length;
            }

            return (
              <div
                key={pareja.id}
                style={{
                  background: 'var(--color-surface)',
                  border: isExpanded
                    ? '1px solid var(--color-primary)'
                    : '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  overflow: 'hidden',
                  transition: 'border-color var(--transition-fast)',
                }}
              >
                {/* Fila principal de la pareja */}
                <div className="pareja-list-row">
                  <div className="pareja-list-info">
                    <span
                      style={{
                        color: 'var(--color-text-secondary)',
                        fontSize: 'var(--font-size-xs)',
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      #{index + 1}
                    </span>
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--color-text)',
                        minWidth: 0,
                        wordBreak: 'break-word',
                        lineHeight: 1.35,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                      title={`${pareja.jugador1} / ${pareja.jugador2}`}
                    >
                      {pareja.jugador1} / {pareja.jugador2}
                    </span>
                  </div>

                  {/* Botones y chips de información */}
                  <div className="pareja-chips-wrap">
                    {!isBorrador && zonaNombre && (
                      <div className="pareja-chips-fila1">
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            fontSize: '11px',
                            fontWeight: 600,
                            color: 'var(--color-text-secondary)',
                            background: 'rgba(255, 255, 255, 0.05)',
                            border: '1px solid rgba(255, 255, 255, 0.08)',
                            borderRadius: '4px',
                            padding: '2px 6px',
                            letterSpacing: '0.3px',
                            lineHeight: 1.4,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {zonaNombre}
                        </span>

                        {partidosTotales > 0 && (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              fontSize: '11px',
                              fontWeight: 500,
                              color: 'var(--color-text-secondary)',
                              background: 'rgba(255, 255, 255, 0.03)',
                              border: '1px solid rgba(255, 255, 255, 0.06)',
                              borderRadius: '4px',
                              padding: '2px 6px',
                              lineHeight: 1.4,
                              whiteSpace: 'nowrap',
                            }}
                            title={`${partidosJugados} de ${partidosTotales} partidos de zona disputados`}
                          >
                            {partidosJugados}/{partidosTotales} jugados
                          </span>
                        )}
                      </div>
                    )}

                    <div className="pareja-chips-fila2">
                      <button
                        type="button"
                        onClick={() => toggleDisponibilidad(pareja.id)}
                        className={isExpanded ? 'btn-primary' : 'btn-secondary'}
                        style={{
                          padding: '0.3rem 0.65rem',
                          fontSize: 'var(--font-size-xs)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          width: 'auto',
                          cursor: 'pointer',
                          ...(isCritico && !isExpanded
                            ? {
                                background: 'var(--color-warning-bg)',
                                borderColor: 'var(--color-warning-border)',
                                color: 'var(--color-warning)',
                                fontWeight: 600,
                              }
                            : {}),
                        }}
                        title={titleDisponibilidad}
                      >
                        {isCritico ? <AlertTriangle size={12} strokeWidth={2} /> : <Clock size={12} strokeWidth={2} />}
                        <span>{textoDisponibilidad}</span>
                      </button>

                      {isBorrador && (
                        <button
                          type="button"
                          className="btn-danger"
                          onClick={() => handleDelete(pareja.id)}
                          style={{
                            padding: '0.3rem 0.5rem',
                            background: 'transparent',
                            borderColor: 'transparent',
                          }}
                          title="Eliminar pareja"
                        >
                          <Trash2 size={14} strokeWidth={2} style={{ color: 'var(--color-danger)' }} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Editor desplegable de disponibilidad */}
                {isExpanded && (
                  <div
                    style={{
                      borderTop: '1px solid var(--color-border)',
                      background: 'var(--color-bg)',
                      padding: '1rem',
                    }}
                  >
                    <DisponibilidadEditor
                      parejaId={pareja.id}
                      categoriaEstado={categoria.estado}
                      onSlotsChanged={(count) => handleSlotsChanged(pareja.id, count)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <div className="page">
      <div className="flex-header">
        <div>
          <Link
            to={backUrl}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text-secondary)',
              textDecoration: 'none',
            }}
          >
            <ChevronLeft size={14} strokeWidth={2} />
            Volver a Categoría {categoria.nombre}
          </Link>
          <h1 style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Users size={24} strokeWidth={2} />
            Parejas — {categoria.nombre}
          </h1>
          {categoria.torneo?.nombre && (
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginTop: '0.2rem' }}>
              {categoria.torneo.nombre}
            </div>
          )}
        </div>
      </div>

      {cuadroDesactualizadoAviso && (
        <div
          style={{
            background: 'rgba(234, 179, 8, 0.15)',
            border: '1px solid rgba(234, 179, 8, 0.5)',
            color: 'var(--color-text, #fff)',
            padding: '0.85rem 1.25rem',
            borderRadius: 'var(--radius-md, 8px)',
            marginTop: '1rem',
            marginBottom: '0.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <AlertTriangle size={18} color="#eab308" />
            <span>El cuadro eliminatorio quedó desactualizado por el cambio en los clasificados de la zona.</span>
          </div>
          <Link
            to={`/admin/torneos/${torneoId || categoria?.torneoId}/categorias/${id}/eliminatoria`}
            style={{
              color: 'var(--color-primary, #00d084)',
              fontWeight: 600,
              textDecoration: 'underline',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
            }}
          >
            Ir al cuadro para sincronizarlo →
          </Link>
        </div>
      )}

      {isBorrador ? (
        <div className="manager-grid" style={{ marginTop: '1.5rem' }}>
          <div>
            {renderFormularioAlta()}
          </div>
          <div>
            {renderListaCard()}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.5rem', width: '100%' }}>
          {renderBannerInformativo()}
          {renderListaCard()}
        </div>
      )}

      <ConfirmModal
        isOpen={Boolean(parejaToDelete)}
        title="Eliminar Pareja"
        message="¿Estás seguro de que querés eliminar esta pareja de la categoría?"
        confirmText="Eliminar"
        isDanger={true}
        onConfirm={executeDelete}
        onCancel={() => setParejaToDelete(null)}
      />

      {/* Modal de Agregar Pareja a Zona */}
      <AgregarParejaModal
        isOpen={agregarModalOpen}
        onClose={() => setAgregarModalOpen(false)}
        categoriaId={id}
        zonas={zonas}
        partidos={partidos}
        onSuccess={(msg, res) => {
          fetchData();
          if (res?.cuadroDesactualizado) {
            setCuadroDesactualizadoAviso(true);
          }
          if (msg) {
            setToastMessage(msg);
            setTimeout(() => setToastMessage(''), 5000);
          }
        }}
      />

      {/* Toast Notification */}
      {toastMessage && (
        <div
          style={{
            position: 'fixed',
            bottom: '2rem',
            right: '2rem',
            backgroundColor: 'var(--color-primary)',
            color: '#000',
            padding: '0.75rem 1.25rem',
            borderRadius: 'var(--radius-md)',
            fontWeight: 600,
            boxShadow: 'var(--shadow-lg)',
            zIndex: 1000,
          }}
        >
          {toastMessage}
        </div>
      )}
    </div>
  );
}
