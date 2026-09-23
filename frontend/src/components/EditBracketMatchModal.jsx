import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { X } from 'lucide-react';

export default function EditBracketMatchModal({
  isOpen = true,
  partido,
  zonas = [],
  partidosRonda = [],
  onClose,
  onSuccess,
  onSaved,
}) {
  const [origen1, setOrigen1] = useState('');
  const [origen2, setOrigen2] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (partido) {
      setOrigen1(partido.origenPareja1 || '');
      setOrigen2(partido.origenPareja2 || '');
      setError('');
    }
  }, [partido]);

  // Mapa de origen -> { posicionEnRonda, finalizado, partidoId } de partidos ajenos al actual en la misma ronda
  const orígenesEnUsoOtrosPartidos = new Map();
  partidosRonda.forEach((p) => {
    if (p.id !== partido?.id) {
      const info = {
        posicionEnRonda: p.posicionEnRonda,
        finalizado: p.estado === 'FINALIZADO',
        partidoId: p.id,
      };
      if (p.origenPareja1) orígenesEnUsoOtrosPartidos.set(p.origenPareja1, info);
      if (p.origenPareja2) orígenesEnUsoOtrosPartidos.set(p.origenPareja2, info);
    }
  });

  // Detectar movimientos / swaps pendientes hacia este partido
  const movimientos = [];
  if (origen1 && orígenesEnUsoOtrosPartidos.has(origen1)) {
    const info = orígenesEnUsoOtrosPartidos.get(origen1);
    movimientos.push({
      origen: origen1,
      posicionDestino: 'Posición 1',
      origenPartidoNum: info.posicionEnRonda,
      finalizado: info.finalizado,
    });
  }
  if (origen2 && orígenesEnUsoOtrosPartidos.has(origen2)) {
    const info = orígenesEnUsoOtrosPartidos.get(origen2);
    movimientos.push({
      origen: origen2,
      posicionDestino: 'Posición 2',
      origenPartidoNum: info.posicionEnRonda,
      finalizado: info.finalizado,
    });
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (origen1 && origen2 && origen1 === origen2) {
      setError('No podés asignar el mismo origen en ambos lados del partido.');
      return;
    }

    const conflictoFinalizado = movimientos.find((m) => m.finalizado);
    if (conflictoFinalizado) {
      setError(
        `No se puede mover "${conflictoFinalizado.origen}" porque el Partido #${conflictoFinalizado.origenPartidoNum} ya está finalizado.`
      );
      return;
    }

    try {
      setLoading(true);
      await api.patch(`/partidos/${partido.id}/bracket`, {
        origenPareja1: origen1 || null,
        origenPareja2: origen2 || null,
        liberarEnOtros: movimientos.length > 0,
      });
      if (typeof onSuccess === 'function') onSuccess();
      if (typeof onSaved === 'function') onSaved();
      if (typeof onClose === 'function') onClose();
    } catch (err) {
      setError(err.message || 'Error al guardar los cruces');
      setLoading(false);
    }
  };

  if (!isOpen || !partido) return null;

  const originOptions = [];
  zonas.forEach((z) => {
    for (let i = 1; i <= z.clasifican; i++) {
      originOptions.push(`${i}° ${z.nombre}`);
    }
  });

  const renderOption = (opt) => {
    const info = orígenesEnUsoOtrosPartidos.get(opt);
    const estaEnUso = Boolean(info);
    const estaFinalizado = info?.finalizado;

    let label = opt;
    if (estaFinalizado) {
      label = `${opt} (Partido #${info.posicionEnRonda} finalizado)`;
    } else if (estaEnUso) {
      label = `${opt} (en uso en Partido #${info.posicionEnRonda})`;
    }

    return (
      <option key={opt} value={opt} disabled={estaFinalizado}>
        {label}
      </option>
    );
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose && onClose()}>
      <div className="modal-content" style={{ maxWidth: '400px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.75rem' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.15rem', color: 'var(--color-text)', lineHeight: 1.25 }}>
              Editar Cruce
            </h3>
            {partido.posicionEnRonda && (
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                Partido #{partido.posicionEnRonda}
              </span>
            )}
          </div>
          <button
            type="button"
            className="btn-link-action"
            onClick={onClose}
            style={{ color: 'var(--color-text-secondary)', padding: '0.25rem', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
            aria-label="Cerrar modal"
          >
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="error-message" style={{ marginBottom: '1rem', padding: '0.5rem 0.75rem', fontSize: 'var(--font-size-sm)' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginBottom: '0.35rem', fontWeight: 600 }}>
              Posición 1 (Arriba)
            </label>
            <select
              value={origen1}
              onChange={(e) => setOrigen1(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem 0.75rem',
                fontSize: 'var(--font-size-sm)',
                background: 'var(--color-bg-input)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              <option value="">-- Sin Definir / Vacío --</option>
              {originOptions.map(renderOption)}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginBottom: '0.35rem', fontWeight: 600 }}>
              Posición 2 (Abajo)
            </label>
            <select
              value={origen2}
              onChange={(e) => setOrigen2(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem 0.75rem',
                fontSize: 'var(--font-size-sm)',
                background: 'var(--color-bg-input)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              <option value="">-- Sin Definir / Vacío --</option>
              {originOptions.map(renderOption)}
            </select>
          </div>

          {movimientos.length > 0 && (
            <div
              style={{
                padding: '0.75rem',
                backgroundColor: 'rgba(234, 179, 8, 0.1)',
                border: '1px solid rgba(234, 179, 8, 0.35)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--font-size-xs)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.4rem',
              }}
            >
              <div style={{ fontWeight: 600, color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <span>⚠️</span> Reasignación de cruces (Swap)
              </div>
              <p style={{ margin: 0, color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>
                Al guardar, se liberará automáticamente la posición en los partidos correspondientes:
              </p>
              <ul style={{ margin: 0, paddingLeft: '1.25rem', color: 'var(--color-text)', lineHeight: 1.4 }}>
                {movimientos.map((m, idx) => (
                  <li key={idx}>
                    <strong>{m.origen}</strong> se moverá desde el <strong>Partido #{m.origenPartidoNum}</strong> a este partido ({m.posicionDestino}).
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              style={{ flex: 1 }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={loading}
              style={{ flex: 1 }}
            >
              {loading
                ? 'Guardando...'
                : movimientos.length > 0
                ? 'Confirmar y Guardar'
                : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
