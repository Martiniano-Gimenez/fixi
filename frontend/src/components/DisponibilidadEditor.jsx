import { useState, useEffect } from 'react';
import { api } from '../api/client';

function horaAMinutos(hora) {
  if (!hora) return 0;
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}

export default function DisponibilidadEditor({ parejaId, torneoId, onChanged, onClose }) {
  const [grilla, setGrilla] = useState({ viernes: [], sabado: [] });
  const [selectedSlots, setSelectedSlots] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    cargarDatos();
  }, [parejaId, torneoId]);

  const cargarDatos = async () => {
    setLoading(true);
    setError('');
    try {
      const [grillaData, slotsData] = await Promise.all([
        api.get('/organizador/slots'),
        api.get(`/parejas/${parejaId}/disponibilidad`),
      ]);
      setGrilla(grillaData || { viernes: [], sabado: [] });
      setSelectedSlots(new Set(slotsData || []));
    } catch (err) {
      setError(err.message || 'Error al cargar disponibilidad.');
    } finally {
      setLoading(false);
    }
  };

  const toggleSlot = async (slotId) => {
    const next = new Set(selectedSlots);
    if (next.has(slotId)) {
      next.delete(slotId);
    } else {
      next.add(slotId);
    }
    setSelectedSlots(next);
    await guardarSeleccion(Array.from(next));
  };

  const seleccionarTodosDia = async (slotsDia) => {
    const next = new Set(selectedSlots);
    const todosSeleccionados = slotsDia.every((s) => next.has(s));

    if (todosSeleccionados) {
      slotsDia.forEach((s) => next.delete(s));
    } else {
      slotsDia.forEach((s) => next.add(s));
    }

    setSelectedSlots(next);
    await guardarSeleccion(Array.from(next));
  };

  const guardarSeleccion = async (slotList) => {
    setSaving(true);
    try {
      const saved = await api.put(`/parejas/${parejaId}/disponibilidad`, {
        slots: slotList,
      });
      setSelectedSlots(new Set(saved));
      if (onChanged) onChanged(saved.length);
    } catch (err) {
      setError(err.message || 'Error al guardar disponibilidad.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="loading" style={{ padding: '1rem' }}>Cargando grilla de horarios...</div>;
  }

  const sinSlotsConfigurados = grilla.viernes.length === 0 && grilla.sabado.length === 0;

  const primerSlotViernesMin = grilla.viernes.length > 0 ? horaAMinutos(grilla.viernes[0].split('-')[1]) : 0;
  const primerSlotSabadoMin = grilla.sabado.length > 0 ? horaAMinutos(grilla.sabado[0].split('-')[1]) : 0;

  return (
    <div className="disponibilidad-editor">
      {error && <div className="error-message" style={{ marginBottom: '0.75rem' }}>{error}</div>}

      {sinSlotsConfigurados ? (
        <div className="alert-warning" style={{ margin: '0.5rem 0' }}>
          ⚠️ No hay horarios configurados para este torneo. El organizador debe definir la hora de inicio y fin de
          Viernes/Sábado en la configuración del torneo.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-xs)', margin: 0 }}>
            Hacé clic en los horarios en los que esta pareja puede jugar (partidos de 75 min):
          </p>

          {/* Grilla Viernes */}
          {grilla.viernes.length > 0 && (
            <div className="dia-slots-group">
              <div className="dia-slots-header">
                <span className="dia-titulo">🗓️ Viernes ({grilla.viernes.length} turnos)</span>
                <button
                  type="button"
                  className="btn-link-action"
                  onClick={() => seleccionarTodosDia(grilla.viernes)}
                  disabled={saving}
                >
                  {grilla.viernes.every((s) => selectedSlots.has(s)) ? 'Deseleccionar todos' : 'Seleccionar todos'}
                </button>
              </div>
              <div className="slots-grid">
                {grilla.viernes.map((slotId) => {
                  const hora = slotId.split('-')[1];
                  const slotMin = horaAMinutos(hora);
                  const esTrasnoche = slotMin < primerSlotViernesMin;
                  const activo = selectedSlots.has(slotId);
                  return (
                    <button
                      key={slotId}
                      type="button"
                      className={`slot-chip ${activo ? 'selected' : ''}`}
                      onClick={() => toggleSlot(slotId)}
                      disabled={saving}
                      title={esTrasnoche ? `${hora} (trasnoche / madrugada)` : `${hora}`}
                    >
                      {hora} {esTrasnoche && <span style={{ fontSize: '10px' }}>🌙</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Grilla Sábado */}
          {grilla.sabado.length > 0 && (
            <div className="dia-slots-group">
              <div className="dia-slots-header">
                <span className="dia-titulo">🗓️ Sábado ({grilla.sabado.length} turnos)</span>
                <button
                  type="button"
                  className="btn-link-action"
                  onClick={() => seleccionarTodosDia(grilla.sabado)}
                  disabled={saving}
                >
                  {grilla.sabado.every((s) => selectedSlots.has(s)) ? 'Deseleccionar todos' : 'Seleccionar todos'}
                </button>
              </div>
              <div className="slots-grid">
                {grilla.sabado.map((slotId) => {
                  const hora = slotId.split('-')[1];
                  const slotMin = horaAMinutos(hora);
                  const esTrasnoche = slotMin < primerSlotSabadoMin;
                  const activo = selectedSlots.has(slotId);
                  return (
                    <button
                      key={slotId}
                      type="button"
                      className={`slot-chip ${activo ? 'selected' : ''}`}
                      onClick={() => toggleSlot(slotId)}
                      disabled={saving}
                      title={esTrasnoche ? `${hora} (trasnoche / madrugada)` : `${hora}`}
                    >
                      {hora} {esTrasnoche && <span style={{ fontSize: '10px' }}>🌙</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.25rem' }}>
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
              {selectedSlots.size} turno{selectedSlots.size === 1 ? '' : 's'} seleccionado{selectedSlots.size === 1 ? '' : 's'}
              {saving && ' · Guardando...'}
            </span>
            {onClose && (
              <button
                type="button"
                className="btn-link-action"
                onClick={onClose}
              >
                Listo / Cerrar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
