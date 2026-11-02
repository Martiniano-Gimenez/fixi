import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { api } from '../api/client';
import { formatHora, formatSlotCorto, getDiaCalendarioConTrasnoche } from '../utils/dateUtils';
import { FilaPartidoZona } from './PartidosZonaManual';

function formatearInicios(slots) {
  const inicios = slots.map(formatSlotCorto);
  return inicios.length > 1
    ? `${inicios.slice(0, -1).join(', ')} y ${inicios.at(-1)}`
    : inicios[0];
}

export default function PropuestasZona({ torneoId, categoriaId, zonaId, revision, parejas, onApplied, onRecheck }) {
  const [resultado, setResultado] = useState(null);
  const [otrasAbiertas, setOtrasAbiertas] = useState(false);
  const [confirmando, setConfirmando] = useState(null);
  const [aplicando, setAplicando] = useState(null);
  const [errorAplicacion, setErrorAplicacion] = useState(null);
  const bloqueoAplicar = useRef(false);
  const recheckRef = useRef(onRecheck);
  const opcionesId = useId();
  const solicitud = JSON.stringify([torneoId, categoriaId, zonaId, revision]);

  useEffect(() => { recheckRef.current = onRecheck; }, [onRecheck]);

  useEffect(() => {
    let activa = true;
    setOtrasAbiertas(false);
    setConfirmando(null);
    api.post(`/torneos/${torneoId}/pre-check-inicio/propuestas`, { categoriaId, zonaId, revision })
      .then((res) => {
        if (activa) setResultado({ solicitud, propuestas: res.propuestasZona || [], error: '' });
      })
      .catch(async (err) => {
        if (!activa) return;
        setResultado({ solicitud, propuestas: [], error: err.message || 'No pudimos buscar las propuestas.' });
        if (err.status === 409) await recheckRef.current();
      });
    return () => { activa = false; };
  }, [torneoId, categoriaId, zonaId, revision, solicitud]);

  const vigente = resultado?.solicitud === solicitud;
  const errorSinTarjeta = errorAplicacion && (!vigente || !resultado.propuestas.some((p) => p.clave === errorAplicacion.clave));
  const nombres = new Map(parejas.map((pareja) => [pareja.id, pareja.nombre]));

  const esHorarioPedido = (partido, propuesta) => {
    const jornada = getDiaCalendarioConTrasnoche(partido.fechaHora);
    if (!jornada) return false;
    const dia = jornada.diaNombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const slotId = `${dia}-${formatHora(partido.fechaHora)}`;
    const participantes = [partido.pareja1Id, partido.pareja2Id].filter(Boolean);
    return propuesta.cambios.some((c) =>
      (participantes.length ? participantes.includes(c.parejaId) : partido.origen && nombres.has(c.parejaId)) && c.slotsToAdd.includes(slotId));
  };

  const aplicar = async (propuesta) => {
    if (bloqueoAplicar.current) return;
    bloqueoAplicar.current = true;
    setAplicando(propuesta.clave);
    setErrorAplicacion(null);
    try {
      await api.post(`/torneos/${torneoId}/pre-check-inicio/propuestas/aplicar`, { clave: propuesta.clave, revision });
      await onApplied();
    } catch (err) {
      setErrorAplicacion({ clave: propuesta.clave, mensaje: err.message || 'No pudimos aplicar la propuesta.' });
      if (err.status === 409) await recheckRef.current();
    } finally {
      bloqueoAplicar.current = false;
      setAplicando(null);
    }
  };

  const tarjeta = (propuesta, destacada = false) => (
    <div key={propuesta.clave} className={`pc-propuesta-card${destacada ? ' pc-propuesta-destacada' : ''}`}>
      {destacada && <h4 className="pc-propuesta-title">Propuesta para destrabar la zona</h4>}
      <div className="pc-propuesta-cambios">
        {propuesta.cambios.map((cambio) => (
          <p key={cambio.parejaId} className="pc-propuesta-pedido">
            Pedile a <strong>{nombres.get(cambio.parejaId) || 'la pareja'}</strong>:{' '}
            <span className="pc-propuesta-horarios">{formatearInicios(cambio.slotsToAdd)}</span>
          </p>
        ))}
      </div>
      {propuesta.partidosPropuestos?.length > 0 && (
        <section className="pc-propuesta-partidos" aria-label="Partidos de la zona">
          <h5 className="pc-propuesta-partidos-title">Partidos de la zona</h5>
          <ul className="pc-propuesta-partidos-list">
            {[...propuesta.partidosPropuestos].sort((a, b) => +new Date(a.fechaHora) - +new Date(b.fechaHora) || a.posicionEnRonda - b.posicionEnRonda).map((partido) => (
              <li key={partido.posicionEnRonda} className="pc-propuesta-partido">
                <FilaPartidoZona partido={partido} nombres={nombres} badge={esHorarioPedido(partido, propuesta) ? 'nuevo' : null} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {errorAplicacion?.clave === propuesta.clave && (
        <p className="pc-propuesta-error" role="alert">{errorAplicacion.mensaje}</p>
      )}
      {confirmando === propuesta.clave ? (
        <div className="pc-propuesta-confirmacion">
          <p className="pc-propuesta-copy">
            {propuesta.cambios.length === 1
              ? 'Se agregan estos horarios a la pareja. Confirmalo solo si ya lo hablaste con ella.'
              : 'Se agregan estos horarios a las parejas. Confirmalo solo si ya lo hablaste con ellas.'}
          </p>
          <div className="pc-propuesta-actions">
            <button type="button" className="pc-propuesta-button" disabled={!!aplicando} onClick={() => aplicar(propuesta)}>
              {aplicando === propuesta.clave && <Loader2 size={16} className="pc-propuesta-spinner" aria-hidden="true" />}
              {aplicando === propuesta.clave ? 'Aplicando…' : 'Confirmar'}
            </button>
            <button type="button" className="pc-propuesta-button" disabled={!!aplicando} onClick={() => setConfirmando(null)}>Cancelar</button>
          </div>
        </div>
      ) : (
        <button type="button" className="pc-propuesta-button" disabled={!!aplicando} onClick={() => setConfirmando(propuesta.clave)}>Aplicar</button>
      )}
    </div>
  );

  return (
    <div className="pc-propuesta-zone">
      {errorSinTarjeta && <p className="pc-propuesta-card pc-propuesta-error" role="alert">{errorAplicacion.mensaje}</p>}
      {!vigente ? (
        <div className="pc-propuesta-status" role="status">
          <Loader2 size={16} className="pc-propuesta-spinner" aria-hidden="true" />
          <span>Buscando propuestas…</span>
        </div>
      ) : resultado.error ? (
        <p className="pc-propuesta-card pc-propuesta-error" role="alert">{resultado.error}</p>
      ) : resultado.propuestas.length === 0 ? (
        <p className="pc-propuesta-card pc-propuesta-copy">No encontramos una forma de destrabar la zona cambiando hasta dos parejas. Elegí el horario de cada partido abajo.</p>
      ) : (
        <>
          {tarjeta(resultado.propuestas[0], true)}
          {resultado.propuestas.length > 1 && (
            <div className="pc-propuesta-otras">
              <button
                type="button"
                className="pc-propuesta-toggle"
                aria-expanded={otrasAbiertas}
                aria-controls={opcionesId}
                disabled={!!aplicando}
                onClick={() => setOtrasAbiertas((abiertas) => !abiertas)}
              >
                Otras opciones ({resultado.propuestas.length - 1})
                {otrasAbiertas ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
              </button>
              {otrasAbiertas && (
                <div id={opcionesId} className="pc-propuesta-opciones">
                  {resultado.propuestas.slice(1).map((propuesta) => tarjeta(propuesta))}
                </div>
              )}
            </div>
          )}
          <p className="pc-propuesta-manual">Si no les sirve, elegí el horario de cada partido abajo.</p>
        </>
      )}
    </div>
  );
}
