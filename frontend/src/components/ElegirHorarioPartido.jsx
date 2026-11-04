import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '../api/client';
import { formatPartidoHorario, formatSlotCorto } from '../utils/dateUtils';
import { describirHorarioPareja, detallePorPareja } from './grillaHorarios';

const GrillaHorariosPartido = lazy(() => import('./GrillaHorariosPartido'));

const tieneHorario = (partido) => partido.estado === 'FIJO' || Boolean(partido.fechaHora && partido.canchaNumero);

export function FilaPartidoZona({ partido, nombres, badge, mostrarCancha = true }) {
  const rivales = partido.pareja1Id && partido.pareja2Id
    ? `${nombres.get(partido.pareja1Id) || 'Pareja 1'} vs ${nombres.get(partido.pareja2Id) || 'Pareja 2'}`
    : partido.origen || 'Partido por definir';
  return (
    <span className="pc-zona-fila">
      <span className="pc-zona-rivales">{rivales}</span>
      {partido.fechaHora && partido.canchaNumero && (
        <>
          <span className="pc-zona-separador" aria-hidden="true">{'\u00a0·'}</span>{' '}
          <span className="pc-zona-dato">
            <time dateTime={partido.fechaHora}>{formatPartidoHorario(partido.fechaHora).toLowerCase().replace(' · ', ' ')}</time>
            {mostrarCancha && <span className="pc-zona-separador" aria-hidden="true">{'\u00a0·'}</span>}
          </span>
          {mostrarCancha && <>{' '}<span className="pc-zona-dato">Cancha {partido.canchaNumero}</span></>}
        </>
      )}
      {badge && <>{' '}<span className="pc-zona-badge">{badge}</span></>}
    </span>
  );
}

function enumerarParejas(nombres) {
  return nombres.length > 1 ? `${nombres.slice(0, -1).join(', a ')} y a ${nombres.at(-1)}` : nombres[0];
}

