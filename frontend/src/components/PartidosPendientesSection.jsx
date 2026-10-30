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
    <div className="pm-pending">
      {/* Encabezado */}
      <div
        className="pm-pending-header"
      >
        <div className="pm-heading-main">
          <AlertTriangle size={20} className="pm-icon" />
          <h3 className="pm-pending-title">
            Partidos pendientes de asignación de horario ({partidosPendientes.length})
          </h3>
        </div>

        {/* Acción discreta Expandir / Colapsar todas */}
        {gruposCategorias.length > 1 && (
          <button
            type="button"

            className="pm-text-button"
            onClick={handleToggleAll}
          >
            {allExpanded ? 'Colapsar todas' : 'Expandir todas'}
          </button>
        )}
      </div>

      {error && <div className="pm-alert">{error}</div>}

      {/* Lista de Grupos de Categorías en Acordeón */}
      <div className="pm-stack">
        {gruposCategorias.map((grupo) => {
          const isExpanded = expandedCategorias.has(grupo.catNombre);

          return (
            <div
              key={grupo.catNombre}
              className="pm-pending-group"
            >
              {/* Header del acordeón */}
              <button
                type="button"
                className="pm-pending-toggle"
                onClick={() => toggleCategoria(grupo.catNombre)}
                aria-expanded={isExpanded}
              >
                <span className="pm-pending-category">
                  <Layers size={16} className="pm-brand-icon" />
                  <strong className="pm-strong">
                    {grupo.catNombre}
                  </strong>
                  <span

                    className="pm-badge"
                  >
                    {grupo.partidos.length} {grupo.partidos.length === 1 ? 'partido' : 'partidos'}
                  </span>

                  {grupo.tieneCriticos && (
                    <span
                      className="pm-badge pm-alert"
                    >
                      <AlertCircle size={11} /> Muy restringido
                    </span>
                  )}
                </span>

                <span className="pm-pending-expand">
                  <span className="pm-muted">
                    {isExpanded ? 'Ocultar' : 'Ver partidos'}
                  </span>
                  {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </span>
              </button>

              {/* Contenido expandible */}
              {isExpanded && (
                <div className="pm-pending-grid">
                  {grupo.partidos.map((p) => {
                    const p1Nombre = p.pareja1 ? `${p.pareja1.jugador1} / ${p.pareja1.jugador2}` : 'Por definirse';
                    const p2Nombre = p.pareja2 ? `${p.pareja2.jugador1} / ${p.pareja2.jugador2}` : 'Por definirse';
                    const viables = p.slotsViablesCount ?? 0;
                    const esCritico = viables <= 1;

                    return (
                      <div
                        key={p.id}
                        className={`pm-pending-match${esCritico ? ' is-critical' : ''}`}
                      >
                        <div>
                          <div className="pm-match-meta">
                            <span
                              className="pm-badge"
                            >
                              {p.zona?.nombre || 'Zona'}
                            </span>
                          </div>

                          <div className="pm-pair-names">
                            <span>{p1Nombre}</span>
                            <span className="pm-versus">vs</span>
                            <span>{p2Nombre}</span>
                          </div>

                          {viables === 0 && (
                            <div className="pm-alert">
                              Canchas saturadas en todos los horarios. Es necesario liberar turnos de otros partidos o acordar un nuevo horario.
                            </div>
                          )}
                        </div>

                        {/* Acción de asignación por partido */}
                        <div className="pm-pending-actions">
                          <button
                            type="button"
                            className="pm-button pm-blue-button"
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
