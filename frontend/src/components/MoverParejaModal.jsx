import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { X, ArrowRightLeft, Loader2, AlertCircle, CheckCircle2, Check } from 'lucide-react';

function StepBadge({ number, status }) {
  if (status === 'completed') {
    return (
      <span className="pm-step-badge is-completed">
        <Check size={13} strokeWidth={3} />
      </span>
    );
  }

  if (status === 'active') {
    return (
      <span className="pm-step-badge is-active">
        {number}
      </span>
    );
  }

  return (
    <span className="pm-step-badge">
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!zonaOrigenId || !parejaId || !zonaDestinoId) {
      setError('Completá todos los campos para continuar.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await api.post(`/categorias/${categoriaId}/zonas/mover-pareja`, {
        parejaId,
        zonaOrigenId,
        zonaDestinoId,
      });

      if (onSuccess) {
        onSuccess('Pareja reubicada correctamente. Los partidos y horarios fueron actualizados.', res);
      }
      onClose();
    } catch (err) {
      setError(err.message || 'Error al mover la pareja.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="pm-overlay">
      <form
        onSubmit={handleSubmit}
        className="pm-modal pm-move-pair"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pm-move-title"
      >
        {/* Header Fijo */}
        <div className="pm-header">
          <div className="pm-pair-title">
            <div className="pm-pair-icon">
              <ArrowRightLeft size={16} />
            </div>
            <h2 id="pm-move-title" className="pm-title">
              Mover pareja de zona
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            aria-label="Cerrar modal"
            className="pm-button pm-close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Cuerpo Scrollable */}
        <div className="pm-body">
          {error && (
            <div className="pm-alert pm-pair-error" role="alert">
              <AlertCircle size={16} className="pm-icon" />
              <span>{error}</span>
            </div>
          )}

          <div className="pm-pair-steps">
            {/* 1. Zona Origen */}
            <div>
              <label className="pm-step-label" htmlFor="pm-move-zonaOrigenId">
                <StepBadge number={1} status={paso1Status} />
                <span className={`pm-step-title${paso1Status === 'active' ? ' is-active' : ''}`}>
                  Zona de origen
                </span>
              </label>
              <select
                id="pm-move-zonaOrigenId"
                className={`pm-select${zonaOrigenId ? ' is-filled' : ''}`}
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

            {/* 2. Pareja a mover */}
            <div>
              <label className="pm-step-label" htmlFor="pm-move-parejaId">
                <StepBadge number={2} status={paso2Status} />
                <span className={`pm-step-title${paso2Status === 'active' ? ' is-active' : ''}`}>
                  Pareja a mover
                </span>
              </label>
              <select
                id="pm-move-parejaId"
                className={`pm-select${parejaId ? ' is-filled' : ''}`}
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
              <label className="pm-step-label" htmlFor="pm-move-zonaDestinoId">
                <StepBadge number={3} status={paso3Status} />
                <span className={`pm-step-title${paso3Status === 'active' ? ' is-active' : ''}`}>
                  Zona de destino
                </span>
              </label>
              <select
                id="pm-move-zonaDestinoId"
                className={`pm-select${zonaDestinoId ? ' is-filled' : ''}`}
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
              <div className="pm-alert pm-impact">
                <div className="pm-impact-title">
                  <CheckCircle2 size={15} className="pm-icon" />
                  <span>Impacto de la modificación:</span>
                </div>
                <div>• <strong>{parejaSeleccionada.jugador1} / {parejaSeleccionada.jugador2}</strong> saldrá de <strong>{zonaOrigenSeleccionada.nombre}</strong> y entrará en <strong>{zonaDestinoSeleccionada.nombre}</strong>.</div>
                <div>• Se regenerarán únicamente los partidos de ambas zonas y se reasignarán automáticamente sus horarios sin alterar otras zonas ni la fase eliminatoria.</div>
              </div>
            )}
          </div>
        </div>

        {/* Footer Fijo */}
        <div className="pm-footer pm-pair-footer">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="pm-button"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!zonaOrigenId || !parejaId || !zonaDestinoId || loading}
            className="pm-button pm-primary"
          >
            {loading ? (
              <>
                <Loader2 size={16} className="pm-spinner" /> Reubicando…
              </>
            ) : (
              <>
                <ArrowRightLeft size={16} /> Mover pareja
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