export default function ElegirHorarioPartido({
  torneoId, categoriaId, zonaId, revision, partido, parejas, abierto, onAbiertoChange, onSaved, onRecheck,
  mostrarPartido = true, mostrarBoton = true, partidosZona = null, parejasZona = null,
}) {
  const [resultado, setResultado] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [seleccion, setSeleccion] = useState(null);
  const [errorFijacion, setErrorFijacion] = useState(null);
  const solicitudRef = useRef(null);
  const seccionRef = useRef(null);
  const feedbackRef = useRef(null);
  const abrirRef = useRef(null);
  const bloqueoFijar = useRef(false);
  const recheckRef = useRef(onRecheck);
  const montado = useRef(false);
  const seccionId = useId();
  const nombres = new Map([...(parejasZona || []), ...parejas].map((p) => [p.id, p.nombre]));
  const esDefinicion = Boolean(partido.origen && !partido.pareja1Id && !partido.pareja2Id && partido.posicionEnRonda >= 3);
  const fijo = tieneHorario(partido);
  const fijoManual = fijo && (partido.fijadoManual ?? partido.estado === 'FIJO');
  const quitarAbierto = fijoManual && abierto?.quitar && abierto.editorId === seccionId;
  const estaAbierto = abierto?.categoriaId === categoriaId && abierto.zonaId === zonaId &&
    abierto.posicionEnRonda === partido.posicionEnRonda && !fijo;
  const posicion = estaAbierto ? partido.posicionEnRonda : null;
  const solicitud = JSON.stringify([torneoId, categoriaId, zonaId, revision, posicion]);
  const vigente = resultado?.solicitud === solicitud;
  const fijando = Boolean(abierto?.fijando);

  useEffect(() => { recheckRef.current = onRecheck; }, [onRecheck]);
  useEffect(() => { montado.current = true; return () => { montado.current = false; }; }, []);

  const cargarHorarios = useCallback(async () => {
    if (posicion === null || !revision) return;
    const ticket = {};
    solicitudRef.current = ticket;
    setCargando(true);
    setResultado({ solicitud, opciones: [], error: '' });
    try {
      const res = await api.post(`/torneos/${torneoId}/pre-check-inicio/partidos/opciones`, {
        categoriaId, zonaId, posicionEnRonda: posicion, revision,
      });
      if (ticket !== solicitudRef.current) return;
      setResultado({ solicitud, opciones: res.opciones || [], horariosParejas: res.horariosParejas || null, error: '' });
    } catch (err) {
      if (ticket !== solicitudRef.current) return;
      const mensaje = err.message || 'No pudimos buscar los horarios.';
      if (err.status === 409) {
        // La sesión del pre-check cambió o venció (por ejemplo, al reiniciar el backend): se vuelve a verificar y
        // la revisión nueva recarga los horarios, sin mostrar el aviso. Solo si no llega otra carga queda el error.
        await recheckRef.current();
        if (ticket === solicitudRef.current) setResultado((prev) => ({ ...prev, solicitud, error: mensaje }));
        return;
      }
      setResultado((prev) => ({ ...prev, solicitud, error: mensaje }));
    } finally {
      if (ticket === solicitudRef.current) setCargando(false);
    }
  }, [torneoId, categoriaId, zonaId, revision, posicion, solicitud]);

  // "No entra en su horario": el horario de cada pareja se pide de entrada, sin esperar a que se abra la grilla.
  const noEntra = partido.motivo === 'SIN_CANCHA_DISPONIBLE' && !fijo && Boolean(revision);
  const [resumen, setResumen] = useState(null);
  useEffect(() => {
    if (!noEntra) return undefined;
    let vigenteResumen = true;
    api.post(`/torneos/${torneoId}/pre-check-inicio/partidos/opciones`, {
      categoriaId, zonaId, posicionEnRonda: partido.posicionEnRonda, revision,
    }).then((res) => {
      if (vigenteResumen) setResumen({ revision, horariosParejas: res.horariosParejas || null });
    }).catch(() => { if (vigenteResumen) setResumen(null); }); // es una ayuda: si falla, no se muestra
    return () => { vigenteResumen = false; };
  }, [noEntra, torneoId, categoriaId, zonaId, partido.posicionEnRonda, revision]);
  const resumenVigente = noEntra && resumen?.revision === revision ? resumen : null;
  // Horario cargado de cada pareja: llega con los horarios del partido (al abrir la grilla o, si no entra, al cargar).
  const horariosParejas = (vigente && resultado.horariosParejas) || resumenVigente?.horariosParejas || null;
  const textoHorarios = horariosParejas?.length ? horariosParejas.map((h) => {
    const nombre = nombres.get(h.parejaId) || 'La pareja';
    const horario = describirHorarioPareja(h);
    return horario ? `${nombre} pueden ${horario}` : `${nombre}, sin horario cargado`;
  }).join(' · ') : null;
  // Los otros partidos de la zona, por horario: si una pareja pregunta cuándo juega, está a la vista.
  const otrosPartidos = !fijo && partidosZona?.length
    ? partidosZona.filter((p) => p.posicionEnRonda !== partido.posicionEnRonda && !p.esBye).sort((a, b) =>
      (a.fechaHora ? 0 : 1) - (b.fechaHora ? 0 : 1) || +new Date(a.fechaHora || 0) - +new Date(b.fechaHora || 0) ||
      a.posicionEnRonda - b.posicionEnRonda)
    : [];

  useEffect(() => {
    setSeleccion(null);
    void cargarHorarios();
    return () => { solicitudRef.current = null; };
  }, [cargarHorarios]);

  const abrir = () => {
    if (fijando || bloqueoFijar.current) return;
    setSeleccion(null);
    setErrorFijacion(null);
    onAbiertoChange(posicion === partido.posicionEnRonda ? null : { categoriaId, zonaId, posicionEnRonda: partido.posicionEnRonda });
  };

  const confirmar = async () => {
    if (!seleccion || seleccion.estado === 'NO_DISPONIBLE' || !vigente || posicion === null || fijando || bloqueoFijar.current) return;
    bloqueoFijar.current = true;
    const esEstePartido = (actual) => actual?.categoriaId === categoriaId && actual.zonaId === zonaId && actual.posicionEnRonda === posicion;
    onAbiertoChange((actual) => esEstePartido(actual) ? { ...actual, fijando: true } : actual);
    setErrorFijacion(null);
    let guardado = false;
    try {
      const actualizado = await api.post(`/torneos/${torneoId}/pre-check-inicio/partidos/fijar`, {
        categoriaId, zonaId, posicionEnRonda: posicion, clave: seleccion.clave, revision,
      });
      guardado = true;
      if (montado.current) await onSaved(actualizado);
    } catch (err) {
      if (montado.current) {
        setErrorFijacion({ posicion, mensaje: err.message || 'No pudimos fijar el horario.' });
        if (err.status === 409) await recheckRef.current();
      }
    } finally {
      bloqueoFijar.current = false;
      onAbiertoChange((actual) => esEstePartido(actual) ? guardado ? null : { ...actual, fijando: false } : actual);
      if (guardado) abrirRef.current?.focus({ preventScroll: true });
    }
  };

  const quitar = async () => {
    if (!quitarAbierto || fijando || bloqueoFijar.current) return;
    bloqueoFijar.current = true;
    onAbiertoChange((actual) => ({ ...actual, fijando: true }));
    setErrorFijacion(null);
    try {
      const actualizado = await api.post(`/torneos/${torneoId}/pre-check-inicio/partidos/quitar`, {
        categoriaId, zonaId, posicionEnRonda: partido.posicionEnRonda, revision,
      });
      if (montado.current) await onSaved(actualizado);
      onAbiertoChange(null);
    } catch (err) {
      if (montado.current) {
        setErrorFijacion({ posicion: partido.posicionEnRonda, mensaje: err.message || 'No pudimos quitar el horario.' });
        if (err.status === 409) await recheckRef.current();
      }
      onAbiertoChange((actual) => actual ? { ...actual, fijando: false } : null);
    } finally { bloqueoFijar.current = false; }
  };

  // Qué hay que pedirle a cada pareja, por separado: "Caruso / Vallejos: 2 h antes · Dávila / Arrieta: 45 min después".
  const pedido = (opcion) => {
    if (!opcion.parejasAAmpliar.length) return esDefinicion
      ? 'Entra en el horario de las cuatro parejas' : 'Entra en el horario de las dos parejas';
    return detallePorPareja(opcion, nombres).map((d) => `${d.nombre}: ${d.texto}`).join(' · ');
  };

  const cancelar = () => {
    const clave = seleccion?.clave;
    setSeleccion(null);
    seccionRef.current?.querySelector(`[data-clave="${clave}"]`)?.focus({ preventScroll: true });
  };
  const mostrarFeedback = Boolean(vigente && seleccion && estaAbierto);
  useEffect(() => {
    const feedback = feedbackRef.current;
    const seccion = seccionRef.current;
    if (!mostrarFeedback || !feedback || !seccion) return;
    const medir = () => seccion.style.setProperty('--pc-feedback-alto', `${feedback.getBoundingClientRect().height}px`);
    medir();
    const observer = new ResizeObserver(medir);
    observer.observe(feedback);
    return () => observer.disconnect();
  }, [mostrarFeedback]);

  return (
    <div className="pc-horario-partido">
      {(mostrarPartido || fijoManual) && <div className="pc-partido-cabecera">
        {mostrarPartido && <FilaPartidoZona partido={partido} nombres={nombres} badge={fijoManual ? 'fijo' : fijo ? 'asignado' : partido.motivo === 'HORARIO_QUITADO' ? 'Horario quitado' : null} />}
        {fijoManual && (
          <button type="button" className="pc-manual-button" disabled={fijando || !revision}
            aria-expanded={Boolean(quitarAbierto)} onClick={() => {
              setErrorFijacion(null);
              onAbiertoChange(quitarAbierto ? null : { categoriaId, zonaId, posicionEnRonda: partido.posicionEnRonda, quitar: true, editorId: seccionId });
            }}>Quitar horario</button>
        )}
      </div>}
      {textoHorarios && !fijo && <p className="pc-horarios-parejas">{textoHorarios}</p>}
      {otrosPartidos.length > 0 && (
        <section className="pc-propuesta-partidos" aria-label="Partidos de la zona">
          <h5 className="pc-propuesta-partidos-title">Partidos de la zona</h5>
          <ul className="pc-propuesta-partidos-list">
            {otrosPartidos.map((p) => (
              <li key={p.posicionEnRonda} className="pc-propuesta-partido">
                <FilaPartidoZona partido={p} nombres={nombres} mostrarCancha={false} badge={p.fechaHora && p.canchaNumero ? null : 'sin horario'} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {quitarAbierto && (
        <div className="pc-quitar-confirmacion" role="group" aria-labelledby={`${seccionId}-quitar`}>
          <p id={`${seccionId}-quitar`} className="pc-manual-copy">¿Quitar el horario de {formatPartidoHorario(partido.fechaHora).toLowerCase().replace(' · ', ' ')}? La disponibilidad que agregaste a las parejas se mantiene.</p>
          <div className="pc-manual-actions">
            <button type="button" className="pc-manual-button" disabled={fijando} onClick={quitar}>{fijando ? 'Quitando…' : 'Confirmar'}</button>
            <button type="button" className="pc-manual-button" disabled={fijando} onClick={() => onAbiertoChange(null)}>Cancelar</button>
          </div>
        </div>
      )}
      {!fijo && mostrarBoton && (
        <button ref={abrirRef} type="button" className="pc-manual-button" disabled={fijando || !revision}
          aria-expanded={estaAbierto} aria-controls={`${seccionId}-partido-${partido.posicionEnRonda}`} onClick={abrir}>
          {estaAbierto ? 'Ocultar horarios' : 'Elegir horario'}
        </button>
      )}
      {errorFijacion?.posicion === partido.posicionEnRonda && (
        <p className="pc-manual-error" role="alert">{errorFijacion.mensaje}</p>
      )}
      {estaAbierto && (
        <div ref={seccionRef} id={`${seccionId}-partido-${partido.posicionEnRonda}`}
          className={`pc-manual-opciones${mostrarFeedback ? ' has-feedback' : ''}`} aria-busy={cargando}>
          {vigente && !cargando && !resultado.error && (
            <Suspense fallback={<p className="pc-manual-status" role="status">Abriendo la grilla…</p>}>
              <GrillaHorariosPartido opciones={resultado.opciones} seleccion={seleccion} onSeleccion={setSeleccion}
                describir={pedido} nombres={nombres} esDefinicion={esDefinicion} fijando={fijando} onCambioDia={() => setSeleccion(null)} />
            </Suspense>
          )}
          {(!vigente || cargando) && (
            <div className="pc-manual-status" role="status"><Loader2 size={16} className="pc-propuesta-spinner" aria-hidden="true" />Buscando horarios…</div>
          )}
          {vigente && resultado.error && errorFijacion?.mensaje !== resultado.error && <p className="pc-manual-error" role="alert">{resultado.error}</p>}
          {vigente && resultado.error && (
            <button type="button" className="pc-manual-button" disabled={cargando || fijando} onClick={cargarHorarios}>Volver a buscar horarios</button>
          )}
          {mostrarFeedback && (
            <div ref={feedbackRef} className="pc-horarios-feedback">
              <p className="pc-manual-copy" role="status" aria-atomic="true">{formatSlotCorto(seleccion.slotId)} · {pedido(seleccion)}</p>
              {seleccion.parejasAAmpliar.length > 0 && (
                <p className="pc-manual-copy">Al confirmar, {formatSlotCorto(seleccion.slotId)} se agrega a la disponibilidad de {enumerarParejas(seleccion.parejasAAmpliar.map((id) => nombres.get(id) || 'la pareja'))}. Hacelo solo si ya lo hablaste con ellas.</p>
              )}
              <div className="pc-manual-actions">
                <button type="button" className="pc-manual-button" disabled={fijando} onClick={confirmar}>
                  {fijando && <Loader2 size={16} className="pc-propuesta-spinner" aria-hidden="true" />}
                  {fijando ? 'Fijando…' : 'Confirmar'}
                </button>
                <button type="button" className="pc-manual-button" disabled={fijando} onClick={cancelar}>Cancelar</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
