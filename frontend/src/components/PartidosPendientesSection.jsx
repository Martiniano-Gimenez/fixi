import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { Clock, Calendar, AlertTriangle, CheckCircle } from 'lucide-react';
import AsignarHorarioModal from './AsignarHorarioModal';

export default function PartidosPendientesSection({ torneoId, torneoEstado, onPartidosActualizados }) {
  const [partidosPendientes, setPartidosPendientes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [categoriaFiltro, setCategoriaFiltro] = useState('ALL');
  const [partidoParaAsignar, setPartidoParaAsignar] = useState(null);

  const fetchPartidosPendientes = useCallback(async () => {
    if (!torneoId) return;
    setLoading(true);
    try {
      const data = await api.get(`/torneos/${torneoId}/partidos-sin-horario`);
      setPartidosPendientes(data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [torneoId]);

  useEffect(() => {
    fetchPartidosPendientes();
  }, [fetchPartidosPendientes]);

  if (loading && partidosPendientes.length === 0) {
    return null;
  }

  if (partidosPendientes.length === 0) {
    return null;
  }

  const categoriasUnicas = Array.from(
    new Set(partidosPendientes.map((p) => p.categoria?.nombre).filter(Boolean))
  );

  const partidosFiltrados =
    categoriaFiltro === 'ALL'
      ? partidosPendientes
      : partidosPendientes.filter((p) => p.categoria?.nombre === categoriaFiltro);

  return (
    <div
      className="card"
      style={{
        marginBottom: '1.5rem',
        border: '1px solid rgba(245, 158, 11, 0.4)',
        background: 'rgba(245, 158, 11, 0.04)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.75rem',
          marginBottom: '1rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <AlertTriangle size={20} color="var(--color-warning)" />
          <div>
            <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--color-warning)' }}>
              Partidos pendientes de asignación de horario ({partidosPendientes.length})
            </h3>
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
              Estos cruces iniciaron sin cancha asignada y deben coordinarse manualmente
            </span>
          </div>
        </div>

        {/* Filtro por categoría */}
        {categoriasUnicas.length > 1 && (
          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`btn-secondary ${categoriaFiltro === 'ALL' ? 'btn-primary' : ''}`}
              style={{ padding: '0.25rem 0.6rem', fontSize: 'var(--font-size-xs)' }}
              onClick={() => setCategoriaFiltro('ALL')}
            >
              Todas ({partidosPendientes.length})
            </button>
            {categoriasUnicas.map((catNombre) => {
              const count = partidosPendientes.filter((p) => p.categoria?.nombre === catNombre).length;
              return (
                <button
                  key={catNombre}
                  type="button"
                  className={`btn-secondary ${categoriaFiltro === catNombre ? 'btn-primary' : ''}`}
                  style={{ padding: '0.25rem 0.6rem', fontSize: 'var(--font-size-xs)' }}
                  onClick={() => setCategoriaFiltro(catNombre)}
                >
                  {catNombre} ({count})
                </button>
              );
            })}
          </div>
        )}
      </div>

      {error && <div className="error-message" style={{ marginBottom: '1rem' }}>{error}</div>}

      {/* Lista de partidos */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))', gap: '0.75rem' }}>
        {partidosFiltrados.map((p) => {
          const p1Nombre = p.pareja1 ? `${p.pareja1.jugador1} / ${p.pareja1.jugador2}` : 'Por definirse';
          const p2Nombre = p.pareja2 ? `${p.pareja2.jugador1} / ${p.pareja2.jugador2}` : 'Por definirse';

          return (
            <div
              key={p.id}
              style={{
                padding: '0.75rem 0.85rem',
                background: 'var(--color-surface-elevated)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--color-border)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '0.6rem',
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                  <span className="badge" style={{ background: 'var(--color-surface)', fontSize: '11px' }}>
                    {p.categoria?.nombre} · {p.zona?.nombre || 'Zona'}
                  </span>
                  <span className="badge badge-warning" style={{ fontSize: '10px' }}>
                    Sin horario
                  </span>
                </div>

                <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text)', marginBottom: '0.25rem' }}>
                  {p1Nombre} vs {p2Nombre}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn-primary"
                  style={{ padding: '0.35rem 0.75rem', fontSize: 'var(--font-size-xs)' }}
                  onClick={() => setPartidoParaAsignar(p)}
                >
                  Asignar horario y cancha →
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal de asignación */}
      {partidoParaAsignar && (
        <AsignarHorarioModal
          isOpen={Boolean(partidoParaAsignar)}
          partido={partidoParaAsignar}
          torneoId={torneoId}
          onClose={() => setPartidoParaAsignar(null)}
          onAssigned={() => {
            fetchPartidosPendientes();
            if (onPartidosActualizados) onPartidosActualizados();
          }}
        />
      )}
    </div>
  );
}
