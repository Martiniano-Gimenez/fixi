import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { Phone, Check, AlertTriangle, ChevronDown, ChevronUp, Star, Loader2 } from 'lucide-react';

export default function InlineDisponibilidadEditor({
  parejaId,
  parejaNombre,
  initialSlotIds = [],
  slotsViables = [],
  slotsQueDestraban = [],
  esZonaManual = false,
  grilla = { viernes: [], sabado: [] },
  onSaved,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [currentSlotIds, setCurrentSlotIds] = useState(initialSlotIds);
  const [selectedNewSlots, setSelectedNewSlots] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [showOtrosViables, setShowOtrosViables] = useState(false);
  const [applyingEstrellaSlot, setApplyingEstrellaSlot] = useState(null);

  useEffect(() => {
    setCurrentSlotIds(initialSlotIds);
    setSelectedNewSlots(new Set());
    setSavedSuccess(false);
    setError('');
    setWarning('');
  }, [initialSlotIds, parejaId]);

  // FILTRADO ESTRICTO:
  // Solo se consideran slots dentro de slotsViables (cancha libre + pareja libre de superposición).
  const poolSlots = Array.isArray(slotsViables) && slotsViables.length > 0
    ? slotsViables
    : [...(grilla.viernes || []), ...(grilla.sabado || [])];

  const slotsNuevosDisponibles = poolSlots.filter((s) => !currentSlotIds.includes(s));

  // 1. Turnos con estrella (destraban directamente)
  const estrellaSlots = slotsNuevosDisponibles.filter((s) => slotsQueDestraban.includes(s));
  const viernesEstrella = estrellaSlots.filter((s) => s.startsWith('Viernes'));
  const sabadoEstrella = estrellaSlots.filter((s) => s.startsWith('Sabado'));

  // 2. Otros turnos viables (cancha libre física, pero el rival/grupo aún no los cargó)
  const otrosViablesSlots = slotsNuevosDisponibles.filter((s) => !slotsQueDestraban.includes(s));
  const viernesOtros = otrosViablesSlots.filter((s) => s.startsWith('Viernes'));
  const sabadoOtros = otrosViablesSlots.filter((s) => s.startsWith('Sabado'));

  const totalDisponiblesParaAgregar = slotsNuevosDisponibles.length;

  const toggleSlot = (slotId) => {
    if (saving || isSyncing || applyingEstrellaSlot) return;
    setSavedSuccess(false);
    setWarning('');
    setError('');
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

  // 1-click auto-save para ★ estrella slots (destraban directamente)
  const handleQuickSaveEstrella = async (slotId) => {
    if (saving || isSyncing || applyingEstrellaSlot) return;
    setApplyingEstrellaSlot(slotId);
    setError('');
    setWarning('');
    setSavedSuccess(false);
    let saved = null;
    try {
      const allSlots = Array.from(new Set([...currentSlotIds, slotId]));
      saved = await api.put(`/parejas/${parejaId}/disponibilidad`, {
        slots: allSlots,
      });
      setCurrentSlotIds(saved);
      setSelectedNewSlots(new Set());
      setSavedSuccess(true);
    } catch (err) {
      setError(err.message || 'Error al guardar disponibilidad.');
      setApplyingEstrellaSlot(null);
      return;
    }

    // Disparar recálculo automático si el commit fue exitoso
    if (onSaved && saved) {
      setIsSyncing(true);
      try {
        await onSaved(parejaId, saved);
      } catch (err) {
        setWarning('Turno guardado, pero no se pudo re-verificar automáticamente. Hacé clic en "Volver a verificar" abajo.');
      } finally {
        setIsSyncing(false);
        setApplyingEstrellaSlot(null);
      }
    } else {
      setApplyingEstrellaSlot(null);
    }
  };

  const handleSave = async () => {
    if (selectedNewSlots.size === 0 || saving || isSyncing || applyingEstrellaSlot) return;
    setSaving(true);
    setError('');
    setWarning('');
    let saved = null;
    try {
      const allSlots = Array.from(new Set([...currentSlotIds, ...Array.from(selectedNewSlots)]));
      saved = await api.put(`/parejas/${parejaId}/disponibilidad`, {
        slots: allSlots,
      });
      setCurrentSlotIds(saved);
      setSelectedNewSlots(new Set());
      setSavedSuccess(true);
    } catch (err) {
      setError(err.message || 'Error al guardar disponibilidad.');
      setSaving(false);
      return; // No intentar re-verificar si falló el guardado
    } finally {
      setSaving(false);
    }

    // Disparar recálculo automático si el commit fue exitoso
    if (onSaved && saved) {
      setIsSyncing(true);
      try {
        await onSaved(parejaId, saved);
      } catch (err) {
        setWarning('Turno guardado, pero no se pudo re-verificar automáticamente. Hacé clic en "Volver a verificar" abajo.');
      } finally {
        setIsSyncing(false);
      }
    }
  };

  if (totalDisponiblesParaAgregar === 0 && !savedSuccess) {
    return (
      <div style={{ marginTop: '0.4rem', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>
        No hay turnos con canchas libres disponibles en el club para ofrecerle a esta pareja.
      </div>
    );
  }

  const isBusy = saving || isSyncing || Boolean(applyingEstrellaSlot);

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
          {estrellaSlots.length > 0 && (
            <span
              style={{
                fontSize: '10px',
                background: 'rgba(34, 197, 94, 0.15)',
                color: 'var(--color-success)',
                padding: '2px 6px',
                borderRadius: '10px',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '2px',
              }}
            >
              <Star size={10} fill="currentColor" />
              {estrellaSlots.length === 1 ? '1 opción que destraba' : `${estrellaSlots.length} opciones que destraban`}
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
          {/* Mensaje contextual */}
          <div style={{ margin: '0 0 0.5rem 0', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>
            {estrellaSlots.length > 0 ? (
              <span style={{ color: 'var(--color-success)', fontWeight: 600 }}>
                ★ Tocá cualquier turno para resolver el cruce en 1 click:
              </span>
            ) : esZonaManual ? (
              <span>
                Ningún turno libre garantiza compatibilidad para todo el grupo. Podés proponer turnos con cancha libre de abajo o reestructurar la zona.
              </span>
            ) : (
              <span>
                El rival no tiene más horarios cargados con cancha libre. Podés proponerle a esta pareja alguno de los turnos viables del club:
              </span>
            )}
          </div>

          {/* Turnos con Estrella (Prioridad 1) */}
          {estrellaSlots.length > 0 && (
            <div style={{ marginBottom: '0.6rem' }}>
              {viernesEstrella.length > 0 && (
                <div style={{ marginBottom: '0.4rem' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '0.25rem' }}>
                    Viernes que destraba:
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                    {viernesEstrella.map((slotId) => {
                      const isThisApplying = applyingEstrellaSlot === slotId;
                      const hora = slotId.split('-')[1];
                      return (
                        <button
                          key={slotId}
                          type="button"
                          disabled={isBusy}
                          className="slot-chip"
                          style={{
                            padding: '0.25rem 0.5rem',
                            fontSize: '11px',
                            border: '1px solid var(--color-success)',
                            background: isThisApplying ? 'var(--color-primary)' : 'rgba(34, 197, 94, 0.08)',
                            color: isThisApplying ? '#000' : undefined,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.25rem',
                          }}
                          onClick={() => handleQuickSaveEstrella(slotId)}
                          title="¡Tocá para resolver el cruce con este turno!"
                        >
                          {isThisApplying ? (
                            <><Loader2 size={11} className="spin" /> {hora}</>
                          ) : (
                            <>{hora}<span style={{ color: 'var(--color-success)', fontWeight: 'bold' }}>★</span></>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {sabadoEstrella.length > 0 && (
                <div style={{ marginBottom: '0.4rem' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '0.25rem' }}>
                    Sábado que destraba:
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                    {sabadoEstrella.map((slotId) => {
                      const isThisApplying = applyingEstrellaSlot === slotId;
                      const hora = slotId.split('-')[1];
                      return (
                        <button
                          key={slotId}
                          type="button"
                          disabled={isBusy}
                          className="slot-chip"
                          style={{
                            padding: '0.25rem 0.5rem',
                            fontSize: '11px',
                            border: '1px solid var(--color-success)',
                            background: isThisApplying ? 'var(--color-primary)' : 'rgba(34, 197, 94, 0.08)',
                            color: isThisApplying ? '#000' : undefined,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.25rem',
                          }}
                          onClick={() => handleQuickSaveEstrella(slotId)}
                          title="¡Tocá para resolver el cruce con este turno!"
                        >
                          {isThisApplying ? (
                            <><Loader2 size={11} className="spin" /> {hora}</>
                          ) : (
                            <>{hora}<span style={{ color: 'var(--color-success)', fontWeight: 'bold' }}>★</span></>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Toggle para otros turnos viables sin coincidencia */}
          {otrosViablesSlots.length > 0 && (
            <div style={{ marginTop: '0.4rem', marginBottom: '0.5rem' }}>
              <button
                type="button"
                className="btn-link-action"
                style={{
                  padding: 0,
                  fontSize: '11px',
                  color: 'var(--color-text-secondary)',
                  textDecoration: 'underline',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                }}
                onClick={() => setShowOtrosViables((prev) => !prev)}
              >
                {showOtrosViables
                  ? 'Ocultar otros turnos viables del club'
                  : `+ Ver otros turnos viables con cancha libre (${otrosViablesSlots.length})`}
              </button>

              {showOtrosViables && (
                <div
                  style={{
                    marginTop: '0.4rem',
                    padding: '0.5rem',
                    background: 'var(--color-surface)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  <div style={{ fontSize: '10.5px', color: 'var(--color-text-secondary)', marginBottom: '0.4rem', fontStyle: 'italic' }}>
                    Turnos con cancha libre en el club (requiere que el rival o grupo también confirme disponibilidad en este horario):
                  </div>

                  {viernesOtros.length > 0 && (
                    <div style={{ marginBottom: '0.35rem' }}>
                      <div style={{ fontSize: '10.5px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '0.2rem' }}>
                        Viernes:
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                        {viernesOtros.map((slotId) => {
                          const isChecked = selectedNewSlots.has(slotId);
                          const hora = slotId.split('-')[1];
                          return (
                            <button
                              key={slotId}
                              type="button"
                              disabled={isBusy}
                              className={`slot-chip ${isChecked ? 'selected' : ''}`}
                              style={{ padding: '0.2rem 0.45rem', fontSize: '10.5px' }}
                              onClick={() => toggleSlot(slotId)}
                            >
                              {hora}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {sabadoOtros.length > 0 && (
                    <div>
                      <div style={{ fontSize: '10.5px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '0.2rem' }}>
                        Sábado:
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                        {sabadoOtros.map((slotId) => {
                          const isChecked = selectedNewSlots.has(slotId);
                          const hora = slotId.split('-')[1];
                          return (
                            <button
                              key={slotId}
                              type="button"
                              disabled={isBusy}
                              className={`slot-chip ${isChecked ? 'selected' : ''}`}
                              style={{ padding: '0.2rem 0.45rem', fontSize: '10.5px' }}
                              onClick={() => toggleSlot(slotId)}
                            >
                              {hora}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {error && <div className="error-message" style={{ margin: '0.4rem 0', fontSize: '11px' }}>{error}</div>}
          {warning && (
            <div style={{ margin: '0.4rem 0', fontSize: '11px', color: 'var(--color-warning)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <AlertTriangle size={13} /> {warning}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.6rem' }}>
            <div>
              {savedSuccess && !warning && (
                <span style={{ color: 'var(--color-success)', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontWeight: 600 }}>
                  <Check size={13} /> Turno guardado exitosamente.
                </span>
              )}
            </div>
            <button
              type="button"
              className="btn-primary"
              style={{
                padding: '0.3rem 0.75rem',
                fontSize: 'var(--font-size-xs)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
              }}
              onClick={handleSave}
              disabled={isBusy || selectedNewSlots.size === 0}
            >
              {isBusy && <Loader2 size={13} className="spin" />}
              {saving
                ? 'Guardando turno...'
                : isSyncing
                ? 'Verificando compatibilidad...'
                : `Guardar ${selectedNewSlots.size} ${selectedNewSlots.size === 1 ? 'turno' : 'turnos'}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
