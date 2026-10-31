import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ChevronLeft,
  Users,
  GitBranch,
  Trash2,
  Eraser,
  ArrowRightLeft,
  UserPlus,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { api } from '../../api/client';
import { estadoLabel } from '../../utils/estadoLabels';
import ZonaTable from '../../components/ZonaTable';
import PartidoCard from '../../components/PartidoCard';
import ResultadoModal from '../../components/ResultadoModal';
import ConfirmModal from '../../components/ConfirmModal';
import AsignarHorarioModal from '../../components/AsignarHorarioModal';
import MoverParejaModal from '../../components/MoverParejaModal';
import AgregarParejaModal from '../../components/AgregarParejaModal';
import ActionsMenu from '../../components/ActionsMenu';

function ordenarPartidos(partidosList) {
  return [...partidosList].sort((a, b) => {
    const hasA = Boolean(a.fechaHora);
    const hasB = Boolean(b.fechaHora);

    if (hasA && !hasB) return -1;
    if (!hasA && hasB) return 1;

    if (hasA && hasB) {
      const diff = new Date(a.fechaHora).getTime() - new Date(b.fechaHora).getTime();
      if (diff !== 0) return diff;
    }

    return (a.posicionEnRonda ?? 0) - (b.posicionEnRonda ?? 0);
  });
}

