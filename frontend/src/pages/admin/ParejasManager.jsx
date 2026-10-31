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
import { ChevronLeft, Plus, Clock, Trash2, Users, Info, AlertTriangle, Search, X, Link2, Phone } from 'lucide-react';

// El teléfono se guarda solo en dígitos; con código de país (54...) el link lleva "+"
function hrefTelefono(digitos) {
  return digitos.startsWith('54') && digitos.length >= 12 ? `tel:+${digitos}` : `tel:${digitos}`;
}

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

  if (loading) return <div className="pa-loading">Cargando parejas…</div>;
  if (error || !categoria) return <div className="pa-alert pa-load-error">{error || 'Categoría no encontrada'}</div>;

  const isBorrador = categoria.estado === 'BORRADOR';
  const backUrl = `/admin/torneos/${torneoId || categoria.torneoId}/categorias/${id}`;

  const renderFormularioAlta = () => (
    <div className="pa-card pa-add-card">
      <h2 className="pa-section-title">Agregar pareja</h2>
      <form onSubmit={handleAdd} className="pa-add-form">
        <div className="pa-field">
          <label htmlFor="pa-jugador1">Jugador 1</label>
          <input
            type="text"
            id="pa-jugador1"
            className="pa-input"
            value={jugador1}
            onChange={(e) => setJugador1(e.target.value)}
            placeholder="Nombre y apellido"
            required
          />
        </div>
        <div className="pa-field">
          <label htmlFor="pa-jugador2">Jugador 2</label>
          <input
            type="text"
            id="pa-jugador2"
            className="pa-input"
            value={jugador2}
            onChange={(e) => setJugador2(e.target.value)}
            placeholder="Nombre y apellido"
            required
          />
        </div>
        <button
          type="submit"
          className="pa-button pa-primary"
        >
          <Plus size={16} strokeWidth={2} />
          Agregar pareja
        </button>
      </form>
    </div>
  );

  const renderBannerInformativo = () => (
    <div className="pa-info">
      <Info size={16} className="pa-info-icon" />
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
    <div className="pa-card pa-list-card">
      <div className="pa-list-heading">
        <h2 className="pa-section-title">
          Parejas inscriptas ({busqueda.trim() || zonaFiltro !== 'todas' ? `${parejasFiltradas.length} de ${parejas.length}` : parejas.length})
        </h2>
        {categoria?.estado === 'EN_CURSO' && (
          <button
            type="button"
            onClick={() => setAgregarModalOpen(true)}
            className="pa-button pa-primary"
          >
            <Plus size={15} strokeWidth={2.5} />
            Agregar pareja a zona
          </button>
        )}
      </div>

      {mostrarFiltros && (
        <div className="pa-filters">
          <div className="pa-search">
            <Search size={16} className="pa-search-icon" aria-hidden="true" />
            <input
              type="text"
              className="pa-search-input"
              placeholder="Buscar por jugador o pareja…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              aria-label="Buscar pareja o jugador"
            />
            {busqueda && (
              <button
                type="button"
                className="pa-search-clear"
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
        <p className="pa-empty-copy">
          No hay parejas cargadas en esta categoría aún.
        </p>
      ) : parejasFiltradas.length === 0 ? (
        <div className="pa-empty">
          <p className="pa-empty-copy">
            Ninguna pareja coincide con los filtros aplicados.
          </p>
          <button
            type="button"
            onClick={() => {
              setBusqueda('');
              setZonaFiltro('todas');
            }}
            className="pa-button"
          >
            <X size={12} />
            Limpiar filtros
          </button>
        </div>
      ) : (
        <div className="pa-pair-list">
          {parejasFiltradas.map((pareja, index) => {
            const isExpanded = expandedParejaId === pareja.id;
            const cantSlots = pareja._cantSlots || 0;
            const isCritico = cantSlots > 0 && cantSlots < SLOTS_MINIMOS_PARTIDO;

            let textoDisponibilidad = '';
            let titleDisponibilidad = '';

            const porLink = pareja.origen === 'INSCRIPCION';
            if (cantSlots === 0 && isBorrador && porLink) {
              // Al inscribirse por link la disponibilidad es obligatoria: 0 slots es "cualquier horario"
              textoDisponibilidad = 'Cualquier horario';
              titleDisponibilidad = 'La pareja marcó "Puedo en cualquier horario" al inscribirse (clic para configurar)';
            } else if (cantSlots === 0) {
              textoDisponibilidad = isBorrador ? 'Sin horarios' : 'Libre';
              titleDisponibilidad = isBorrador
                ? 'Sin horarios cargados: puede jugar en cualquiera (clic para configurar)'
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
                className={`pa-pair${isExpanded ? ' is-expanded' : ''}`}
              >
                {/* Fila principal de la pareja */}
                <div className="pa-pair-row">
                  <div className="pa-pair-info">
                    <span className="pa-pair-number">
                      #{index + 1}
                    </span>
                    <span
                      className="pa-pair-names"
                      title={`${pareja.jugador1} / ${pareja.jugador2}`}
                    >
                      <span>{pareja.jugador1}</span>
                      <span>{pareja.jugador2}</span>
                    </span>
                  </div>

                  {/* Botones y chips de información */}
                  <div className="pa-pair-meta">
                    {!isBorrador && zonaNombre && (
                      <div className="pa-pair-chips">
                        <span className="pa-zone-chip">
                          {zonaNombre}
                        </span>

                        {partidosTotales > 0 && (
                          <span
                            className="pa-played-chip"
                            title={`${partidosJugados} de ${partidosTotales} partidos de zona disputados`}
                          >
                            {partidosJugados}/{partidosTotales} jugados
                          </span>
                        )}
                      </div>
                    )}

                    <div className="pa-pair-actions">
                      <button
                        type="button"
                        onClick={() => toggleDisponibilidad(pareja.id)}
                        className={`pa-button pa-hours${isExpanded ? ' is-expanded' : ''}${isCritico ? ' is-critical' : ''}`}
                        title={titleDisponibilidad}
                        aria-expanded={isExpanded}
                      >
                        {isCritico ? <AlertTriangle size={12} strokeWidth={2} /> : <Clock size={12} strokeWidth={2} />}
                        <span>{textoDisponibilidad}</span>
                      </button>

                      {isBorrador && (
                        <button
                          type="button"
                          onClick={() => handleDelete(pareja.id)}
                          className="pa-button pa-delete"
                          title="Eliminar pareja"
                          aria-label={`Eliminar pareja ${pareja.jugador1} / ${pareja.jugador2}`}
                        >
                          <Trash2 size={14} strokeWidth={2} className="pa-icon" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Origen y teléfono (inscripción por link) */}
                {(porLink || pareja.telefono) && (
                  <div className="pa-contact">
                    {porLink && (
                      <span className="pa-origin-chip" title="Se inscribió con el link público">
                        <Link2 size={11} aria-hidden="true" /> Por link
                      </span>
                    )}
                    {pareja.telefono && (
                      <a className="pa-phone" href={hrefTelefono(pareja.telefono)} title="Llamar">
                        <Phone size={11} aria-hidden="true" /> {pareja.telefono}
                      </a>
                    )}
                  </div>
                )}

                {/* Editor desplegable de disponibilidad */}
                {isExpanded && (
                  <div className="pa-availability pa-pair-availability">
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
    <div className="pa-screen">
      <div className="pa-header">
        <div>
          <Link
            to={backUrl}
            className="panel-back"
          >
            <ChevronLeft size={16} strokeWidth={2} />
            Volver a categoría {categoria.nombre}
          </Link>
          <h1 className="pa-title">
            <Users size={24} strokeWidth={2} />
            Parejas — {categoria.nombre}
          </h1>
          {categoria.torneo?.nombre && (
            <div className="pa-tournament">
              {categoria.torneo.nombre}
            </div>
          )}
        </div>
      </div>

      {cuadroDesactualizadoAviso && (
        <div className="pa-alert pa-bracket-alert">
          <div className="pa-alert-copy">
            <AlertTriangle size={18} className="pa-icon" />
            <span>El cuadro eliminatorio quedó desactualizado por el cambio en los clasificados de la zona.</span>
          </div>
          <Link
            to={`/admin/torneos/${torneoId || categoria?.torneoId}/categorias/${id}/eliminatoria`}
            className="pa-alert-link"
          >
            Ir al cuadro para sincronizarlo →
          </Link>
        </div>
      )}

      {isBorrador ? (
        <div className="pa-draft-layout">
          <div>
            {renderFormularioAlta()}
          </div>
          <div>
            {renderListaCard()}
          </div>
        </div>
      ) : (
        <div className="pa-started-layout">
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
        <div className="pa-toast">
          {toastMessage}
        </div>
      )}
    </div>
  );
}
