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
        const [zData, pData] = await Promise.all([
          api.get(`/torneos/${id}/zonas`),
          api.get(`/torneos/${id}/partidos`)
        ]);
        setZonas(zData);
        setPartidos(pData);
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
            <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
              Link público: <a href={`/${torneo.slug}`} target="_blank" rel="noreferrer">/{torneo.slug}</a>
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
              <li><Link to={`/admin/torneos/${id}/eliminatoria`} style={{ color: 'var(--color-text-muted)' }}>Fase Eliminatoria (Pronto)</Link></li>
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
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
                          {getPartidosZona(zona.id).map(p => (
                            <PartidoCard key={p.id} partido={p} onClick={() => setPartidoSeleccionado(p)} />
                          ))}
                        </div>
                      </div>
                    </>
                  ) : (
                    <MiniBracketView 
                      zona={zona} 
                      partidos={getPartidosZona(zona.id)} 
                      onPartidoClick={setPartidoSeleccionado}
                    />
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