export default function CategoriaDetail() {
  const { torneoId, id } = useParams();

  const [categoria, setCategoria] = useState(null);
  const [zonas, setZonas] = useState([]);
  const [cuadroDesactualizadoAviso, setCuadroDesactualizadoAviso] = useState(false);
  const [partidos, setPartidos] = useState([]);
  const [_fasesEliminatorias, setFasesEliminatorias] = useState([]);
  const [parejas, setParejas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [partidoSeleccionado, setPartidoSeleccionado] = useState(null);
  const [partidoReprogramar, setPartidoReprogramar] = useState(null);
  const [activeZonaId, setActiveZonaId] = useState(null);

  // Modales
  const [limpiarModalOpen, setLimpiarModalOpen] = useState(false);
  const [limpiandoZonas, setLimpiandoZonas] = useState(false);
  const [reiniciarModalOpen, setReiniciarModalOpen] = useState(false);
  const [reiniciando, setReiniciando] = useState(false);
  const [moverModalOpen, setMoverModalOpen] = useState(false);
  const [agregarModalOpen, setAgregarModalOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const cData = await api.get(`/categorias/${id}`);
      setCategoria(cData);

      const parejasBase = await api.get(`/categorias/${id}/parejas`);
      const parejasConSlots = await Promise.all(
        parejasBase.map(async (p) => {
          try {
            const slots = await api.get(`/parejas/${p.id}/disponibilidad`);
            return { ...p, _cantSlots: slots.length };
          } catch {
            return { ...p, _cantSlots: 0 };
          }
        })
      );
      setParejas(parejasConSlots);

      if (cData.estado !== 'BORRADOR') {
        const [zData, pData, fData] = await Promise.all([
          api.get(`/categorias/${id}/zonas`),
          api.get(`/categorias/${id}/partidos`),
          api.get(`/categorias/${id}/fases-eliminatorias`),
        ]);
        setZonas(zData);
        setPartidos(pData);
        setFasesEliminatorias(fData);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (zonas.length > 0) {
      const exists = zonas.find((z) => z.id === activeZonaId);
      if (!exists) {
        setActiveZonaId(zonas[0].id);
      }
    } else {
      setActiveZonaId(null);
    }
  }, [zonas, activeZonaId]);

  const handleLimpiarZonas = async () => {
    setLimpiandoZonas(true);
    try {
      await api.delete(`/categorias/${id}/zonas/resultados`);
      setLimpiarModalOpen(false);
      fetchData();
    } catch (err) {
      alert(err.message);
    } finally {
      setLimpiandoZonas(false);
    }
  };

  const handleReiniciar = async () => {
    setReiniciando(true);
    try {
      await api.post(`/categorias/${id}/reiniciar`);
      setReiniciarModalOpen(false);
      setZonas([]);
      setPartidos([]);
      setFasesEliminatorias([]);
      fetchData();
    } catch (err) {
      alert(err.message);
    } finally {
      setReiniciando(false);
    }
  };


  if (loading) return <div className="cd-page cd-loading">Cargando categoría…</div>;
  if (error || !categoria) return <div className="cd-page pm-alert">{error || 'Categoría no encontrada'}</div>;

  const activeZona = zonas.find((z) => z.id === activeZonaId);
  const partidosDeZona = activeZona ? partidos.filter((p) => p.zonaId === activeZona.id) : [];

  const partidosOrdenados = ordenarPartidos(partidosDeZona);

  return (
    <div className="cd-page">
      <div className="cd-screen">
      {/* Breadcrumb de navegación */}
      <div className="cd-back-row">
        <Link
          to={`/admin/torneos/${torneoId || categoria.torneoId}`}
          className="panel-back"
        >
          <ChevronLeft size={16} /> Volver a {categoria.torneo?.nombre || 'Torneo'}
        </Link>
      </div>

      {cuadroDesactualizadoAviso && (
        <div
          className="pm-alert cd-stale"
        >
          <div className="cd-notice-main">
            <AlertTriangle size={18} className="cd-alert-icon" />
            <span>El cuadro eliminatorio quedó desactualizado por el cambio en los clasificados de la zona.</span>
          </div>
          <Link
            to={`/admin/torneos/${torneoId || categoria?.torneoId}/categorias/${id}/eliminatoria`}
            className="cd-inline-link"
          >
            Ir al cuadro para sincronizarlo →
          </Link>
        </div>
      )}

      {/* Header de la Categoría */}
      <div className="cd-header-card">
        <div className="cd-heading">
          <div>
            <div className="cd-title-row">
              <h1 className="cd-title">
                Categoría {categoria.nombre}
              </h1>
              <span className="cd-state">{estadoLabel(categoria.estado)}</span>
            </div>

            <p className="cd-tournament">
              Torneo: <strong className="cd-strong">{categoria.torneo?.nombre}</strong>
            </p>
          </div>

          {/* Acciones principales de la categoría */}
          <div className="cd-header-actions">
            <Link
              to={`/admin/torneos/${torneoId || categoria.torneoId}/categorias/${id}/parejas`}
              className="pm-button pm-primary"
            >
              <Users size={16} /> Parejas ({parejas.length})
            </Link>

            {categoria.estado !== 'BORRADOR' && (
              <Link
                to={`/admin/torneos/${torneoId || categoria.torneoId}/categorias/${id}/eliminatoria`}
                className="pm-button"
              >
                <GitBranch size={16} /> Cuadro
              </Link>
            )}

            {categoria.estado !== 'BORRADOR' && (
              <ActionsMenu>
                {categoria.estado === 'EN_CURSO' && (
                  <>
                    <button
                      type="button"
                      className="actions-menu-item"
                      role="menuitem"
                      onClick={() => setMoverModalOpen(true)}
                    >
                      <ArrowRightLeft size={15} /> Mover pareja de zona
                    </button>
                    <button
                      type="button"
                      className="actions-menu-item"
                      role="menuitem"
                      onClick={() => setAgregarModalOpen(true)}
                    >
                      <UserPlus size={15} /> Agregar pareja a zona
                    </button>
                    <div className="cd-menu-divider" />
                  </>
                )}
                <button
                  type="button"
                  className="actions-menu-item"
                  role="menuitem"
                  onClick={() => setLimpiarModalOpen(true)}
                >
                  <Eraser size={15} /> Limpiar resultados
                </button>
                <button
                  type="button"
                  className="actions-menu-item danger"
                  role="menuitem"
                  onClick={() => setReiniciarModalOpen(true)}
                >
                  <Trash2 size={15} /> Reiniciar categoría
                </button>
              </ActionsMenu>
            )}
          </div>
        </div>
      </div>

      {/* Estado Borrador */}
      {categoria.estado === 'BORRADOR' && (
        <div className="cd-empty">
          <Users size={44} className="cd-empty-icon" />
          <h3 className="cd-empty-title">Categoría en borrador</h3>
          <p className="cd-empty-copy">
            {parejas.length < 2
              ? 'Cargá al menos 2 parejas con su disponibilidad. El torneo se inicia desde su pantalla.'
              : `${parejas.length} parejas listas. El torneo se inicia desde su pantalla.`}
          </p>
        </div>
      )}

      {/* Zonas y Partidos */}
      {categoria.estado !== 'BORRADOR' && (
        <>
          {/* Selector de Zonas */}
          <div className="cd-zone-tabs">
            {zonas.map((z) => (
              <button
                key={z.id}
                type="button"

                onClick={() => setActiveZonaId(z.id)}
                className={`cd-zone-tab${activeZonaId === z.id ? ' is-active' : ''}`}
                aria-pressed={activeZonaId === z.id}
              >
                {z.nombre}
              </button>
            ))}
          </div>

          {activeZona && (
            <div className="cd-zones-grid">
              {/* Tabla de posiciones de la zona */}
              <div>
                <ZonaTable zona={activeZona} />
              </div>

              {/* Partidos de la zona */}
              <div>
                <div className="cd-match-list">
                  {partidosOrdenados.map((partido) => (
                    <PartidoCard
                      key={partido.id}
                      partido={partido}
                      onClick={() => setPartidoSeleccionado(partido)}
                      onCargarResultado={(p) => setPartidoSeleccionado(p)}
                      onReprogramar={setPartidoReprogramar}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      </div>

      {/* Modal para Cargar/Editar Resultado */}
      {partidoSeleccionado && (
        <ResultadoModal
          partido={partidoSeleccionado}
          isOpen={Boolean(partidoSeleccionado)}
          onClose={() => setPartidoSeleccionado(null)}
          onSuccess={() => {
            setPartidoSeleccionado(null);
            fetchData();
          }}
        />
      )}

      {/* Modal para Reprogramar Horario */}
      {partidoReprogramar && (
        <AsignarHorarioModal
          isOpen={!!partidoReprogramar}
          partido={partidoReprogramar}
          torneoId={torneoId}
          onClose={() => setPartidoReprogramar(null)}
          onAssigned={() => {
            setPartidoReprogramar(null);
            fetchData();
          }}
        />
      )}

      {/* Modal de confirmación para limpiar resultados */}
      <ConfirmModal
        isOpen={limpiarModalOpen}
        title="Limpiar Resultados de Zonas"
        message="¿Estás seguro de que querés resetear todos los resultados de las zonas? Las llaves eliminatorias también se eliminarán."
        confirmText="Sí, limpiar resultados"
        isDanger={true}
        isLoading={limpiandoZonas}
        onConfirm={handleLimpiarZonas}
        onCancel={() => setLimpiarModalOpen(false)}
      />

      {/* Modal de confirmación para reiniciar categoría */}
      <ConfirmModal
        isOpen={reiniciarModalOpen}
        title="Reiniciar Categoría a Borrador"
        message="¿Estás seguro de que querés reiniciar esta categoría a BORRADOR? Se eliminarán todas las zonas, partidos y eliminatorias de la categoría."
        confirmText="Sí, reiniciar categoría"
        isDanger={true}
        isLoading={reiniciando}
        onConfirm={handleReiniciar}
        onCancel={() => setReiniciarModalOpen(false)}
      />

      {/* Modal de Mover Pareja de Zona */}
      <MoverParejaModal
        isOpen={moverModalOpen}
        onClose={() => setMoverModalOpen(false)}
        categoriaId={id}
        zonas={zonas}
        partidos={partidos}
        onSuccess={(msg, res) => {
          fetchData();
          if (res?.cuadroDesactualizado) {
            setCuadroDesactualizadoAviso(true);
          }
          setToastMessage(msg);
          setTimeout(() => setToastMessage(''), 5000);
        }}
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
          setToastMessage(msg);
          setTimeout(() => setToastMessage(''), 5000);
        }}
      />

      {/* Toast Notification */}
      {toastMessage && (
        <div
          className="cd-toast"
        >
          <CheckCircle2 size={18} className="cd-brand-icon" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}

