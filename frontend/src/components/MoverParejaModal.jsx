import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { X, ArrowRightLeft, Loader2, AlertCircle, CheckCircle2, Check } from 'lucide-react';

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

export default function MoverParejaModal({ isOpen, onClose, categoriaId, zonas = [], partidos = [], onSuccess }) {
  const [zonaOrigenId, setZonaOrigenId] = useState('');
  const [parejaId, setParejaId] = useState('');
  const [zonaDestinoId, setZonaDestinoId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setZonaOrigenId('');
      setParejaId('');
      setZonaDestinoId('');
      setError('');
      setLoading(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Analizar estado de cada zona para validar restricciones
  const zonaStatsMap = new Map();
  for (const z of zonas) {
    const zonaPartidos = partidos.filter((p) => p.zonaId === z.id);
    const partidosNoPendientes = zonaPartidos.filter((p) => p.estado !== 'PENDIENTE');
    const parejasCount = z.zonaParejas?.length || 0;
    zonaStatsMap.set(z.id, {
      bloqueada: partidosNoPendientes.length > 0,
      parejasCount,
      nombre: z.nombre,
    });
  }

  // Zonas de origen: debe tener al menos 3 parejas (para no quedar con < 2) y no estar bloqueada
  const origenZonas = zonas.map((z) => {
    const stats = zonaStatsMap.get(z.id);
    const puedeSerOrigen = !stats.bloqueada && stats.parejasCount >= 3;
    let motivoDisabled = '';
    if (stats.bloqueada) motivoDisabled = ' (Tiene partidos en curso o jugados)';
    else if (stats.parejasCount < 3) motivoDisabled = ` (Tiene ${stats.parejasCount} parejas, no puede quedar con < 2)`;

    return {
      id: z.id,
      nombre: z.nombre,
      disabled: !puedeSerOrigen,
      motivoDisabled,
      parejas: (z.zonaParejas || []).map((zp) => zp.pareja).filter(Boolean),
    };
  });

  const zonaOrigenSeleccionada = origenZonas.find((z) => z.id === zonaOrigenId);
  const parejasDisponibles = zonaOrigenSeleccionada?.parejas || [];

  // Zonas de destino: no puede ser la misma de origen, debe tener < 4 parejas y no estar bloqueada
  const destinoZonas = zonas
    .filter((z) => z.id !== zonaOrigenId)
    .map((z) => {
      const stats = zonaStatsMap.get(z.id);
      const puedeSerDestino = !stats.bloqueada && stats.parejasCount < 4;
      let motivoDisabled = '';
      if (stats.bloqueada) motivoDisabled = ' (Tiene partidos en curso o jugados)';
      else if (stats.parejasCount >= 4) motivoDisabled = ' (Máximo de 4 parejas alcanzado)';

      return {
        id: z.id,
        nombre: z.nombre,
        disabled: !puedeSerDestino,
        motivoDisabled,
        parejasCount: stats.parejasCount,
      };
    });

  const parejaSeleccionada = parejasDisponibles.find((p) => p.id === parejaId);
  const zonaDestinoSeleccionada = destinoZonas.find((z) => z.id === zonaDestinoId);

  // Estados de los pasos (3 estados: completed, active, pending)
  const paso1Status = zonaOrigenId ? 'completed' : 'active';
  const paso2Status = parejaId ? 'completed' : (zonaOrigenId ? 'active' : 'pending');
  const paso3Status = zonaDestinoId ? 'completed' : (parejaId ? 'active' : 'pending');

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
    if (!zonaOrigenId || !parejaId || !zonaDestinoId) {
      setError('Completá todos los campos para continuar.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await api.post(`/categorias/${categoriaId}/zonas/mover-pareja`, {
        parejaId,
        zonaOrigenId,
        zonaDestinoId,
      });

      if (onSuccess) {
        onSuccess('Pareja reubicada correctamente. Los partidos y horarios fueron actualizados.');
      }
      onClose();
    } catch (err) {
      setError(err.message || 'Error al mover la pareja.');
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
          maxWidth: '500px',
          maxHeight: 'min(90vh, calc(100dvh - 2rem))',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 'var(--border-radius-lg)',
          boxShadow: 'var(--shadow-xl)',
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-border)',
          overflow: 'hidden',
          margin: 0,
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
                background: 'rgba(16, 185, 129, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--color-primary)',
                flexShrink: 0,
              }}
            >
              <ArrowRightLeft size={16} />
            </div>
            <h2 style={{ fontSize: '1.1rem', margin: 0, fontWeight: 600, color: 'var(--color-text)' }}>
              Mover Pareja de Zona
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

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
            {/* 1. Zona Origen */}
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: 'var(--font-size-sm)', fontWeight: 500, marginBottom: '0.45rem' }}>
                <StepBadge number={1} status={paso1Status} />
                <span style={{ color: paso1Status === 'active' ? 'var(--color-text)' : 'var(--color-text-secondary)' }}>
                  Zona de Origen
                </span>
              </label>
              <select
                style={getSelectStyle(zonaOrigenId, loading)}
                value={zonaOrigenId}
                onChange={(e) => {
                  setZonaOrigenId(e.target.value);
                  setParejaId('');
                  if (zonaDestinoId === e.target.value) {
                    setZonaDestinoId('');
                  }
                }}
                disabled={loading}
                required
              >
                <option value="">Seleccioná la zona origen...</option>
                {origenZonas.map((z) => (
                  <option key={z.id} value={z.id} disabled={z.disabled}>
                    {z.nombre} {z.disabled ? z.motivoDisabled : `(${z.parejas.length} parejas)`}
                  </option>
                ))}
              </select>
            </div>

            {/* 2. Pareja a Mover */}
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: 'var(--font-size-sm)', fontWeight: 500, marginBottom: '0.45rem' }}>
                <StepBadge number={2} status={paso2Status} />
                <span style={{ color: paso2Status === 'active' ? 'var(--color-text)' : 'var(--color-text-secondary)' }}>
                  Pareja a Mover
                </span>
              </label>
              <select
                style={getSelectStyle(parejaId, !zonaOrigenId || loading || parejasDisponibles.length === 0)}
                value={parejaId}
                onChange={(e) => setParejaId(e.target.value)}
                disabled={!zonaOrigenId || loading || parejasDisponibles.length === 0}
                required
              >
                <option value="">
                  {!zonaOrigenId ? 'Primero seleccioná la zona origen' : 'Seleccioná la pareja...'}
                </option>
                {parejasDisponibles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.jugador1} / {p.jugador2}
                  </option>
                ))}
              </select>
            </div>

            {/* 3. Zona Destino */}
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: 'var(--font-size-sm)', fontWeight: 500, marginBottom: '0.45rem' }}>
                <StepBadge number={3} status={paso3Status} />
                <span style={{ color: paso3Status === 'active' ? 'var(--color-text)' : 'var(--color-text-secondary)' }}>
                  Zona de Destino
                </span>
              </label>
              <select
                style={getSelectStyle(zonaDestinoId, !zonaOrigenId || loading)}
                value={zonaDestinoId}
                onChange={(e) => setZonaDestinoId(e.target.value)}
                disabled={!zonaOrigenId || loading}
                required
              >
                <option value="">
                  {!zonaOrigenId ? 'Primero seleccioná la zona origen' : 'Seleccioná la zona destino...'}
                </option>
                {destinoZonas.map((z) => (
                  <option key={z.id} value={z.id} disabled={z.disabled}>
                    {z.nombre} {z.disabled ? z.motivoDisabled : `(actual: ${z.parejasCount} parejas)`}
                  </option>
                ))}
              </select>
            </div>

            {/* Resumen explicativo */}
            {parejaSeleccionada && zonaDestinoSeleccionada && zonaOrigenSeleccionada && (
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
                  <span>Impacto de la modificación:</span>
                </div>
                <div>• <strong>{parejaSeleccionada.jugador1} / {parejaSeleccionada.jugador2}</strong> saldrá de <strong>{zonaOrigenSeleccionada.nombre}</strong> y entrará en <strong>{zonaDestinoSeleccionada.nombre}</strong>.</div>
                <div>• Se regenerarán únicamente los partidos de ambas zonas y se reasignarán automáticamente sus horarios sin alterar otras zonas ni la fase eliminatoria.</div>
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
            disabled={!zonaOrigenId || !parejaId || !zonaDestinoId || loading}
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
                <Loader2 size={16} className="spinner" /> Reubicando...
              </>
            ) : (
              <>
                <ArrowRightLeft size={16} /> Mover Pareja
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
