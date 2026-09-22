import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { api } from '../../api/client';
import ConfirmModal from '../../components/ConfirmModal';
import DisponibilidadEditor from '../../components/DisponibilidadEditor';
import { ChevronLeft, Plus, Clock, Trash2, Users, AlertCircle } from 'lucide-react';

export default function ParejasManager() {
  const { torneoId, id } = useParams();
  const [searchParams] = useSearchParams();
  const queryParejaId = searchParams.get('parejaId');

  const [categoria, setCategoria] = useState(null);
  const [parejas, setParejas] = useState([]);
  const [jugador1, setJugador1] = useState('');
  const [jugador2, setJugador2] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [parejaToDelete, setParejaToDelete] = useState(null);
  const [expandedParejaId, setExpandedParejaId] = useState(queryParejaId || null);

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

  if (loading) return <div className="loading">Cargando parejas...</div>;
  if (error || !categoria) return <div className="error-message">{error || 'Categoría no encontrada'}</div>;

  const isBorrador = categoria.estado === 'BORRADOR';
  const backUrl = `/admin/torneos/${torneoId || categoria.torneoId}/categorias/${id}`;

  return (
    <div className="page">
      <div className="flex-header">
        <div>
          <Link
            to={backUrl}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text-secondary)',
              textDecoration: 'none',
            }}
          >
            <ChevronLeft size={14} strokeWidth={2} />
            Volver a Categoría {categoria.nombre} ({categoria.torneo?.nombre})
          </Link>
          <h1 style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Users size={24} strokeWidth={2} />
            Parejas — {categoria.nombre}
          </h1>
        </div>
      </div>

      <div className="manager-grid">
        {/* Formulario (solo en BORRADOR) o Panel informativo */}
        <div>
          {isBorrador ? (
            <div className="torneo-card">
              <h3>Agregar Pareja</h3>
              <form onSubmit={handleAdd} style={{ marginTop: '1rem' }}>
                <div className="form-group">
                  <label>Jugador 1</label>
                  <input
                    type="text"
                    value={jugador1}
                    onChange={(e) => setJugador1(e.target.value)}
                    placeholder="Nombre y apellido"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Jugador 2</label>
                  <input
                    type="text"
                    value={jugador2}
                    onChange={(e) => setJugador2(e.target.value)}
                    placeholder="Nombre y apellido"
                    required
                  />
                </div>
                <button
                  type="submit"
                  className="btn-primary"
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
                >
                  <Plus size={16} strokeWidth={2} />
                  Añadir Pareja
                </button>
              </form>
            </div>
          ) : (
            <div
              className="torneo-card"
              style={{
                borderLeft: '4px solid var(--color-warning)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--color-warning)' }}>
                <AlertCircle size={20} strokeWidth={2} />
                <h3 style={{ margin: 0, fontSize: 'var(--font-size-base)', color: 'var(--color-text)' }}>
                  Edición Bloqueada
                </h3>
              </div>
              <p style={{ margin: 0, fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                Esta categoría está en estado <strong>{categoria.estado}</strong>. No es posible agregar ni eliminar parejas desde esta pantalla una vez iniciado el torneo.
              </p>
              <div
                style={{
                  background: 'var(--color-bg)',
                  padding: '0.75rem',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 'var(--font-size-xs)',
                  color: 'var(--color-text-secondary)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.5rem',
                  border: '1px solid var(--color-border)',
                }}
              >
                <div>
                  <strong style={{ color: 'var(--color-text)' }}>• Agregar pareja:</strong> Ingresá al detalle de la categoría y seleccioná <em>"Agregar Pareja a Zona"</em> desde el menú de acciones (⋮) para incorporarla a una zona existente con lugar disponible.
                </div>
                <div>
                  <strong style={{ color: 'var(--color-text)' }}>• Eliminar pareja:</strong> No está permitido eliminar parejas con el torneo en curso para preservar la integridad del fixture y las estadísticas (limitación conocida).
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Lista de parejas inscriptas */}
        <div>
          <div className="torneo-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0 }}>Parejas Inscriptas ({parejas.length})</h3>
            </div>

            {parejas.length === 0 ? (
              <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
                No hay parejas cargadas en esta categoría aún.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {parejas.map((pareja, index) => {
                  const isExpanded = expandedParejaId === pareja.id;
                  const cantSlots = pareja._cantSlots || 0;

                  return (
                    <div
                      key={pareja.id}
                      style={{
                        background: 'var(--color-surface)',
                        border: isExpanded
                          ? '1px solid var(--color-primary)'
                          : '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-md)',
                        overflow: 'hidden',
                        transition: 'border-color var(--transition-fast)',
                      }}
                    >
                      {/* Fila principal de la pareja */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '0.75rem 1rem',
                          gap: '0.5rem',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1, minWidth: 0 }}>
                          <span
                            style={{
                              color: 'var(--color-text-secondary)',
                              fontSize: 'var(--font-size-xs)',
                              fontWeight: 700,
                              width: '1.5rem',
                              flexShrink: 0,
                            }}
                          >
                            #{index + 1}
                          </span>
                          <span
                            style={{
                              fontWeight: 600,
                              fontSize: 'var(--font-size-sm)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {pareja.jugador1} / {pareja.jugador2}
                          </span>
                        </div>

                        {/* Botones de acción */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
                          <button
                            type="button"
                            onClick={() => toggleDisponibilidad(pareja.id)}
                            className={isExpanded ? 'btn-primary' : 'btn-secondary'}
                            style={{
                              padding: '0.3rem 0.65rem',
                              fontSize: 'var(--font-size-xs)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.35rem',
                              width: 'auto',
                            }}
                            title="Configurar disponibilidad horaria"
                          >
                            <Clock size={12} strokeWidth={2} />
                            <span>
                              {cantSlots > 0
                                ? `${cantSlots} turno${cantSlots > 1 ? 's' : ''}`
                                : 'Sin horario'}
                            </span>
                          </button>

                          {isBorrador && (
                            <button
                              type="button"
                              className="btn-danger"
                              onClick={() => handleDelete(pareja.id)}
                              style={{
                                padding: '0.3rem 0.5rem',
                                background: 'transparent',
                                borderColor: 'transparent',
                              }}
                              title="Eliminar pareja"
                            >
                              <Trash2 size={14} strokeWidth={2} style={{ color: 'var(--color-danger)' }} />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Editor desplegable de disponibilidad */}
                      {isExpanded && (
                        <div
                          style={{
                            borderTop: '1px solid var(--color-border)',
                            background: 'var(--color-bg)',
                            padding: '1rem',
                          }}
                        >
                          <DisponibilidadEditor
                            parejaId={pareja.id}
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
        </div>
      </div>

      <ConfirmModal
        isOpen={Boolean(parejaToDelete)}
        title="Eliminar Pareja"
        message="¿Estás seguro de que querés eliminar esta pareja de la categoría?"
        confirmText="Eliminar"
        isDanger={true}
        onConfirm={executeDelete}
        onCancel={() => setParejaToDelete(null)}
      />
    </div>
  );
}
