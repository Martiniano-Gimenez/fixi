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

          <div>
            <label className="pm-label" htmlFor="cb-origen-1">
              Posición 1 (arriba)
            </label>
            <select

              value={origen1}
              onChange={(e) => setOrigen1(e.target.value)}
              className="pm-select"
              id="cb-origen-1"
            >
              <option value="">Sin definir / vacío</option>
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
            >
              <option value="">Sin definir / vacío</option>
              {originOptions.map(renderOption)}
            </select>
          </div>

          {movimientos.length > 0 && (
            <div
              className="pm-alert pm-stack"
            >
              <div className="pm-strong">
                Reasignación de cruces
              </div>
              <p className="pm-alert-copy">
                Al guardar, se liberará automáticamente la posición en los partidos correspondientes:
              </p>
              <ul className="pm-warning-list">
                {movimientos.map((m, idx) => (
                  <li key={idx}>
                    <strong>{m.origen}</strong> se moverá desde el <strong>Partido #{m.origenPartidoNum}</strong> a este partido ({m.posicionDestino}).
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

              disabled={loading}
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
