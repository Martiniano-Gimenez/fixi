import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { Clock, Check, AlertTriangle, ChevronDown, ChevronUp, Star, Loader2 } from 'lucide-react';

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
      } catch {
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
      } catch {
        setWarning('Turno guardado, pero no se pudo re-verificar automáticamente. Hacé clic en "Volver a verificar" abajo.');
      } finally {
        setIsSyncing(false);
      }
    }
  };

  if (totalDisponiblesParaAgregar === 0 && !savedSuccess) {
    return (
      <div className="pc-muted pc-spaced">
        No hay turnos con canchas libres disponibles en el club para ofrecerle a esta pareja.
      </div>
    );
  }

  const isBusy = saving || isSyncing || Boolean(applyingEstrellaSlot);

  return (
    <div className="pc-inline">
      <div
        className="pc-inline-heading"
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <div className="pc-inline-label">
          <Clock size={13} />
          <span>Ampliar horarios</span>
          {estrellaSlots.length > 0 && (
            <span className="pc-badge pc-blue-badge">
              <Star size={10} fill="currentColor" />
              {estrellaSlots.length === 1 ? '1 opción que destraba' : `${estrellaSlots.length} opciones que destraban`}
            </span>
          )}
        </div>
        <button
          type="button"
          className="pc-button pc-inline-toggle"
          aria-label={`Disponibilidad de ${parejaNombre}`}
          aria-expanded={isOpen}
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen((prev) => !prev);
          }}
        >
          {isOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
      </div>

      {isOpen && (
        <div className="pc-inline-body">
          {/* Mensaje contextual */}
          {(estrellaSlots.length > 0 || !esZonaManual) && (
            <div className="pc-muted pc-spaced">
              {estrellaSlots.length > 0 ? (
                <span className="pc-quick-copy">Horarios que resuelven el conflicto:</span>
              ) : (
                <span>El rival no tiene más horarios con cancha libre.</span>
              )}
            </div>
          )}

          {/* Turnos con Estrella (Prioridad 1) */}
          {estrellaSlots.length > 0 && (
            <div className="pc-quick-slots">
              {viernesEstrella.length > 0 && (
                <div className="pc-day">
                  <div className="pc-day-title">
                    Viernes
                  </div>
                  <div className="pc-slots">
                    {viernesEstrella.map((slotId) => {
                      const isThisApplying = applyingEstrellaSlot === slotId;
                      const hora = slotId.split('-')[1];
                      return (
                        <button
                          key={slotId}
                          type="button"
                          disabled={isBusy}
                          className={`pc-slot pc-suggested-slot${isThisApplying ? ' is-applying' : ''}`}
                          onClick={() => handleQuickSaveEstrella(slotId)}
                          title="Guardar este horario y resolver"
                        >
                          {isThisApplying ? (
                            <><Loader2 size={11} className="pc-spin" /> {hora}</>
                          ) : (
                            hora
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {sabadoEstrella.length > 0 && (
                <div className="pc-day">
                  <div className="pc-day-title">
                    Sábado
                  </div>
                  <div className="pc-slots">
                    {sabadoEstrella.map((slotId) => {
                      const isThisApplying = applyingEstrellaSlot === slotId;
                      const hora = slotId.split('-')[1];
                      return (
                        <button
                          key={slotId}
                          type="button"
                          disabled={isBusy}
                          className={`pc-slot pc-suggested-slot${isThisApplying ? ' is-applying' : ''}`}
                          onClick={() => handleQuickSaveEstrella(slotId)}
                          title="Guardar este horario y resolver"
                        >
                          {isThisApplying ? (
                            <><Loader2 size={11} className="pc-spin" /> {hora}</>
                          ) : (
                            hora
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
            <div className="pc-other-slots">
              <button
                type="button"
                className="pc-link"
                onClick={() => setShowOtrosViables((prev) => !prev)}
              >
                {showOtrosViables
                  ? 'Ocultar'
                  : 'Elegir otros horarios'}
              </button>

              {showOtrosViables && (
                <div className="pc-other-body">
                  <div className="pc-muted pc-spaced">
                    Horarios de inicio con cancha libre. Podés elegir varios:
                  </div>

                  {viernesOtros.length > 0 && (
                    <div className="pc-day">
                      <div className="pc-day-title">
                        Viernes:
                      </div>
                      <div className="pc-slots">
                        {viernesOtros.map((slotId) => {
                          const isChecked = selectedNewSlots.has(slotId);
                          const hora = slotId.split('-')[1];
                          return (
                            <button
                              key={slotId}
                              type="button"
                              disabled={isBusy}
                              className={`pc-slot${isChecked ? ' is-selected' : ''}`}
                              onClick={() => toggleSlot(slotId)}
                              aria-pressed={isChecked}
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
                      <div className="pc-day-title">
                        Sábado:
                      </div>
                      <div className="pc-slots">
                        {sabadoOtros.map((slotId) => {
                          const isChecked = selectedNewSlots.has(slotId);
                          const hora = slotId.split('-')[1];
                          return (
                            <button
                              key={slotId}
                              type="button"
                              disabled={isBusy}
                              className={`pc-slot${isChecked ? ' is-selected' : ''}`}
                              onClick={() => toggleSlot(slotId)}
                              aria-pressed={isChecked}
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

          {error && <div className="pc-notice pc-danger-notice">{error}</div>}
          {warning && (
            <div className="pc-notice pc-danger-notice">
              <AlertTriangle size={13} /> {warning}
            </div>
          )}

          <div className="pc-save-row">
            <div>
              {savedSuccess && !warning && (
                <span className="pc-saved">
                  <Check size={13} /> Turno guardado exitosamente.
                </span>
              )}
            </div>
            <button
              type="button"
              className="pc-button"
              onClick={handleSave}
              disabled={isBusy || selectedNewSlots.size === 0}
            >
              {isBusy && <Loader2 size={13} className="pc-spin" />}
              {saving
                ? 'Guardando turno…'
                : isSyncing
                ? 'Verificando compatibilidad…'
                : `Guardar ${selectedNewSlots.size} ${selectedNewSlots.size === 1 ? 'horario' : 'horarios'}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
