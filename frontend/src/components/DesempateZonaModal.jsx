import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, ArrowDown, X } from 'lucide-react';
import { api } from '../api/client';

export default function DesempateZonaModal({ zona, categoriaId, onClose, onSaved, returnFocusTo }) {
  const [orden, setOrden] = useState(() => zona.zonaParejas.filter(zp => zona.empatePendiente.includes(zp.parejaId)));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [anuncio, setAnuncio] = useState('');
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);
  const errorRef = useRef(null);
  const movidaRef = useRef(null);
  const enviandoRef = useRef(false);
  const tituloId = useId();
  const descripcionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    cancelRef.current?.focus();
    const enfocarDentro = event => {
      if (!dialog.contains(event.target)) cancelRef.current?.focus();
    };
    const teclado = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (event.key === 'Tab') {
        const controles = [...dialog.querySelectorAll('button:not([disabled])')];
        const primero = controles[0], ultimo = controles.at(-1);
        if (event.shiftKey && document.activeElement === primero) {
          event.preventDefault(); ultimo?.focus();
        } else if (!event.shiftKey && document.activeElement === ultimo) {
          event.preventDefault(); primero?.focus();
        }
      }
    };
    document.addEventListener('keydown', teclado);
    document.addEventListener('focusin', enfocarDentro);
    return () => {
      document.removeEventListener('keydown', teclado);
      document.removeEventListener('focusin', enfocarDentro);
      document.body.style.overflow = overflowAnterior;
      if (returnFocusTo?.isConnected) returnFocusTo.focus();
    };
  }, [onClose, returnFocusTo]);

  useLayoutEffect(() => {
    // Si el botón recién usado quedó deshabilitado en un extremo, mantener el foco en esa pareja.
    if (movidaRef.current) {
      const fila = [...dialogRef.current.querySelectorAll('[data-pareja-id]')]
        .find(elemento => elemento.dataset.parejaId === movidaRef.current);
      fila?.querySelector('button:not([disabled])')?.focus();
      movidaRef.current = null;
    }
  }, [orden]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const mover = (indice, paso) => {
    const destino = indice + paso;
    if (enviandoRef.current || destino < 0 || destino >= orden.length) return;
    const nuevo = [...orden];
    [nuevo[indice], nuevo[destino]] = [nuevo[destino], nuevo[indice]];
    movidaRef.current = orden[indice].parejaId;
    setOrden(nuevo);
    setAnuncio(`${orden[indice].pareja.jugador1} / ${orden[indice].pareja.jugador2} quedó en el puesto ${destino + 1}.`);
  };

  const guardar = async event => {
    event.preventDefault();
    if (enviandoRef.current) return;
    enviandoRef.current = true;
    // El botón Guardar se deshabilita al enviar; conservar un foco activo dentro del diálogo.
    cancelRef.current?.focus();
    setGuardando(true);
    setError('');
    try {
      await api.put(`/categorias/${categoriaId}/zonas/${zona.id}/desempate`, { orden: orden.map(zp => zp.parejaId) });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      enviandoRef.current = false;
      setGuardando(false);
    }
  };

  return (
    <div className="pm-overlay">
      <form ref={dialogRef} className="pm-modal cd-tie-modal" role="dialog" aria-modal="true"
        aria-labelledby={tituloId} aria-describedby={descripcionId} onSubmit={guardar}>
        <div className="pm-header">
          <div><h2 className="pm-title" id={tituloId}>Definir orden</h2><p className="pm-muted">{zona.nombre}</p></div>
          <button type="button" className="pm-button pm-close" onClick={onClose} aria-label="Cerrar diálogo"><X size={20} aria-hidden="true" /></button>
        </div>
        <div className="pm-body">
          {error && <p ref={errorRef} className="pm-alert cd-tie-error" role="alert" tabIndex={-1}>{error}</p>}
          <p className="cd-tie-explanation" id={descripcionId}>El orden que elijas define quién clasifica. Si después corregís un resultado de la zona, vas a tener que definirlo de nuevo.</p>
          <ol className="cd-tie-order">
            {orden.map((zp, indice) => {
              const nombre = `${zp.pareja.jugador1} / ${zp.pareja.jugador2}`;
              return (
                <li key={zp.parejaId} data-pareja-id={zp.parejaId}>
                  <span className="cd-tie-position" aria-hidden="true">{indice + 1}</span>
                  <span className="cd-tie-name">{nombre}</span>
                  <div className="cd-tie-moves">
                    <button type="button" className="pm-button" aria-label={`Subir a ${nombre}`} disabled={guardando || indice === 0} onClick={() => mover(indice, -1)}><ArrowUp size={18} aria-hidden="true" /></button>
                    <button type="button" className="pm-button" aria-label={`Bajar a ${nombre}`} disabled={guardando || indice === orden.length - 1} onClick={() => mover(indice, 1)}><ArrowDown size={18} aria-hidden="true" /></button>
                  </div>
                </li>
              );
            })}
          </ol>
          <span className="cd-sr" aria-live="polite">{anuncio}</span>
        </div>
        <div className="pm-footer">
          <button ref={cancelRef} type="button" className="pm-button" onClick={onClose}>Cancelar</button>
          <button type="submit" className="pm-button pm-primary" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar orden'}</button>
        </div>
      </form>
    </div>
  );
}
