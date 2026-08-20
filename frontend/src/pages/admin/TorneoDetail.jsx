import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../../api/client';
import ZonaTable from '../../components/ZonaTable';
import PartidoCard from '../../components/PartidoCard';
import ResultadoModal from '../../components/ResultadoModal';
import ConfirmModal from '../../components/ConfirmModal';
import ZoneEditorModal from '../../components/ZoneEditorModal';

export default function TorneoDetail() {
  const { id } = useParams();
  const [torneo, setTorneo] = useState(null);
  const [zonas, setZonas] = useState([]);
  const [partidos, setPartidos] = useState([]);
  const [fasesEliminatorias, setFasesEliminatorias] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const [partidoSeleccionado, setPartidoSeleccionado] = useState(null);
  const [toast, setToast] = useState('');
  const [activeZonaId, setActiveZonaId] = useState(null);
  const [alertModalOpen, setAlertModalOpen] = useState(false);
  const [limpiarModalOpen, setLimpiarModalOpen] = useState(false);
  const [limpiandoZonas, setLimpiandoZonas] = useState(false);
  const [reiniciarModalOpen, setReiniciarModalOpen] = useState(false);
  const [iniciarModalOpen, setIniciarModalOpen] = useState(false);
  
  const [parejas, setParejas] = useState([]);
  const [zoneEditorOpen, setZoneEditorOpen] = useState(false);

  useEffect(() => {
    if (zonas.length > 0) {
      const exists = zonas.find(z => z.id === activeZonaId);
      if (!exists) {
        setActiveZonaId(zonas[0].id);
      }
    } else {
      setActiveZonaId(null);
    }
  }, [zonas, activeZonaId]);

  useEffect(() => {
    fetchData();
  }, [id]);

  const fetchData = async () => {
    try {
      const tData = await api.get(`/torneos/${id}`);
      setTorneo(tData);

      if (tData.estado !== 'BORRADOR') {
        const [zData, pData, fData, parejasData] = await Promise.all([
          api.get(`/torneos/${id}/zonas`),
          api.get(`/torneos/${id}/partidos`),
          api.get(`/torneos/${id}/fases-eliminatorias`),
          api.get(`/torneos/${id}/parejas`)
        ]);
        setZonas(zData);
        setPartidos(pData);
        setFasesEliminatorias(fData);
        setParejas(parejasData);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

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
      setToast('🔄 Torneo reiniciado a Borrador');
      setTimeout(() => setToast(''), 3000);
    } catch (err) {
      alert(err.message || 'Error al reiniciar torneo');
      setLoading(false);
    }
  };


  const handleLimpiarZonas = async () => {
    try {
      setLimpiandoZonas(true);
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

  const getPartidosZona = (zonaId) => partidos.filter(p => p.zonaId === zonaId);

  if (loading) return <div className="loading">Cargando torneo...</div>;
  if (error) return <div className="error-message">{error}</div>;
  if (!torneo) return null;

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
                onClick={(e) => {
                  e.stopPropagation();
                  navigator.clipboard.writeText(`${window.location.origin}/torneo/${torneo.slug}`);
                  const btn = e.target;
                  btn.textContent = '✅ Copiado!';
                  setTimeout(() => btn.textContent = '📋 Copiar', 1500);
                }}
                style={{ fontSize: 'var(--font-size-xs)', padding: '0.15rem 0.5rem', background: 'var(--color-bg-input)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-secondary)', cursor: 'pointer' }}
              >📋 Copiar</button>
            </span>
          </div>
        </div>
        {torneo.estado === 'BORRADOR' ? (
          <button onClick={() => setIniciarModalOpen(true)} className="btn-primary" style={{ width: 'auto', marginTop: 0 }}>
            🚀 Iniciar Torneo
          </button>
        ) : (
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
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
                transition: 'all 0.2s',
                opacity: 0.8
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = 1; e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)' }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = 0.8; e.currentTarget.style.background = 'transparent' }}
            >
              {limpiandoZonas ? 'Limpiando...' : '🗑️ Limpiar Zonas'}
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
                transition: 'all 0.2s',
                opacity: 0.8
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = 1; e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)' }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = 0.8; e.currentTarget.style.background = 'transparent' }}
              title="Borra TODO el fixture y resultados, y vuelve el torneo a estado Borrador"
            >
              🔄 Reiniciar Torneo
            </button>
            
            {/* Accion Principal - Más prominente a la derecha */}
            <button 
              onClick={() => setZoneEditorOpen(true)}
              className="btn-primary"
              style={{ width: 'auto', marginTop: 0, padding: '0.5rem 1.5rem', marginLeft: '0.5rem' }}
            >
              ⚙️ Editar Zonas
            </button>
          </div>
        )}
      </div>

      <div className="torneo-dashboard dashboard-grid">
        <div className="sidebar">
          <div className="torneo-card">
            <h3>Menú</h3>
            <ul style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <li><Link to={`/admin/torneos/${id}/eliminatoria`}>Fase Eliminatoria {torneo.estado === 'BORRADOR' && '(Pronto)'}</Link></li>
              <li><Link to={`/admin/torneos/${id}/parejas`}>Gestionar Parejas ({torneo.parejas?.length || 0})</Link></li>
            </ul>
          </div>
        </div>

        <div className="main-content">
          {torneo.estado === 'BORRADOR' ? (
            <div className="torneo-card">
              <h2>Torneo en Preparación</h2>
              <p style={{ marginTop: '1rem', color: 'var(--color-text-secondary)' }}>
                Actualmente tenés <strong>{torneo.parejas?.length || 0}</strong> parejas inscritas.<br/><br/>
                Andá a "Gestionar Parejas" para agregar los equipos. Una vez que estén todos, hacé clic en "Iniciar Torneo" arriba a la derecha. Esto sorteará las zonas de 3 (o 2/4) parejas y armará el fixture automáticamente.
              </p>
            </div>
          ) : (
            <div>
              {zonas.length > 1 && (
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
                  {zonas.map(z => (
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
                        borderColor: activeZonaId === z.id ? 'var(--color-primary)' : 'var(--color-border)',
                        transition: 'all var(--transition-fast)'
                      }}
                    >
                      {z.nombre}
                    </button>
                  ))}
                </div>
              )}
              
              {zonas.filter(z => z.id === (activeZonaId || zonas[0]?.id)).map(zona => (
                <div key={zona.id} style={{ marginBottom: '3rem' }}>
                  <>
                    <ZonaTable zona={zona} />
                    <div style={{ marginTop: '1rem' }}>
                      <h4 style={{ marginBottom: '1rem', color: 'var(--color-text-secondary)' }}>Partidos</h4>
                      <div className="partidos-grid">
                        {getPartidosZona(zona.id).map(p => {
                          const bracketBloqueaEdicion = fasesEliminatorias.some(f => 
                            f.partidos.some(part => part.pareja1Id !== null || part.pareja2Id !== null)
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
                              gap: '0.4rem'
                            }}

                            title={bracketBloqueaEdicion ? 'Edición bloqueada: La fase eliminatoria ya está generada con clasificados.' : 'Clic para cargar resultado'}
                            onClick={(e) => {
                              if (bracketBloqueaEdicion) {
                                e.stopPropagation();
                                setAlertModalOpen(true);
                                return;
                              }
                            }}
                          >
                            {partidoLabel && (
                              <div style={{
                                fontSize: 'var(--font-size-xs)',
                                fontWeight: 'bold',
                                color: 'var(--color-primary)',
                                textTransform: 'uppercase',
                                letterSpacing: '0.5px'
                              }}>
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
                  </>
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
          <div className="toast-message">
            {toast}
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={alertModalOpen}
        title="⚠️ Edición Bloqueada"
        message="La fase eliminatoria ya fue generada con los clasificados. Para editar la zona, primero debes borrar el bracket eliminatorio o re-sortearlo."
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
          message="¿Estás completamente seguro de que querés REINICIAR el torneo? Esto borrará de forma permanente TODAS las zonas, TODOS los partidos, TODOS los resultados y TODO el progreso de las fases eliminatorias. El torneo volverá al estado BORRADOR para que puedas agregar o quitar parejas y volver a sortear todo desde cero."
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
    </div>
  );
}
