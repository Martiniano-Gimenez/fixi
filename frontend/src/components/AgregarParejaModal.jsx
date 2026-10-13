import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { X, UserPlus, Loader2, AlertCircle, CheckCircle2, Check } from 'lucide-react';
import DisponibilidadEditor from './DisponibilidadEditor';

function StepBadge({ number, status }) {
  if (status === 'completed') {
    return (
      <span
        style={{
          width: '22px',
          height: '22px',
          borderRadius: '50%',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0, 208, 132, 0.12)',
          border: '1px solid rgba(0, 208, 132, 0.35)',
          color: 'var(--color-primary)',
          fontSize: '0.75rem',
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        <Check size={13} strokeWidth={3} />
      </span>
    );
  }

  if (status === 'active') {
    return (
      <span
        style={{
          width: '22px',
          height: '22px',
          borderRadius: '50%',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0, 208, 132, 0.22)',
          border: '1px solid var(--color-primary)',
          color: 'var(--color-primary)',
          fontSize: '0.75rem',
          fontWeight: 700,
          boxShadow: '0 0 8px rgba(0, 208, 132, 0.3)',
          flexShrink: 0,
        }}
      >
        {number}
      </span>
    );
  }

  return (
    <span
      style={{
        width: '22px',
        height: '22px',
        borderRadius: '50%',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(255, 255, 255, 0.04)',
        border: '1px solid var(--color-border)',
        color: 'var(--color-text-secondary)',
        fontSize: '0.75rem',
        fontWeight: 600,
        flexShrink: 0,
        opacity: 0.6,
      }}
    >
      {number}
    </span>
  );
}

