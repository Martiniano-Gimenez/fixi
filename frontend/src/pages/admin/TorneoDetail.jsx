import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import { GitBranch, Users, Building2, Trash2, Play, Calendar, RotateCcw, Settings, Copy, Check } from 'lucide-react';
import { api } from '../../api/client';
import ZonaTable from '../../components/ZonaTable';
import PartidoCard from '../../components/PartidoCard';
import ResultadoModal from '../../components/ResultadoModal';
import ConfirmModal from '../../components/ConfirmModal';
import ZoneEditorModal from '../../components/ZoneEditorModal';
import InicioDisponibilidadModal from '../../components/InicioDisponibilidadModal';

export default function TorneoDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [torneo, setTorneo] = useState(null);
  const [zonas, setZonas] = useState([]);
  const [partidos, setPartidos] = useState([]);
  const [fasesEliminatorias, setFasesEliminatorias] = useState([]);
  const [parejas, setParejas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [partidoSeleccionado, setPartidoSeleccionado] = useState(null);
  const [toast, setToast] = useState('');
  const [activeZonaId, setActiveZonaId] = useState(null);
  const [alertModalOpen, setAlertModalOpen] = useState(false);
  const [limpiarModalOpen, setLimpiarModalOpen] = useState(false);
  const [limpiandoZonas, setLimpiandoZonas] = useState(false);
  const [reiniciarModalOpen, setReiniciarModalOpen] = useState(false);
  const [eliminarModalOpen, setEliminarModalOpen] = useState(false);
  const [iniciarModalOpen, setIniciarModalOpen] = useState(false);

  const [zoneEditorOpen, setZoneEditorOpen] = useState(false);
  const [inicioDisponibilidadOpen, setInicioDisponibilidadOpen] = useState(false);
  const [copiado, setCopiado] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const tData = await api.get(`/torneos/${id}`);
      setTorneo(tData);

      // Siempre cargar parejas con su conteo de slots
      const parejasBase = await api.get(`/torneos/${id}/parejas`);
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

      if (tData.estado !== 'BORRADOR') {
        const [zData, pData, fData] = await Promise.all([
          api.get(`/torneos/${id}/zonas`),
          api.get(`/torneos/${id}/partidos`),
          api.get(`/torneos/${id}/fases-eliminatorias`),
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

  const executeIniciar = async () => {
    setIniciarModalOpen(false);
    try {
      setLoading(true);
      await api.post(`/torneos/${id}/iniciar`);
      fetchData();
    } catch (err) {
      alert(err.message);
      setLoading(false);
    }
  };

  const executeReiniciar = async () => {
    setReiniciarModalOpen(false);
    try {
      setLoading(true);
      await api.post(`/torneos/${id}/reiniciar`);
      fetchData();
      setToast('✅ Torneo reiniciado a estado BORRADOR');
      setTimeout(() => setToast(''), 3000);
    } catch (err) {
      alert(err.message || 'Error al reiniciar torneo');
    } finally {
      setLoading(false);
    }
  };

  const executeEliminarTorneo = async () => {
    setEliminarModalOpen(false);
    try {
      setLoading(true);
      await api.delete(`/torneos/${id}`);
      navigate('/admin');
    } catch (err) {
      alert(err.message || 'Error al eliminar torneo');
      setLoading(false);
    }
  };

  const handleLimpiarZonas = async () => {
    setLimpiandoZonas(true);
    try {
      await api.delete(`/torneos/${id}/zonas/resultados`);
      setLimpiarModalOpen(false);
      fetchData();
      setToast('✅ Resultados de zonas limpiados');
      setTimeout(() => setToast(''), 3000);
    } catch (err) {
      alert(err.message || 'Error al limpiar zonas');
    } finally {
      setLimpiandoZonas(false);
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

  const getPartidosZona = (zonaId) => partidos.filter((p) => p.zonaId === zonaId);

  if (loading) return <div className="loading">Cargando torneo...</div>;
  if (error) return <div className="error-message">{error}</div>;
  if (!torneo) return null;

  const org = torneo.organizador || {};
  const tieneJornada = org.viernesInicio || org.sabadoInicio;

  return (
    <div className="page">
      <div className="flex-header">
        <div>
          <h1>{torneo.nombre}</h1>
          <div style={{ marginTop: '0.5rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <span className={`badge badge-${torneo.estado.toLowerCase()}`}>{torneo.estado}</span>
            <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              📡 En vivo: <a href={`/torneo/${torneo.slug}`} target="_blank" rel="noreferrer">/torneo/{torneo.slug}</a>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  navigator.clipboard.writeText(`${window.location.origin}/torneo/${torneo.slug}`);
                  setCopiado(true);
                  setTimeout(() => setCopiado(false), 1500);
                }}
                style={{
                  fontSize: 'var(--font-size-xs)',
                  padding: '0.2rem 0.5rem',
                  background: 'var(--color-bg-input)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--color-text-secondary)',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                }}
              >
                {copiado ? (
                  <>
                    <Check size={12} strokeWidth={2} style={{ color: 'var(--color-success)' }} />
                    Copiado
                  </>
                ) : (
                  <>
                    <Copy size={12} strokeWidth={2} />
                    Copiar
                  </>
                )}
              </button>
            </span>
          </div>
        </div>

        {torneo.estado === 'BORRADOR' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-end' }}>
            <button
              onClick={() => setIniciarModalOpen(true)}
              className="btn-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', width: 'auto', marginTop: 0 }}
            >
              <Play size={14} strokeWidth={2} />
              Iniciar Torneo (Sorteo)
            </button>
            <button
              type="button"
              onClick={() => {
                const conSlots = parejas.filter((p) => (p._cantSlots || 0) > 0);
                if (conSlots.length === 0 && parejas.length > 0) {
                  alert('Ninguna pareja tiene horarios seleccionados. Cargalos desde "Gestionar Parejas" o usá el inicio por sorteo.');
                  return;
                }
                setInicioDisponibilidadOpen(true);
              }}
              className="btn-secondary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', width: 'auto', marginTop: 0, fontSize: 'var(--font-size-sm)' }}
            >
              <Calendar size={14} strokeWidth={2} />
              Iniciar por disponibilidad
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={() => setLimpiarModalOpen(true)}
              disabled={limpiandoZonas}
              style={{
                background: 'transparent',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: 'var(--color-danger)',
                padding: '0.5rem 1rem',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--font-size-sm)',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
              }}
            >
              <Trash2 size={14} strokeWidth={2} />
              {limpiandoZonas ? 'Limpiando...' : 'Limpiar Zonas'}
            </button>
            <button
              onClick={() => setReiniciarModalOpen(true)}
              style={{
                background: 'transparent',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: 'var(--color-danger)',
                padding: '0.5rem 1rem',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--font-size-sm)',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
              }}
              title="Borra TODO el fixture y resultados, y vuelve el torneo a estado Borrador"
            >
              <RotateCcw size={14} strokeWidth={2} />
              Reiniciar Torneo
            </button>
            <button
              onClick={() => setZoneEditorOpen(true)}
              className="btn-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', width: 'auto', marginTop: 0, padding: '0.5rem 1.25rem' }}
            >
              <Settings size={14} strokeWidth={2} />
              Editar Zonas
            </button>
          </div>
        )}
      </div>

      <div className="torneo-dashboard dashboard-grid">
        <div className="sidebar">
          <div className="torneo-card">
            <h3>Menú</h3>
            <nav className="sidebar-nav">
              <Link
                to={`/admin/torneos/${id}/eliminatoria`}
                className={`sidebar-nav-item${location.pathname === `/admin/torneos/${id}/eliminatoria` ? ' active' : ''}`}
              >
                <GitBranch size={16} strokeWidth={2} />
                Fase Eliminatoria {torneo.estado === 'BORRADOR' && '(Pronto)'}
              </Link>

              <Link
                to={`/admin/torneos/${id}/parejas`}
                className={`sidebar-nav-item${location.pathname === `/admin/torneos/${id}/parejas` ? ' active' : ''}`}
              >
                <Users size={16} strokeWidth={2} />
                Gestionar Parejas ({parejas.length})
              </Link>

              <Link
                to="/admin/club"
                className={`sidebar-nav-item${location.pathname === '/admin/club' ? ' active' : ''}`}
              >
                <Building2 size={16} strokeWidth={2} />
                Configuración del Club
              </Link>

              <hr className="sidebar-nav-divider" />

              <button
                type="button"
                className="sidebar-nav-item danger"
                onClick={() => setEliminarModalOpen(true)}
              >
                <Trash2 size={16} strokeWidth={2} />
                Eliminar Torneo
              </button>
            </nav>
          </div>
        </div>

        <div className="main-content">
          {torneo.estado === 'BORRADOR' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {/* Card de información */}
              <div className="torneo-card">
                <h2>Torneo en Preparación</h2>
                <p style={{ marginTop: '0.75rem', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                  Actualmente tenés <strong>{parejas.length}</strong> parejas inscritas en esta categoría.
                </p>
              </div>

              {/* Card informativa de Canchas y Horarios del Club (Solo lectura) */}
              <div className="torneo-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div>
                    <h3 style={{ margin: 0 }}>🏟️ Recursos y Horarios del Club</h3>
                    <p style={{ marginTop: '0.25rem', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-xs)' }}>
                      Configuración general compartida por todas las categorías del club.
                    </p>
                  </div>
                  <Link to="/admin/club" className="btn-secondary" style={{ fontSize: 'var(--font-size-xs)', padding: '0.35rem 0.75rem' }}>
                    ⚙️ Configurar Club
                  </Link>
                </div>

                <div style={{ marginTop: '1rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
                  <div className="info-row">
                    <span>Canchas totales del club</span>
                    <strong>{org.cantidadCanchas || 1} cancha{org.cantidadCanchas === 1 ? '' : 's'}</strong>
                  </div>

                  <div className="info-row">
                    <span>Jornada Viernes</span>
                    <strong>{org.viernesInicio && org.viernesFin ? `${org.viernesInicio} - ${org.viernesFin}` : 'No configurado'}</strong>
                  </div>

                  <div className="info-row">
                    <span>Jornada Sábado</span>
                    <strong>{org.sabadoInicio && org.sabadoFin ? `${org.sabadoInicio} - ${org.sabadoFin}` : 'No configurado'}</strong>
                  </div>
                </div>

                {!tieneJornada && (
                  <div className="alert-warning" style={{ marginTop: '1rem', fontSize: 'var(--font-size-xs)' }}>
                    ⚠️ Todavía no configuraste los horarios de apertura del club. Andá a <Link to="/admin/club" style={{ color: 'inherit', fontWeight: 'bold', textDecoration: 'underline' }}>Configuración del Club</Link> para definirlos y generar la grilla de turnos.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div>
              {zonas.length > 1 && (
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
                  {zonas.map((z) => (
                    <button
                      key={z.id}
                      onClick={() => setActiveZonaId(z.id)}
                      style={{
                        padding: '0.5rem 1rem',
                        borderRadius: 'var(--radius-md)',
                        background: activeZonaId === z.id ? 'var(--color-primary)' : 'var(--color-bg-input)',
                        color: activeZonaId === z.id ? 'white' : 'var(--color-text-secondary)',
                        fontWeight: activeZonaId === z.id ? 'bold' : 'normal',
                        border: '1px solid',
                        borderColor: activeZonaId === z.id ? 'var(--color-primary)' : z.requiereArmadoManual ? 'var(--color-warning)' : 'var(--color-border)',
                        transition: 'all var(--transition-fast)',
                      }}
                    >
                      {z.nombre}
                      {z.requiereArmadoManual ? ' ⚠️' : ''}
                    </button>
                  ))}
                </div>
              )}

              {zonas
                .filter((z) => z.id === (activeZonaId || zonas[0]?.id))
                .map((zona) => (
                  <div key={zona.id} style={{ marginBottom: '3rem' }}>
                    <ZonaTable zona={zona} />
                    <div style={{ marginTop: '1rem' }}>
                      <h4 style={{ marginBottom: '1rem', color: 'var(--color-text-secondary)' }}>Partidos</h4>
                      <div className="partidos-grid">
                        {getPartidosZona(zona.id).map((p) => {
                          const bracketBloqueaEdicion = fasesEliminatorias.some((f) =>
                            f.partidos.some((part) => part.pareja1Id !== null || part.pareja2Id !== null)
                          );

                          let partidoLabel = '';
                          if (zona.formato === 'MINI_BRACKET') {
                            if (p.posicionEnRonda === 3) partidoLabel = 'Ganador vs Ganador';
                            if (p.posicionEnRonda === 4) partidoLabel = 'Perdedor vs Perdedor';
                          }

                          return (
                            <div
                              key={p.id}
                              style={{
                                opacity: bracketBloqueaEdicion ? 0.7 : 1,
                                cursor: bracketBloqueaEdicion ? 'not-allowed' : 'pointer',
                                transition: 'opacity 0.2s',
                                display: 'flex',
                                flexDirection: 'column',
                                justifyContent: 'flex-end',
                                gap: '0.4rem',
                              }}
                              title={bracketBloqueaEdicion ? 'Edición bloqueada: La fase eliminatoria ya está generada.' : 'Clic para cargar resultado'}
                              onClick={(e) => {
                                if (bracketBloqueaEdicion) {
                                  e.stopPropagation();
                                  setAlertModalOpen(true);
                                  return;
                                }
                              }}
                            >
                              {partidoLabel && (
                                <div
                                  style={{
                                    fontSize: 'var(--font-size-xs)',
                                    fontWeight: 'bold',
                                    color: 'var(--color-primary)',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.5px',
                                  }}
                                >
                                  {partidoLabel}
                                </div>
                              )}
                              <PartidoCard
                                partido={p}
                                onClick={() => {
                                  if (!bracketBloqueaEdicion) setPartidoSeleccionado(p);
                                }}
                                onUpdateFechaHora={handleUpdateFechaHora}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>

      {partidoSeleccionado && (
        <ResultadoModal
          partido={partidoSeleccionado}
          onClose={() => setPartidoSeleccionado(null)}
          onSaved={() => {
            setPartidoSeleccionado(null);
            fetchData();
            setToast('✅ Resultado guardado');
            setTimeout(() => setToast(''), 3000);
          }}
        />
      )}

      {toast && (
        <div className="toast-container">
          <div className="toast-message">{toast}</div>
        </div>
      )}

      <ConfirmModal
        isOpen={alertModalOpen}
        title="⚠️ Edición Bloqueada"
        message="La fase eliminatoria ya fue generada con los clasificados. Para editar la zona, primero debés borrar el bracket eliminatorio o re-sortearlo."
        confirmText="Entendido"
        onConfirm={() => setAlertModalOpen(false)}
        isAlert={true}
      />

      {limpiarModalOpen && (
        <ConfirmModal
          isOpen={limpiarModalOpen}
          title="⚠️ Limpiar Zonas"
          message="¿Estás seguro de que querés borrar todos los resultados cargados en las zonas? Los partidos volverán a estado Pendiente."
          onConfirm={handleLimpiarZonas}
          onCancel={() => setLimpiarModalOpen(false)}
          confirmText="Sí, limpiar resultados"
          isDanger={true}
        />
      )}

      {reiniciarModalOpen && (
        <ConfirmModal
          isOpen={reiniciarModalOpen}
          title="🚨 Reiniciar Torneo"
          message="¿Estás completamente seguro de que querés REINICIAR el torneo? Esto borrará de forma permanente TODAS las zonas, partidos, resultados y fases eliminatorias. El torneo volverá al estado BORRADOR."
          onConfirm={executeReiniciar}
          onCancel={() => setReiniciarModalOpen(false)}
          confirmText="Sí, reiniciar torneo"
          isDanger={true}
        />
      )}

      {zoneEditorOpen && (
        <ZoneEditorModal
          torneoId={torneo.id}
          zonasOriginales={zonas}
          parejas={parejas}
          onClose={() => setZoneEditorOpen(false)}
          onSaved={() => {
            setZoneEditorOpen(false);
            fetchData();
          }}
        />
      )}

      {iniciarModalOpen && (
        <ConfirmModal
          isOpen={iniciarModalOpen}
          title="🚀 Iniciar Torneo"
          message="¿Seguro que querés iniciar el torneo? Se sortearán las zonas y ya no podrás agregar ni quitar parejas."
          onConfirm={executeIniciar}
          onCancel={() => setIniciarModalOpen(false)}
          confirmText="Sí, iniciar torneo"
        />
      )}

      {inicioDisponibilidadOpen && (
        <InicioDisponibilidadModal
          torneoId={torneo.id}
          parejas={parejas}
          onClose={() => setInicioDisponibilidadOpen(false)}
          onSuccess={() => {
            setInicioDisponibilidadOpen(false);
            fetchData();
            setToast('Torneo iniciado por disponibilidad horaria');
            setTimeout(() => setToast(''), 4000);
          }}
        />
      )}

      {eliminarModalOpen && (
        <ConfirmModal
          isOpen={true}
          title="Eliminar Torneo"
          message={`¿Estás seguro de que querés eliminar el torneo "${torneo.nombre}"? Esta acción borrará todas sus parejas, zonas, partidos y resultados permanentemente.`}
          onConfirm={executeEliminarTorneo}
          onCancel={() => setEliminarModalOpen(false)}
          confirmText="Sí, eliminar torneo"
          isDanger={true}
        />
      )}
    </div>
  );
}
