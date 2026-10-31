import { useRef, useState } from 'react';
import { Check, Copy, Link2, Loader2, Lock, MessageCircle, Unlock } from 'lucide-react';
import { api } from '../api/client';

/**
 * Abrir/cerrar la inscripción por link y compartirlo (TorneoDetail, solo en BORRADOR).
 * Iniciar el torneo la cierra sola en el backend.
 */
export default function InscripcionLinkPanel({ torneo, onCambio }) {
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [copiado, setCopiado] = useState(false);
  const inputRef = useRef(null);

  const abierta = Boolean(torneo.inscripcionAbierta);
  const url = `${window.location.origin}/torneo/${torneo.slug}/inscripcion`;
  const textoWhatsApp = `Inscribite al torneo ${torneo.nombre}: ${url}`;

  const cambiar = async () => {
    setGuardando(true);
    setError('');
    try {
      const r = await api.patch(`/torneos/${torneo.id}/inscripcion`, { abierta: !abierta });
      onCambio(r.inscripcionAbierta);
    } catch (err) {
      setError(err.message || 'No se pudo cambiar la inscripción.');
    } finally {
      setGuardando(false);
    }
  };

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sin permiso de portapapeles (o sin HTTPS): se selecciona para copiar a mano
      inputRef.current?.select();
      setError('No se pudo copiar automáticamente: el link quedó seleccionado para copiarlo.');
    }
  };

  return (
    <section className="td-card td-inscription" aria-labelledby="insc-panel-titulo">
      <div className="td-inscription-heading">
        <h2 id="insc-panel-titulo" className="td-section-title">
          <Link2 size={18} aria-hidden="true" /> Inscripción por link
        </h2>
        <span className={abierta ? 'td-state td-state-open' : 'td-state'}>
          {abierta ? 'Abierta' : 'Cerrada'}
        </span>
      </div>

      <p className="td-inscription-copy">
        {abierta
          ? 'Las parejas se anotan con este link, sin aprobación. Se cierra sola al iniciar el torneo.'
          : 'Abrila para que las parejas se anoten solas, con su teléfono y su disponibilidad.'}
      </p>

      {abierta && (
        <div className="td-inscription-link">
          <input
            ref={inputRef}
            className="td-input"
            readOnly
            value={url}
            aria-label="Link de inscripción"
            onFocus={(e) => e.target.select()}
          />
        </div>
      )}

      {error && <p className="td-error td-inscription-error" role="alert">{error}</p>}

      <div className="td-inscription-actions">
        {abierta && (
          <>
            <button type="button" className="td-button" onClick={copiar}>
              {copiado ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
              {copiado ? 'Link copiado' : 'Copiar link'}
            </button>
            <a
              className="td-button"
              href={`https://wa.me/?text=${encodeURIComponent(textoWhatsApp)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <MessageCircle size={16} aria-hidden="true" /> WhatsApp
            </a>
          </>
        )}
        <button
          type="button"
          className="td-button td-brand-button"
          onClick={cambiar}
          disabled={guardando}
        >
          {guardando ? (
            <Loader2 size={16} className="td-spin" aria-hidden="true" />
          ) : abierta ? (
            <Lock size={16} aria-hidden="true" />
          ) : (
            <Unlock size={16} aria-hidden="true" />
          )}
          {abierta ? 'Cerrar inscripción' : 'Abrir inscripción'}
        </button>
      </div>
    </section>
  );
}