export default function AgregarParejaModal({ isOpen, onClose, categoriaId, zonas = [], partidos = [], onSuccess }) {
  const [jugador1, setJugador1] = useState('');
  const [jugador2, setJugador2] = useState('');
  const [zonaDestinoId, setZonaDestinoId] = useState('');
  const [slotIds, setSlotIds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setJugador1('');
      setJugador2('');
      setZonaDestinoId('');
      setSlotIds([]);
      setError('');
      setLoading(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Analizar estado de cada zona para validar restricciones
  const destinoZonas = zonas.map((z) => {
    const zonaPartidos = partidos.filter((p) => p.zonaId === z.id);
    const partidosNoPendientes = zonaPartidos.filter((p) => p.estado !== 'PENDIENTE');
    const parejasCount = z.zonaParejas?.length || 0;
    const bloqueada = partidosNoPendientes.length > 0;
    const puedeSerDestino = !bloqueada && parejasCount < 4;

    let motivoDisabled = '';
    if (bloqueada) motivoDisabled = ' (Tiene partidos en curso o jugados)';
    else if (parejasCount >= 4) motivoDisabled = ' (Máximo de 4 parejas alcanzado)';

    return {
      id: z.id,
      nombre: z.nombre,
      disabled: !puedeSerDestino,
      motivoDisabled,
      parejasCount,
    };
  });

  const zonaDestinoSeleccionada = destinoZonas.find((z) => z.id === zonaDestinoId);

  // Estados de los pasos (3 pasos)
  const paso1Completo = jugador1.trim() !== '' && jugador2.trim() !== '';
  const paso1Status = paso1Completo ? 'completed' : 'active';
  const paso2Status = zonaDestinoId ? 'completed' : (paso1Completo ? 'active' : 'pending');
  const paso3Status = slotIds.length > 0 ? 'completed' : (zonaDestinoId ? 'active' : 'pending');

  const getInputStyle = (value, disabled) => ({
    width: '100%',
    padding: '0.65rem 0.85rem',
    background: disabled ? 'rgba(255, 255, 255, 0.02)' : 'var(--color-bg)',
    border: value && value.trim()
      ? '1px solid var(--color-primary)'
      : '1px solid var(--color-border)',
    boxShadow: value && value.trim() ? '0 0 0 1px rgba(0, 208, 132, 0.2)' : 'none',
    borderRadius: 'var(--border-radius-sm)',
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-sm)',
    outline: 'none',
    transition: 'border-color var(--transition-fast), box-shadow var(--transition-fast)',
  });

  const getSelectStyle = (value, disabled) => ({
    width: '100%',
    padding: '0.65rem 0.85rem',
    background: disabled ? 'rgba(255, 255, 255, 0.02)' : 'var(--color-bg)',
    border: value
      ? '1px solid var(--color-primary)'
      : '1px solid var(--color-border)',
    boxShadow: value ? '0 0 0 1px rgba(0, 208, 132, 0.2)' : 'none',
    borderRadius: 'var(--border-radius-sm)',
    color: value ? 'var(--color-text)' : 'var(--color-text-secondary)',
    fontSize: 'var(--font-size-sm)',
    outline: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'border-color var(--transition-fast), box-shadow var(--transition-fast)',
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!jugador1.trim() || !jugador2.trim() || !zonaDestinoId || !slotIds || slotIds.length === 0) {
      setError('Completá los nombres de ambos jugadores, la zona destino y seleccioná al menos un horario.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await api.post(`/categorias/${categoriaId}/zonas/agregar-pareja`, {
        zonaDestinoId,
        jugador1: jugador1.trim(),
        jugador2: jugador2.trim(),
        slotIds,
      });

      if (onSuccess) {
        onSuccess(
          `Pareja ${jugador1.trim()} / ${jugador2.trim()} agregada a ${zonaDestinoSeleccionada?.nombre || 'la zona'}. Partidos y horarios actualizados.`,
          res
        );
      }
      onClose();
    } catch (err) {
      setError(err.message || 'Error al agregar la pareja.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1100,
        backdropFilter: 'blur(4px)',
        padding: '1rem',
        paddingTop: 'max(1rem, env(safe-area-inset-top, 0px))',
        paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))',
        boxSizing: 'border-box',
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="card"
        style={{
          width: '100%',
          maxWidth: '560px',
          maxHeight: 'min(92vh, calc(100dvh - 2rem))',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 'var(--border-radius-lg)',
          boxShadow: 'var(--shadow-xl)',
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-border)',
          overflow: 'hidden',
          margin: 0,
          padding: 0,
          boxSizing: 'border-box',
        }}
      >
        {/* Header Fijo */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '1.15rem 1.25rem 0.95rem 1.25rem',
            borderBottom: '1px solid var(--color-border)',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: 'rgba(59, 130, 246, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--color-info, #3b82f6)',
                flexShrink: 0,
              }}
            >
              <UserPlus size={16} />
            </div>
            <h2 style={{ fontSize: '1.1rem', margin: 0, fontWeight: 600, color: 'var(--color-text)' }}>
              Agregar Pareja a Zona
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            aria-label="Cerrar modal"
            style={{
              minWidth: '44px',
              minHeight: '44px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: 'none',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
              borderRadius: 'var(--border-radius-sm)',
              margin: '-0.5rem -0.5rem -0.5rem 0',
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Cuerpo Scrollable */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '1.15rem 1.25rem',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {error && (
            <div
              className="error-message"
              style={{
                marginBottom: '1rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: 'var(--font-size-sm)',
                padding: '0.75rem 1rem',
              }}
            >
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
            {/* Paso 1: Jugadores */}
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: 'var(--font-size-sm)', fontWeight: 500, marginBottom: '0.45rem' }}>
                <StepBadge number={1} status={paso1Status} />
                <span style={{ color: paso1Status === 'active' ? 'var(--color-text)' : 'var(--color-text-secondary)' }}>
                  Integrantes de la Pareja
                </span>
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <input
                    type="text"
                    style={getInputStyle(jugador1, loading)}
                    placeholder="Jugador 1"
                    value={jugador1}
                    onChange={(e) => setJugador1(e.target.value)}
                    disabled={loading}
                    required
                  />
                </div>
                <div>
                  <input
                    type="text"
                    style={getInputStyle(jugador2, loading)}
                    placeholder="Jugador 2"
                    value={jugador2}
                    onChange={(e) => setJugador2(e.target.value)}
                    disabled={loading}
                    required
                  />
                </div>
              </div>
            </div>

            {/* Paso 2: Zona Destino */}
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: 'var(--font-size-sm)', fontWeight: 500, marginBottom: '0.45rem' }}>
                <StepBadge number={2} status={paso2Status} />
                <span style={{ color: paso2Status === 'active' ? 'var(--color-text)' : 'var(--color-text-secondary)' }}>
                  Zona de Asignación
                </span>
              </label>
              <select
                style={getSelectStyle(zonaDestinoId, loading)}
                value={zonaDestinoId}
                onChange={(e) => setZonaDestinoId(e.target.value)}
                disabled={loading}
                required
              >
                <option value="">Seleccioná la zona destino...</option>
                {destinoZonas.map((z) => (
                  <option key={z.id} value={z.id} disabled={z.disabled}>
                    {z.nombre} {z.disabled ? z.motivoDisabled : `(actual: ${z.parejasCount} parejas)`}
                  </option>
                ))}
              </select>
            </div>

            {/* Paso 3: Disponibilidad Horaria */}
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: 'var(--font-size-sm)', fontWeight: 500, marginBottom: '0.45rem' }}>
                <StepBadge number={3} status={paso3Status} />
                <span style={{ color: paso3Status === 'active' ? 'var(--color-text)' : 'var(--color-text-secondary)' }}>
                  Disponibilidad Horaria
                </span>
              </label>
              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--border-radius-md)',
                  padding: '0.85rem',
                }}
              >
                <DisponibilidadEditor
                  value={slotIds}
                  onChange={setSlotIds}
                />
              </div>
              <div style={{ marginTop: '0.4rem', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                Marcá al menos un horario. Si puede jugar cualquier día y hora, usá «Día completo».
              </div>
            </div>

            {/* Resumen explicativo */}
            {jugador1.trim() && jugador2.trim() && zonaDestinoSeleccionada && (
              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--border-radius-md)',
                  padding: '0.85rem 1rem',
                  fontSize: 'var(--font-size-xs)',
                  color: 'var(--color-text-secondary)',
                  lineHeight: 1.5,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--color-text)', fontWeight: 600, marginBottom: '0.35rem' }}>
                  <CheckCircle2 size={15} style={{ color: 'var(--color-primary)' }} />
                  <span>Impacto de la incorporación:</span>
                </div>
                <div>• <strong>{jugador1.trim()} / {jugador2.trim()}</strong> ingresará como nueva pareja en <strong>{zonaDestinoSeleccionada.nombre}</strong> (pasará a tener {zonaDestinoSeleccionada.parejasCount + 1} parejas).</div>
                {slotIds.length > 0 && (
                  <div>• Disponibilidad: <strong>{slotIds.length} turnos seleccionados</strong>.</div>
                )}
                <div>• Se regenerarán únicamente los partidos de esta zona y se programarán automáticamente sus horarios sin modificar otras zonas ni el cuadro eliminatorio.</div>
              </div>
            )}
          </div>
        </div>

        {/* Footer Fijo */}
        <div
          style={{
            padding: '0.85rem 1.25rem',
            paddingBottom: 'max(0.85rem, env(safe-area-inset-bottom, 0px))',
            borderTop: '1px solid var(--color-border)',
            background: 'var(--color-bg-card)',
            display: 'flex',
            gap: '0.75rem',
            justifyContent: 'flex-end',
            alignItems: 'center',
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            className="btn-outline"
            onClick={onClose}
            disabled={loading}
            style={{ minHeight: '38px', padding: '0.5rem 1rem' }}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={!jugador1.trim() || !jugador2.trim() || !zonaDestinoId || !slotIds || slotIds.length === 0 || loading}
            style={{
              minHeight: '38px',
              padding: '0.5rem 1.15rem',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.45rem',
              whiteSpace: 'nowrap',
            }}
          >
            {loading ? (
              <>
                <Loader2 size={16} className="spinner" /> Agregando...
              </>
            ) : (
              <>
                <UserPlus size={16} /> Agregar Pareja
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
