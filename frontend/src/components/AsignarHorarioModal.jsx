import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { Clock, Calendar, Check, AlertTriangle, X } from 'lucide-react';

export default function AsignarHorarioModal({ isOpen, partido, torneoId, onClose, onAssigned }) {
  const [loadingCanchas, setLoadingCanchas] = useState(false);
  const [dataCanchas, setDataCanchas] = useState(null);
  const [selectedSlotId, setSelectedSlotId] = useState('');
  const [selectedCancha, setSelectedCancha] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen && torneoId) {
      cargarCanchasDisponibles();
      setSelectedSlotId('');
      setSelectedCancha(null);
      setError('');
    }
  }, [isOpen, torneoId, partido]);

  const cargarCanchasDisponibles = async () => {
    setLoadingCanchas(true);
    setError('');
    try {
      const res = await api.get(`/torneos/${torneoId}/canchas-disponibles`);
      setDataCanchas(res);
    } catch (err) {
      setError(err.message || 'Error al cargar canchas disponibles.');
    } finally {
      setLoadingCanchas(false);
    }
  };

  if (!isOpen || !partido) return null;

  // Disponibilidad original declarada por las parejas (para referencia)
  const slotsP1 = (partido.pareja1?.slotsSeleccionados || []).map((s) => s.slotId);
  const slotsP2 = (partido.pareja2?.slotsSeleccionados || []).map((s) => s.slotId);
  const slotsEnComunOriginales = slotsP1.filter((s) => slotsP2.includes(s));

  const rawSlots = dataCanchas?.slots || [];

  // FILTRADO SOLICITADO:
  // ÚNICAMENTE horarios donde:
  // 1. Hay al menos una cancha libre (sin otro partido asignado)
  // 2. Ninguna de las 2 parejas afectadas tiene otro partido asignado a esa hora
  const slotsValidos = rawSlots.filter((s) => {
    // 1. Hay al menos una cancha libre
    if (!s.canchasLibres || s.canchasLibres.length === 0) return false;

    // 2. Ninguna de las dos parejas tiene partido asignado en este turno
    const p1Ocupada = partido.pareja1Id && (s.parejasOcupadasIds || []).includes(partido.pareja1Id);
    const p2Ocupada = partido.pareja2Id && (s.parejasOcupadasIds || []).includes(partido.pareja2Id);
    if (p1Ocupada || p2Ocupada) return false;

    return true;
  });

  const slotsViernesValidos = slotsValidos.filter((s) => s.dia === 'Viernes');
  const slotsSabadoValidos = slotsValidos.filter((s) => s.dia === 'Sabado');

  const slotActualSeleccionado = slotsValidos.find((s) => s.slotId === selectedSlotId);
  const canchasDisponibles = slotActualSeleccionado?.canchasLibres || [];

  const handleConfirmar = async () => {
    if (!selectedSlotId || !selectedCancha) {
      setError('Por favor seleccioná un horario y una cancha libre.');
      return;
    }

    setGuardando(true);
    setError('');
    try {
      await api.put(`/partidos/${partido.id}/asignar-horario-manual`, {
        slotId: selectedSlotId,
        canchaNumero: selectedCancha,
      });
      if (onAssigned) onAssigned();
      onClose();
    } catch (err) {
      setError(err.message || 'Error al asignar horario y cancha.');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '640px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.6rem' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--color-text)' }}>
              Asignar horario y cancha libre
            </h3>
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
              {partido.categoria?.nombre} · {partido.zona?.nombre || 'Zona'}
            </span>
          </div>
          <button type="button" className="btn-link-action" onClick={onClose} style={{ color: 'var(--color-text-secondary)' }}>
            <X size={18} />
          </button>
        </div>

        {/* Info del partido */}
        <div style={{ padding: '0.75rem 0.9rem', background: 'var(--color-surface)', borderRadius: 'var(--radius-sm)', marginBottom: '1rem' }}>
          <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text)' }}>
            {partido.pareja1 ? `${partido.pareja1.jugador1} / ${partido.pareja1.jugador2}` : 'Pareja 1'} vs{' '}
            {partido.pareja2 ? `${partido.pareja2.jugador1} / ${partido.pareja2.jugador2}` : 'Pareja 2'}
          </div>
          {slotsEnComunOriginales.length > 0 ? (
            <div style={{ marginTop: '0.35rem', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
              <Check size={12} style={{ color: 'var(--color-success)' }} /> Disponibilidad original compartida: {slotsEnComunOriginales.join(', ')}
            </div>
          ) : (
            <div style={{ marginTop: '0.35rem', fontSize: 'var(--font-size-xs)', color: 'var(--color-warning)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
              <AlertTriangle size={12} /> Sin franjas coincidentes en la inscripción original (coordinar telefónicamente)
            </div>
          )}
        </div>

        {error && (
          <div className="error-message" style={{ marginBottom: '1rem' }}>
            {error}
          </div>
        )}

        {/* Contenido */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem', paddingRight: '0.25rem' }}>
          {loadingCanchas ? (
            <div className="loading" style={{ padding: '2rem' }}>Consultando canchas y parejas libres en tiempo real...</div>
          ) : slotsValidos.length === 0 ? (
            <div
              style={{
                padding: '1.25rem',
                background: 'rgba(245, 158, 11, 0.08)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                borderRadius: 'var(--radius-md)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.75rem',
              }}
            >
              <AlertTriangle size={22} color="var(--color-warning)" style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong style={{ color: 'var(--color-warning)', fontSize: 'var(--font-size-sm)', display: 'block', marginBottom: '0.3rem' }}>
                  No hay turnos disponibles donde haya cancha libre y ambas parejas no estén jugando
                </strong>
                <p style={{ margin: 0, fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>
                  En todos los turnos del torneo las canchas están 100% ocupadas por otros partidos o alguna de las dos parejas ya tiene un partido asignado en simultáneo.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div>
                <label style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '0.4rem' }}>
                  1. SELECCIONÁ UN HORARIO CON CANCHA LIBRE Y AMBAS PAREJAS DISPONIBLES:
                </label>

                {slotsViernesValidos.length > 0 && (
                  <div style={{ marginBottom: '0.75rem' }}>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '0.25rem' }}>
                      Viernes ({slotsViernesValidos.length} turnos con canchas libres y parejas disponibles):
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                      {slotsViernesValidos.map((s) => {
                        const isSelected = selectedSlotId === s.slotId;
                        const esOriginalComun = slotsEnComunOriginales.includes(s.slotId);
                        return (
                          <button
                            key={s.slotId}
                            type="button"
                            className={`slot-chip ${isSelected ? 'selected' : ''}`}
                            style={{
                              padding: '0.35rem 0.6rem',
                              border: esOriginalComun && !isSelected ? '1px solid var(--color-success)' : undefined,
                            }}
                            onClick={() => {
                              setSelectedSlotId(s.slotId);
                              setSelectedCancha(s.canchasLibres[0] || null);
                            }}
                            title={esOriginalComun ? 'Coincide con disponibilidad original' : 'Horario con cancha libre'}
                          >
                            {s.hora} ({s.canchasLibres.length} {s.canchasLibres.length === 1 ? 'lib.' : 'lib.'})
                            {esOriginalComun && <span style={{ marginLeft: '4px', color: 'var(--color-success)', fontSize: '10px' }}>★</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {slotsSabadoValidos.length > 0 && (
                  <div>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '0.25rem' }}>
                      Sábado ({slotsSabadoValidos.length} turnos con canchas libres y parejas disponibles):
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                      {slotsSabadoValidos.map((s) => {
                        const isSelected = selectedSlotId === s.slotId;
                        const esOriginalComun = slotsEnComunOriginales.includes(s.slotId);
                        return (
                          <button
                            key={s.slotId}
                            type="button"
                            className={`slot-chip ${isSelected ? 'selected' : ''}`}
                            style={{
                              padding: '0.35rem 0.6rem',
                              border: esOriginalComun && !isSelected ? '1px solid var(--color-success)' : undefined,
                            }}
                            onClick={() => {
                              setSelectedSlotId(s.slotId);
                              setSelectedCancha(s.canchasLibres[0] || null);
                            }}
                            title={esOriginalComun ? 'Coincide con disponibilidad original' : 'Horario con cancha libre'}
                          >
                            {s.hora} ({s.canchasLibres.length} {s.canchasLibres.length === 1 ? 'lib.' : 'lib.'})
                            {esOriginalComun && <span style={{ marginLeft: '4px', color: 'var(--color-success)', fontSize: '10px' }}>★</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Selección de Cancha */}
              {selectedSlotId && canchasDisponibles.length > 0 && (
                <div style={{ padding: '0.75rem', background: 'var(--color-surface-elevated)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
                  <label style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '0.4rem' }}>
                    2. SELECCIONÁ LA CANCHA LIBRE PARA EL {selectedSlotId.toUpperCase()}:
                  </label>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {canchasDisponibles.map((cNum) => (
                      <button
                        key={cNum}
                        type="button"
                        className={`btn-secondary ${selectedCancha === cNum ? 'btn-primary' : ''}`}
                        style={{
                          padding: '0.4rem 0.9rem',
                          fontWeight: 600,
                          fontSize: 'var(--font-size-sm)',
                        }}
                        onClick={() => setSelectedCancha(cNum)}
                      >
                        Cancha {cNum}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--color-border)', marginTop: '0.5rem' }}>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={guardando}>
            Cancelar
          </button>
          {slotsValidos.length > 0 && (
            <button
              type="button"
              className="btn-primary"
              onClick={handleConfirmar}
              disabled={guardando || !selectedSlotId || !selectedCancha}
            >
              {guardando ? 'Asignando...' : 'Confirmar Asignación'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
