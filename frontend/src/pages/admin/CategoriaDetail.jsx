import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ChevronLeft,
  Users,
  GitBranch,
  RotateCcw,
  Settings,
  Trash2,
} from 'lucide-react';
import { api } from '../../api/client';
import ZonaTable from '../../components/ZonaTable';
import PartidoCard from '../../components/PartidoCard';
import MiniBracketView from '../../components/MiniBracketView';
import ResultadoModal from '../../components/ResultadoModal';
import ConfirmModal from '../../components/ConfirmModal';
import ZoneEditorModal from '../../components/ZoneEditorModal';
import AsignarHorarioModal from '../../components/AsignarHorarioModal';

export default function CategoriaDetail() {
  const { torneoId, id } = useParams();
  const navigate = useNavigate();

  const [categoria, setCategoria] = useState(null);
  const [zonas, setZonas] = useState([]);
  const [partidos, setPartidos] = useState([]);
  const [fasesEliminatorias, setFasesEliminatorias] = useState([]);
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
  const [zoneEditorOpen, setZoneEditorOpen] = useState(false);

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

  const handleUpdateFechaHora = async (partidoId, newTimeStr) => {
    try {
      if (!newTimeStr) {
        await api.put(`/partidos/${partidoId}/fecha-hora`, { fechaHora: null });
      } else {
        await api.put(`/partidos/${partidoId}/fecha-hora`, { fechaHora: new Date(newTimeStr).toISOString() });
      }
      fetchData();
    } catch (err) {
      alert(err.message || 'Error al actualizar horario');
    }
  };

  if (loading) return <div className="loading">Cargando categoría...</div>;
  if (error || !categoria) return <div className="error-message">{error || 'Categoría no encontrada'}</div>;

  const activeZona = zonas.find((z) => z.id === activeZonaId);
  const partidosDeZona = activeZona ? partidos.filter((p) => p.zonaId === activeZona.id) : [];

  return (
    <div className="page">
      {/* Breadcrumb de navegación */}
      <div style={{ marginBottom: '1rem' }}>
        <Link
          to={`/admin/torneos/${torneoId || categoria.torneoId}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            color: 'var(--color-text-secondary)',
            textDecoration: 'none',
            fontSize: 'var(--font-size-sm)',
          }}
        >
          <ChevronLeft size={16} /> Volver a {categoria.torneo?.nombre || 'Torneo'}
        </Link>
      </div>

      {/* Header de la Categoría */}
      <div className="card" style={{ marginBottom: '1.5rem', background: 'var(--color-surface-elevated)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <h1 style={{ margin: 0, fontSize: 'var(--font-size-2xl)' }}>
                Categoría {categoria.nombre}
              </h1>
              <span className={`badge badge-${categoria.estado.toLowerCase()}`}>{categoria.estado}</span>
            </div>

            <p style={{ margin: '0.4rem 0 0 0', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
              Torneo: <strong style={{ color: 'var(--color-text)' }}>{categoria.torneo?.nombre}</strong>
            </p>
          </div>

          {/* Acciones principales de la categoría */}
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            <Link
              to={`/admin/torneos/${torneoId || categoria.torneoId}/categorias/${id}/parejas`}
              className="btn-secondary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', width: 'auto', textDecoration: 'none' }}
            >
              <Users size={16} /> Parejas ({parejas.length})
            </Link>

            <Link
              to={`/admin/torneos/${torneoId || categoria.torneoId}/categorias/${id}/eliminatoria`}
              className="btn-secondary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', width: 'auto', textDecoration: 'none' }}
            >
              <GitBranch size={16} /> Fase Eliminatoria
            </Link>

            {categoria.estado !== 'BORRADOR' && (
              <>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setZoneEditorOpen(true)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', width: 'auto' }}
                  title="Reestructurar o mover parejas entre zonas"
                >
                  <Settings size={16} /> Modificar Zonas
                </button>

                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setLimpiarModalOpen(true)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', width: 'auto' }}
                >
                  <RotateCcw size={16} /> Limpiar Resultados
                </button>

                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setReiniciarModalOpen(true)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    width: 'auto',
                    borderColor: 'rgba(239, 68, 68, 0.4)',
                    color: 'var(--color-danger)',
                  }}
                >
                  <Trash2 size={16} /> Reiniciar Categoría
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Estado Borrador */}
      {categoria.estado === 'BORRADOR' && (
        <div className="card" style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
          <Users size={44} style={{ color: 'var(--color-primary)', marginBottom: '1rem', opacity: 0.8 }} />
          <h3 style={{ margin: '0 0 0.5rem 0' }}>Categoría en Borrador</h3>
          <p style={{ color: 'var(--color-text-secondary)', maxWidth: '540px', margin: '0 auto 1.5rem auto', lineHeight: '1.5' }}>
            {parejas.length < 2
              ? 'Cargá al menos 2 parejas con su disponibilidad para que esta categoría esté lista para el inicio del torneo.'
              : `Hay ${parejas.length} parejas inscriptas listas. El armado de zonas y la asignación global de turnos se realiza para todas las categorías juntas desde la pantalla principal del torneo.`}
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <Link
              to={`/admin/torneos/${torneoId || categoria.torneoId}/categorias/${id}/parejas`}
              className="btn-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', width: 'auto', textDecoration: 'none' }}
            >
              <Users size={16} /> Cargar Parejas y Disponibilidad
            </Link>
            <Link
              to={`/admin/torneos/${torneoId || categoria.torneoId}`}
              className="btn-secondary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', width: 'auto', textDecoration: 'none' }}
            >
              <ChevronLeft size={16} /> Volver al Torneo para Iniciar
            </Link>
          </div>
        </div>
      )}

      {/* Zonas y Partidos */}
      {categoria.estado !== 'BORRADOR' && (
        <>
          {/* Selector de Zonas */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
            {zonas.map((z) => (
              <button
                key={z.id}
                type="button"
                className={activeZonaId === z.id ? 'btn-primary' : 'btn-secondary'}
                onClick={() => setActiveZonaId(z.id)}
                style={{ width: 'auto', padding: '0.5rem 1rem' }}
              >
                {z.nombre}
              </button>
            ))}
          </div>

          {activeZona && (
            activeZona.formato === 'MINI_BRACKET' ? (
              <MiniBracketView
                zona={activeZona}
                partidos={partidosDeZona}
                onPartidoClick={(p) => setPartidoSeleccionado(p)}
                onUpdateFechaHora={handleUpdateFechaHora}
              />
            ) : (
              <div className="zona-grid">
                {/* Tabla de posiciones de la zona */}
                <div>
                  <h3 style={{ marginBottom: '1rem', fontSize: 'var(--font-size-lg)' }}>
                    Posiciones — {activeZona.nombre}
                  </h3>
                  <ZonaTable zona={activeZona} />
                </div>

                {/* Partidos de la zona */}
                <div>
                  <h3 style={{ marginBottom: '1rem', fontSize: 'var(--font-size-lg)' }}>
                    Partidos — {activeZona.nombre}
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {partidosDeZona.map((partido) => (
                      <PartidoCard
                        key={partido.id}
                        partido={partido}
                        onClick={() => setPartidoSeleccionado(partido)}
                        onCargarResultado={(p) => setPartidoSeleccionado(p)}
                        onUpdateFechaHora={handleUpdateFechaHora}
                        onReprogramar={setPartidoReprogramar}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )
          )}
        </>
      )}

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

      {/* Modal de Reestructuración de Zonas */}
      {zoneEditorOpen && (
        <ZoneEditorModal
          isOpen={zoneEditorOpen}
          categoriaId={id}
          zonas={zonas}
          parejas={parejas}
          onClose={() => setZoneEditorOpen(false)}
          onSuccess={() => {
            setZoneEditorOpen(false);
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
    </div>
  );
}

