import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { X, UserPlus, Loader2, AlertCircle, CheckCircle2, Check } from 'lucide-react';
import DisponibilidadEditor from './DisponibilidadEditor';

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
    <div className="pm-overlay">
      <form
        onSubmit={handleSubmit}
        className="pm-modal pm-add-pair"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pm-add-title"
      >
        {/* Header Fijo */}
        <div className="pm-header">
          <div className="pm-pair-title">
            <div className="pm-pair-icon">
              <UserPlus size={16} />
            </div>
            <h2 id="pm-add-title" className="pm-title">
              Agregar pareja a zona
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
            {/* Paso 1: Jugadores */}
            <div>
              <div className="pm-step-label">
                <StepBadge number={1} status={paso1Status} />
                <span className={`pm-step-title${paso1Status === 'active' ? ' is-active' : ''}`}>
                  Integrantes de la pareja
                </span>
              </div>
              <div className="pm-player-fields">
                <div>
                  <input
                    type="text"
                    className={`pm-text-input${jugador1.trim() ? ' is-filled' : ''}`}
                    placeholder="Jugador 1"
                    aria-label="Jugador 1"
                    value={jugador1}
                    onChange={(e) => setJugador1(e.target.value)}
                    disabled={loading}
                    required
                  />
                </div>
                <div>
                  <input
                    type="text"
                    className={`pm-text-input${jugador2.trim() ? ' is-filled' : ''}`}
                    placeholder="Jugador 2"
                    aria-label="Jugador 2"
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
              <label className="pm-step-label" htmlFor="pm-add-zonaDestinoId">
                <StepBadge number={2} status={paso2Status} />
                <span className={`pm-step-title${paso2Status === 'active' ? ' is-active' : ''}`}>
                  Zona de asignación
                </span>
              </label>
              <select
                id="pm-add-zonaDestinoId"
                className={`pm-select${zonaDestinoId ? ' is-filled' : ''}`}
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

            {/* Paso 3: Disponibilidad horaria */}
            <div>
              <div className="pm-step-label">
                <StepBadge number={3} status={paso3Status} />
                <span className={`pm-step-title${paso3Status === 'active' ? ' is-active' : ''}`}>
                  Disponibilidad horaria
                </span>
              </div>
              <div className="pm-availability">
                <DisponibilidadEditor
                  value={slotIds}
                  onChange={setSlotIds}
                />
              </div>
              <div className="pm-availability-note">
                Marcá al menos un horario. Si puede jugar cualquier día y hora, usá «Día completo».
              </div>
            </div>

            {/* Resumen explicativo */}
            {jugador1.trim() && jugador2.trim() && zonaDestinoSeleccionada && (
              <div className="pm-alert pm-impact">
                <div className="pm-impact-title">
                  <CheckCircle2 size={15} className="pm-icon" />
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
            disabled={!jugador1.trim() || !jugador2.trim() || !zonaDestinoId || !slotIds || slotIds.length === 0 || loading}
            className="pm-button pm-primary"
          >
            {loading ? (
              <>
                <Loader2 size={16} className="pm-spinner" /> Agregando…
              </>
            ) : (
              <>
                <UserPlus size={16} /> Agregar pareja
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
