import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { X, UserPlus, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';

export default function AgregarParejaModal({ isOpen, onClose, categoriaId, zonas = [], partidos = [], onSuccess }) {
  const [jugador1, setJugador1] = useState('');
  const [jugador2, setJugador2] = useState('');
  const [zonaDestinoId, setZonaDestinoId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setJugador1('');
      setJugador2('');
      setZonaDestinoId('');
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!jugador1.trim() || !jugador2.trim() || !zonaDestinoId) {
      setError('Completá los nombres de ambos jugadores y seleccioná la zona destino.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await api.post(`/categorias/${categoriaId}/zonas/agregar-pareja`, {
        zonaDestinoId,
        jugador1: jugador1.trim(),
        jugador2: jugador2.trim(),
      });

      if (onSuccess) {
        onSuccess(`Pareja ${jugador1.trim()} / ${jugador2.trim()} agregada a ${zonaDestinoSeleccionada?.nombre || 'la zona'}. Partidos y horarios actualizados.`);
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
        background: 'rgba(0,0,0,0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1100,
        backdropFilter: 'blur(4px)',
        padding: '1rem',
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: '520px',
          padding: '1.75rem',
          borderRadius: 'var(--border-radius-lg)',
          boxShadow: 'var(--shadow-xl)',
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-border)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: '50%',
                background: 'rgba(59, 130, 246, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--color-info, #3b82f6)',
              }}
            >
              <UserPlus size={18} />
            </div>
            <h2 style={{ fontSize: '1.2rem', margin: 0, fontWeight: 600 }}>Agregar Pareja a Zona (Alta Tardía)</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
              padding: '0.3rem',
              borderRadius: 'var(--border-radius-sm)',
            }}
          >
            <X size={20} />
          </button>
        </div>

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

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
          {/* Jugador 1 y Jugador 2 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: 'var(--font-size-sm)', fontWeight: 500, marginBottom: '0.35rem' }}>
                Jugador 1
              </label>
              <input
                type="text"
                className="form-input"
                placeholder="Nombre y Apellido"
                value={jugador1}
                onChange={(e) => setJugador1(e.target.value)}
                disabled={loading}
                required
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 'var(--font-size-sm)', fontWeight: 500, marginBottom: '0.35rem' }}>
                Jugador 2
              </label>
              <input
                type="text"
                className="form-input"
                placeholder="Nombre y Apellido"
                value={jugador2}
                onChange={(e) => setJugador2(e.target.value)}
                disabled={loading}
                required
              />
            </div>
          </div>

          {/* Zona Destino */}
          <div>
            <label style={{ display: 'block', fontSize: 'var(--font-size-sm)', fontWeight: 500, marginBottom: '0.35rem' }}>
              Zona de Asignación
            </label>
            <select
              className="form-input"
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
              <div>• Se regenerarán únicamente los partidos de esta zona y se programarán automáticamente sus horarios sin modificar otras zonas ni el cuadro eliminatorio.</div>
            </div>
          )}

          {/* Botones */}
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn-outline"
              onClick={onClose}
              disabled={loading}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={!jugador1.trim() || !jugador2.trim() || !zonaDestinoId || loading}
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="spinner" /> Creando y Asignando...
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
    </div>
  );
}
