import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { Phone, Check, Clock, AlertTriangle, ChevronDown, ChevronUp, Star } from 'lucide-react';

export default function InlineDisponibilidadEditor({
  parejaId,
  parejaNombre,
  initialSlotIds = [],
  slotsViables = [],
  slotsQueDestraban = [],
  grilla = { viernes: [], sabado: [] },
  onSaved,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [currentSlotIds, setCurrentSlotIds] = useState(initialSlotIds);
  const [selectedNewSlots, setSelectedNewSlots] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setCurrentSlotIds(initialSlotIds);
    setSelectedNewSlots(new Set());
    setSavedSuccess(false);
    setError('');
  }, [initialSlotIds, parejaId]);

  // FILTRADO ESTRICTO:
  // Solo se muestran slots donde:
  // 1. Hay cancha libre en esa franja
  // 2. Ninguna de las 2 parejas del cruce tiene otro partido asignado
  // Si slotsViables está disponible, usamos ese pool.
  const poolSlots = Array.isArray(slotsViables) && slotsViables.length > 0
    ? slotsViables
    : [...(grilla.viernes || []), ...(grilla.sabado || [])];

  const viernesDisponibles = poolSlots
    .filter((s) => s.startsWith('Viernes') && !currentSlotIds.includes(s));
  const sabadoDisponibles = poolSlots
    .filter((s) => s.startsWith('Sabado') && !currentSlotIds.includes(s));

  const totalDisponiblesParaAgregar = viernesDisponibles.length + sabadoDisponibles.length;

  const toggleSlot = (slotId) => {
    setSavedSuccess(false);
    setSelectedNewSlots((prev) => {
      const next = new Set(prev);
      if (next.has(slotId)) {
        next.delete(slotId);
      } else {
        next.add(slotId);
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (selectedNewSlots.size === 0) return;
    setSaving(true);
    setError('');
    try {
      const allSlots = Array.from(new Set([...currentSlotIds, ...Array.from(selectedNewSlots)]));
      const saved = await api.put(`/parejas/${parejaId}/disponibilidad`, {
        slots: allSlots,
      });
      setCurrentSlotIds(saved);
      setSelectedNewSlots(new Set());
      setSavedSuccess(true);
      if (onSaved) onSaved(parejaId, saved);
    } catch (err) {
      setError(err.message || 'Error al guardar disponibilidad.');
    } finally {
      setSaving(false);
    }
  };

  if (totalDisponiblesParaAgregar === 0 && !savedSuccess) {
    return (
      <div style={{ marginTop: '0.4rem', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>
        No hay más turnos con canchas libres disponibles en el club para ofrecerle a esta pareja.
      </div>
    );
  }

  return (
    <div
      style={{
        marginTop: '0.5rem',
        padding: '0.5rem 0.65rem',
        background: 'rgba(255, 255, 255, 0.03)',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--color-border)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
        }}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-primary)' }}>
          <Phone size={13} />
          <span>Llamar / Ampliar disponibilidad de {parejaNombre}</span>
          {slotsQueDestraban.length > 0 && (
            <span
              style={{
                fontSize: '10px',
                background: 'rgba(34, 197, 94, 0.15)',
                color: 'var(--color-success)',
                padding: '2px 6px',
                borderRadius: '10px',
                fontWeight: 600,
              }}
            >
              {slotsQueDestraban.length === 1 ? '1 opción con estrella (★)' : `${slotsQueDestraban.length} opciones con estrella (★)`}
            </span>
          )}
        </div>
        <button
          type="button"
          className="btn-link-action"
          style={{ padding: 0, fontSize: 'var(--font-size-xs)', display: 'flex', alignItems: 'center' }}
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen((prev) => !prev);
          }}
        >
          {isOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
      </div>

      {isOpen && (
        <div style={{ marginTop: '0.6rem', borderTop: '1px solid var(--color-border)', paddingTop: '0.6rem' }}>
          <p style={{ margin: '0 0 0.5rem 0', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>
            Mostrando turnos con cancha libre. {slotsQueDestraban.length > 0 ? (
              <strong style={{ color: 'var(--color-success)' }}>
                Con que la pareja acepte al menos 1 turno con estrella (★), este conflicto se destraba.
              </strong>
            ) : (
              'Seleccioná los turnos adicionales que la pareja confirme.'
            )}
          </p>

          {viernesDisponibles.length > 0 && (
            <div style={{ marginBottom: '0.5rem' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '0.25rem' }}>
                Viernes ({viernesDisponibles.length} turnos libres):
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                {viernesDisponibles.map((slotId) => {
                  const isChecked = selectedNewSlots.has(slotId);
                  const destraba = slotsQueDestraban.includes(slotId);
                  const hora = slotId.split('-')[1];
                  return (
                    <button
                      key={slotId}
                      type="button"
                      className={`slot-chip ${isChecked ? 'selected' : ''}`}
                      style={{
                        padding: '0.25rem 0.5rem',
                        fontSize: '11px',
                        border: destraba && !isChecked ? '1px solid var(--color-success)' : undefined,
                        background: destraba && !isChecked ? 'rgba(34, 197, 94, 0.08)' : undefined,
                      }}
                      onClick={() => toggleSlot(slotId)}
                      title={destraba ? '¡Este turno destraba directamente el cruce!' : 'Turno con cancha libre'}
                    >
                      {hora}
                      {destraba && (
                        <span style={{ marginLeft: '4px', color: 'var(--color-success)', fontWeight: 'bold' }}>
                          ★
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {sabadoDisponibles.length > 0 && (
            <div style={{ marginBottom: '0.5rem' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '0.25rem' }}>
                Sábado ({sabadoDisponibles.length} turnos libres):
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                {sabadoDisponibles.map((slotId) => {
                  const isChecked = selectedNewSlots.has(slotId);
                  const destraba = slotsQueDestraban.includes(slotId);
                  const hora = slotId.split('-')[1];
                  return (
                    <button
                      key={slotId}
                      type="button"
                      className={`slot-chip ${isChecked ? 'selected' : ''}`}
                      style={{
                        padding: '0.25rem 0.5rem',
                        fontSize: '11px',
                        border: destraba && !isChecked ? '1px solid var(--color-success)' : undefined,
                        background: destraba && !isChecked ? 'rgba(34, 197, 94, 0.08)' : undefined,
                      }}
                      onClick={() => toggleSlot(slotId)}
                      title={destraba ? '¡Este turno destraba directamente el cruce!' : 'Turno con cancha libre'}
                    >
                      {hora}
                      {destraba && (
                        <span style={{ marginLeft: '4px', color: 'var(--color-success)', fontWeight: 'bold' }}>
                          ★
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {error && <div className="error-message" style={{ margin: '0.4rem 0', fontSize: '11px' }}>{error}</div>}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.6rem' }}>
            <div>
              {savedSuccess && (
                <span style={{ color: 'var(--color-success)', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontWeight: 600 }}>
                  <Check size={13} /> Guardado. Hacé clic en "Volver a verificar" abajo.
                </span>
              )}
            </div>
            <button
              type="button"
              className="btn-primary"
              style={{ padding: '0.3rem 0.75rem', fontSize: 'var(--font-size-xs)' }}
              onClick={handleSave}
              disabled={saving || selectedNewSlots.size === 0}
            >
              {saving ? 'Guardando...' : `Guardar ${selectedNewSlots.size} ${selectedNewSlots.size === 1 ? 'turno' : 'turnos'}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
