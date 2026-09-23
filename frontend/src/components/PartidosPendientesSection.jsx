import { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../api/client';
import { AlertTriangle, ChevronDown, ChevronUp, Clock, Layers, AlertCircle } from 'lucide-react';
import AsignarHorarioModal from './AsignarHorarioModal';

export default function PartidosPendientesSection({ torneoId, torneoEstado, onPartidosActualizados }) {
  const [partidosPendientes, setPartidosPendientes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [partidoParaAsignar, setPartidoParaAsignar] = useState(null);
  const [expandedCategorias, setExpandedCategorias] = useState(new Set());

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

  // Agrupar y ordenar categorías con desempate determinista multi-nivel (Most Constrained First)
  const gruposCategorias = useMemo(() => {
    const map = new Map();

    for (const p of partidosPendientes) {
      const catNombre = p.categoria?.nombre || 'General';
      const catId = p.categoria?.id || 'gen';

      if (!map.has(catNombre)) {
        map.set(catNombre, {
          catId,
          catNombre,
          partidos: [],
          minSlotsViables: 999,
          tieneCriticos: false,
          tieneUrgentes: false,
        });
      }

      const group = map.get(catNombre);
      group.partidos.push(p);
      const viables = p.slotsViablesCount ?? 999;
      if (viables < group.minSlotsViables) {
        group.minSlotsViables = viables;
      }
      if (viables <= 1) group.tieneCriticos = true;
      if (viables <= 3) group.tieneUrgentes = true;
    }

    // Criterio de ordenamiento determinista:
    // 1. Menor cantidad de turnos viables mínimos (el más restringido primero)
    // 2. Mayor cantidad de partidos críticos (<=1 turno)
    // 3. Mayor cantidad total de partidos pendientes
    // 4. Orden alfabético por nombre
    const grupos = Array.from(map.values()).sort((a, b) => {
      if (a.minSlotsViables !== b.minSlotsViables) {
        return a.minSlotsViables - b.minSlotsViables;
      }
      const critA = a.partidos.filter((p) => (p.slotsViablesCount ?? 999) <= 1).length;
      const critB = b.partidos.filter((p) => (p.slotsViablesCount ?? 999) <= 1).length;
      if (critA !== critB) return critB - critA;
      if (a.partidos.length !== b.partidos.length) return b.partidos.length - a.partidos.length;
      return a.catNombre.localeCompare(b.catNombre);
    });

    return grupos;
  }, [partidosPendientes]);

  if (loading && partidosPendientes.length === 0) {
    return null;
  }

  if (partidosPendientes.length === 0) {
    return null;
  }

  const allExpanded = gruposCategorias.length > 0 && expandedCategorias.size === gruposCategorias.length;

  const toggleCategoria = (catNombre) => {
    setExpandedCategorias((prev) => {
      const next = new Set(prev);
      if (next.has(catNombre)) {
        next.delete(catNombre);
      } else {
        next.add(catNombre);
      }
      return next;
    });
  };

  const handleToggleAll = () => {
    if (allExpanded) {
      setExpandedCategorias(new Set());
    } else {
      setExpandedCategorias(new Set(gruposCategorias.map((g) => g.catNombre)));
    }
  };

  return (
    <div
      className="card"
      style={{
        marginBottom: '1.5rem',
        border: '1px solid rgba(245, 158, 11, 0.4)',
        background: 'rgba(245, 158, 11, 0.03)',
        padding: '1.1rem',
      }}
    >
      {/* Encabezado */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '1rem',
          marginBottom: '1rem',
          borderBottom: '1px solid rgba(245, 158, 11, 0.15)',
          paddingBottom: '0.75rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <AlertTriangle size={22} color="var(--color-warning)" style={{ flexShrink: 0 }} />
          <h3 style={{ margin: 0, fontSize: '1.15rem', color: 'var(--color-warning)', fontWeight: 600 }}>
            Partidos pendientes de asignación de horario ({partidosPendientes.length})
          </h3>
        </div>

        {/* Acción discreta Expandir / Colapsar todas */}
        {gruposCategorias.length > 1 && (
          <button
            type="button"
            className="btn-link-action"
            style={{
              fontSize: 'var(--font-size-xs)',
              color: 'var(--color-text-secondary)',
              whiteSpace: 'nowrap',
              padding: '0.2rem 0.4rem',
              flexShrink: 0,
            }}
            onClick={handleToggleAll}
          >
            {allExpanded ? 'Colapsar todas' : 'Expandir todas'}
          </button>
        )}
      </div>

      {error && <div className="error-message" style={{ marginBottom: '1rem' }}>{error}</div>}

      {/* Lista de Grupos de Categorías en Acordeón */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {gruposCategorias.map((grupo) => {
          const isExpanded = expandedCategorias.has(grupo.catNombre);

          return (
            <div
              key={grupo.catNombre}
              style={{
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-surface)',
                overflow: 'hidden',
              }}
            >
              {/* Header del acordeón */}
              <div
                style={{
                  padding: '0.65rem 0.85rem',
                  background: 'var(--color-surface-elevated)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
                onClick={() => toggleCategoria(grupo.catNombre)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <Layers size={16} style={{ color: 'var(--color-primary)' }} />
                  <strong style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }}>
                    {grupo.catNombre}
                  </strong>
                  <span
                    className="badge"
                    style={{
                      background: 'rgba(255, 255, 255, 0.08)',
                      fontSize: '11px',
                      padding: '2px 6px',
                    }}
                  >
                    {grupo.partidos.length} {grupo.partidos.length === 1 ? 'partido' : 'partidos'}
                  </span>

                  {grupo.tieneCriticos && (
                    <span
                      style={{
                        fontSize: '10.5px',
                        background: 'rgba(239, 68, 68, 0.15)',
                        color: '#ef4444',
                        padding: '1px 6px',
                        borderRadius: '4px',
                        fontWeight: 600,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '3px',
                      }}
                    >
                      <AlertCircle size={11} /> Muy restringido
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                    {isExpanded ? 'Ocultar' : 'Ver partidos'}
                  </span>
                  {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </div>
              </div>

              {/* Contenido expandible */}
              {isExpanded && (
                <div
                  style={{
                    padding: '0.75rem',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))',
                    gap: '0.65rem',
                    borderTop: '1px solid var(--color-border)',
                  }}
                >
                  {grupo.partidos.map((p) => {
                    const p1Nombre = p.pareja1 ? `${p.pareja1.jugador1} / ${p.pareja1.jugador2}` : 'Por definirse';
                    const p2Nombre = p.pareja2 ? `${p.pareja2.jugador1} / ${p.pareja2.jugador2}` : 'Por definirse';
                    const viables = p.slotsViablesCount ?? 0;
                    const esCritico = viables <= 1;

                    return (
                      <div
                        key={p.id}
                        style={{
                          padding: '0.75rem 0.85rem',
                          background: 'var(--color-bg-input)',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--color-border)',
                          borderLeft: `3px solid ${esCritico ? '#ef4444' : 'var(--color-border)'}`,
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          gap: '0.6rem',
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                            <span className="badge" style={{ background: 'var(--color-surface)', fontSize: '11px' }}>
                              {p.zona?.nombre || 'Zona'}
                            </span>
                          </div>

                          <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text)', marginBottom: '0.2rem' }}>
                            {p1Nombre} vs {p2Nombre}
                          </div>

                          {viables === 0 && (
                            <div style={{ fontSize: '10.5px', color: 'var(--color-danger)', marginTop: '0.3rem', lineHeight: 1.3 }}>
                              Canchas saturadas en todos los horarios. Es necesario liberar turnos de otros partidos o acordar un nuevo horario.
                            </div>
                          )}
                        </div>

                        {/* Botón de acción primario verde deportivo */}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '0.4rem', borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}>
                          <button
                            type="button"
                            className="btn-primary"
                            style={{
                              padding: '0.35rem 0.75rem',
                              fontSize: 'var(--font-size-xs)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.3rem',
                              width: 'auto',
                              margin: 0,
                              cursor: 'pointer',
                            }}
                            onClick={() => setPartidoParaAsignar(p)}
                          >
                            <Clock size={13} />
                            Asignar horario y cancha →
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
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
