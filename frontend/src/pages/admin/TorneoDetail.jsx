import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../../api/client';
import ZonaTable from '../../components/ZonaTable';
import MiniBracketView from '../../components/MiniBracketView';
import PartidoCard from '../../components/PartidoCard';
import ResultadoModal from '../../components/ResultadoModal';

export default function TorneoDetail() {
  const { id } = useParams();
  const [torneo, setTorneo] = useState(null);
  const [zonas, setZonas] = useState([]);
  const [partidos, setPartidos] = useState([]);
  const [fasesEliminatorias, setFasesEliminatorias] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const [partidoSeleccionado, setPartidoSeleccionado] = useState(null);

  useEffect(() => {
    fetchData();
  }, [id]);

  const fetchData = async () => {
    try {
      const tData = await api.get(`/torneos/${id}`);
      setTorneo(tData);

      if (tData.estado !== 'BORRADOR') {
        const [zData, pData, fData] = await Promise.all([
          api.get(`/torneos/${id}/zonas`),
          api.get(`/torneos/${id}/partidos`),
          api.get(`/torneos/${id}/fases-eliminatorias`)
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
  };

  const handleIniciar = async () => {
    if (!window.confirm('¿Seguro que querés iniciar el torneo? Ya no podrás agregar ni quitar parejas.')) return;
    try {
      setLoading(true);
      await api.post(`/torneos/${id}/iniciar`);
      fetchData();
    } catch (err) {
      alert(err.message);
      setLoading(false);
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
        {torneo.estado === 'BORRADOR' && (
          <button onClick={handleIniciar} className="btn-primary" style={{ width: 'auto', marginTop: 0 }}>
            🚀 Iniciar Torneo
          </button>
        )}
      </div>

      <div className="torneo-dashboard" style={{ display: 'grid', gridTemplateColumns: '1fr 3fr', gap: '2rem' }}>
        <div className="sidebar">
          <div className="torneo-card">
            <h3>Menú</h3>
            <ul style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <li><Link to={`/admin/torneos/${id}`}>Fase de Grupos</Link></li>
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
              {zonas.map(zona => (
                <div key={zona.id} style={{ marginBottom: '3rem' }}>
                  {zona.formato === 'ROUND_ROBIN' ? (
                    <>
                      <ZonaTable zona={zona} />
                      <div style={{ marginTop: '1rem' }}>
                        <h4 style={{ marginBottom: '1rem', color: 'var(--color-text-secondary)' }}>Partidos</h4>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '1.25rem' }}>
                          {getPartidosZona(zona.id).map(p => (
                            <div 
                              key={p.id} 
                              style={{ 
                                opacity: fasesEliminatorias.length > 0 ? 0.7 : 1, 
                                cursor: fasesEliminatorias.length > 0 ? 'not-allowed' : 'pointer',
                                transition: 'opacity 0.2s'
                              }}
                              title={fasesEliminatorias.length > 0 ? 'Edición bloqueada: La fase eliminatoria ya está generada.' : 'Clic para cargar resultado'}
                              onClick={(e) => {
                                if (fasesEliminatorias.length > 0) {
                                  e.stopPropagation();
                                  alert('La fase eliminatoria ya fue generada. Para editar la zona, primero debes borrar el bracket eliminatorio.');
                                  return;
                                }
                              }}
                            >
                              <PartidoCard 
                                partido={p} 
                                onClick={() => {
                                  if (fasesEliminatorias.length === 0) setPartidoSeleccionado(p);
                                }} 
                                onUpdateFechaHora={handleUpdateFechaHora}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div 
                      style={{ 
                        opacity: fasesEliminatorias.length > 0 ? 0.7 : 1,
                      }}
                      title={fasesEliminatorias.length > 0 ? 'Edición bloqueada: La fase eliminatoria ya está generada.' : ''}
                      onClick={(e) => {
                        if (fasesEliminatorias.length > 0) {
                          e.stopPropagationCapture(); // Try to stop it before it reaches child
                          alert('La fase eliminatoria ya fue generada. Para editar la zona, primero debes borrar el bracket eliminatorio.');
                        }
                      }}
                    >
                      <MiniBracketView 
                        zona={zona} 
                        partidos={getPartidosZona(zona.id)} 
                        onPartidoClick={(p) => {
                          if (fasesEliminatorias.length === 0) setPartidoSeleccionado(p);
                        }}
                        onUpdateFechaHora={handleUpdateFechaHora}
                      />
                    </div>
                  )}
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
          }}
        />
      )}
    </div>
  );
}
