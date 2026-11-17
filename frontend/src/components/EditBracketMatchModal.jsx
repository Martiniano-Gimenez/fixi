import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { X } from 'lucide-react';

export default function EditBracketMatchModal({
  isOpen = true,
  partido,
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

  const bloqueado = (p) => p?.estado === 'FINALIZADO' || p?.estado === 'EN_CURSO';
  const partidoBloqueado = bloqueado(partido);
  // Orígenes de los otros partidos de esta ronda, con su estado para impedir mover uno ya iniciado.
  const orígenesEnUsoOtrosPartidos = new Map();
  partidosRonda.forEach((p) => {
    if (p.id !== partido?.id) {
      const info = {
        posicionEnRonda: p.posicionEnRonda,
        estado: p.estado,
        bloqueado: bloqueado(p),
        partidoId: p.id,
      };
      if (p.origenPareja1) orígenesEnUsoOtrosPartidos.set(p.origenPareja1, info);
      if (p.origenPareja2) orígenesEnUsoOtrosPartidos.set(p.origenPareja2, info);
    }
  });

  // Simular los dos lugares para que el aviso también describa un intercambio encadenado.
  const otros = partidosRonda.filter((p) => p.id !== partido?.id);
  const plan = partido ? [partido, ...otros].map((p) => ({ ...p })) : [];
  for (const [index, elegido] of [origen1, origen2].entries()) {
    if (!plan.length) break;
    const campo = `origenPareja${index + 1}`;
    if (plan[0][campo] === (elegido || null)) continue;
    const fuente = elegido && plan.flatMap((p) => [1, 2].map((lado) => ({ partido: p, campo: `origenPareja${lado}` })))
      .find((l) => l.partido[l.campo] === elegido && !(l.partido === plan[0] && l.campo === campo));
    if (fuente) fuente.partido[fuente.campo] = plan[0][campo];
    plan[0][campo] = elegido || null;
  }
  const movimientos = partido ? otros.flatMap((p, index) => [1, 2].flatMap((lado) => {
    const campo = `origenPareja${lado}`;
    return p[campo] !== plan[index + 1][campo] ? [{ origen: p[campo], reemplazo: plan[index + 1][campo],
      origenPartidoNum: p.posicionEnRonda, estado: p.estado, bloqueado: bloqueado(p) }] : [];
  })) : [];

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (partidoBloqueado) {
      setError('No se puede editar un partido finalizado o en juego.');
      return;
    }

    if (origen1 && origen2 && origen1 === origen2) {
      setError('No podés asignar el mismo origen en ambos lados del partido.');
      return;
    }

    const conflictoBloqueado = movimientos.find((m) => m.bloqueado);
    if (conflictoBloqueado) {
      setError(
        `No se puede mover "${conflictoBloqueado.origen}" porque el Partido #${conflictoBloqueado.origenPartidoNum} ${conflictoBloqueado.estado === 'FINALIZADO' ? 'ya está finalizado' : 'está en juego'}.`
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

  const originOptions = [...new Set(partidosRonda.flatMap((p) => [p.origenPareja1, p.origenPareja2]).filter(Boolean))];

  const renderOption = (opt) => {
    const info = orígenesEnUsoOtrosPartidos.get(opt);
    const estaEnUso = Boolean(info);
    const estaBloqueado = info?.bloqueado;

    let label = opt;
    if (estaBloqueado) {
      label = `${opt} (Partido #${info.posicionEnRonda} ${info.estado === 'FINALIZADO' ? 'finalizado' : 'en juego'})`;
    } else if (estaEnUso) {
      label = `${opt} (en uso en Partido #${info.posicionEnRonda})`;
    }

    return (
      <option key={opt} value={opt} disabled={estaBloqueado}>
        {label}
      </option>
    );
  };

  return (
    <div className="pm-overlay" onClick={(e) => e.target === e.currentTarget && onClose && onClose()}>
      <div className="pm-modal pm-edit-bracket" role="dialog" aria-modal="true" aria-label="Editar cruce">
        <div className="pm-header">
          <div>
            <h3 className="pm-title">
              Editar cruce
            </h3>
            {partido.posicionEnRonda && (
              <span className="pm-muted">
                Partido #{partido.posicionEnRonda}
              </span>
            )}
          </div>
          <button
            type="button"

            onClick={onClose}
            className="pm-button pm-close"
            aria-label="Cerrar modal"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="pm-edit-form">
        <div className="pm-body pm-stack">
        {error && (
          <div className="pm-alert" role="alert">
            {error}
          </div>
        )}
        {partidoBloqueado && <p className="pm-alert" role="status">No se puede editar un partido finalizado o en juego.</p>}

          <div>
            <label className="pm-label" htmlFor="cb-origen-1">
              Posición 1 (arriba)
            </label>
            <select

              value={origen1}
              onChange={(e) => setOrigen1(e.target.value)}
              className="pm-select"
              id="cb-origen-1"
              disabled={loading || partidoBloqueado}
            >
              {!partido.origenPareja1 && <option value="">Sin definir</option>}
              {originOptions.map(renderOption)}
            </select>
          </div>

          <div>
            <label className="pm-label" htmlFor="cb-origen-2">
              Posición 2 (abajo)
            </label>
            <select

              value={origen2}
              onChange={(e) => setOrigen2(e.target.value)}
              className="pm-select"
              id="cb-origen-2"
              disabled={loading || partidoBloqueado}
            >
              {!partido.origenPareja2 && <option value="">Sin definir</option>}
              {originOptions.map(renderOption)}
            </select>
          </div>

          {movimientos.length > 0 && (
            <div
              className="pm-summary pm-stack"
              role="status"
            >
              <div className="pm-strong">
                Intercambio de cruces
              </div>
              <ul className="pm-warning-list">
                {movimientos.map((m, idx) => (
                  <li key={idx}>
                    {m.reemplazo
                      ? <><strong>{m.reemplazo}</strong> pasa al Partido #{m.origenPartidoNum} y <strong>{m.origen}</strong> viene a este partido.</>
                      : <><strong>{m.origen}</strong> viene a este partido. El Partido #{m.origenPartidoNum} queda con un lugar sin definir.</>}
                  </li>
                ))}
              </ul>
            </div>
          )}

        </div>
          <div className="pm-footer">
            <button
              type="button"

              onClick={onClose}
              className="pm-button pm-grow"
            >
              Cancelar
            </button>
            <button
              type="submit"

              disabled={loading || partidoBloqueado}
              className="pm-button pm-primary pm-grow"
            >
              {loading
                ? 'Guardando…'
                : movimientos.length > 0
                ? 'Confirmar y guardar'
                : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
