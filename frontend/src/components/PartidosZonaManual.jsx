import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { api } from '../api/client';
import { formatPartidoHorario, formatSlotCorto } from '../utils/dateUtils';

const tieneHorario = (partido) => partido.estado === 'FIJO' || Boolean(partido.fechaHora && partido.canchaNumero);

export function FilaPartidoZona({ partido, nombres, badge }) {
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
            <span className="pc-zona-separador" aria-hidden="true">{'\u00a0·'}</span>
          </span>{' '}
          <span className="pc-zona-dato">Cancha {partido.canchaNumero}</span>
        </>
      )}
      {badge && <>{' '}<span className="pc-zona-badge">{badge}</span></>}
    </span>
  );
}

function enumerarParejas(nombres) {
  return nombres.length > 1 ? `${nombres.slice(0, -1).join(', a ')} y a ${nombres.at(-1)}` : nombres[0];
}

export default function PartidosZonaManual({
  torneoId, categoriaId, zonaId, revision, partidos, parejas, abierto, onAbiertoChange, onSaved, onRecheck, children,
}) {
  const [resultado, setResultado] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [seleccion, setSeleccion] = useState(null);
  const [errorFijacion, setErrorFijacion] = useState(null);
  const [editorAbierto, setEditorAbierto] = useState(false);
  const solicitudRef = useRef(null);
  const cargaEnCurso = useRef(null);
  const bloqueoFijar = useRef(false);
  const recheckRef = useRef(onRecheck);
  const montado = useRef(false);
  const seccionId = useId();
  const ordenados = [...partidos].sort((a, b) => a.posicionEnRonda - b.posicionEnRonda);
  const parejasMap = new Map(parejas.map((p) => [p.id, p]));
  const nombres = new Map(parejas.map((p) => [p.id, p.nombre]));
  const esDefinicion = (p) => Boolean(p.origen && !p.pareja1Id && !p.pareja2Id && p.posicionEnRonda >= 3);
  const basesPendientes = ordenados.filter((p) => p.posicionEnRonda <= 2).some((p) => !tieneHorario(p));
  const partidoAbierto = abierto?.categoriaId === categoriaId && abierto.zonaId === zonaId
    ? ordenados.find((p) => p.posicionEnRonda === abierto.posicionEnRonda) : null;
  const posicion = partidoAbierto && !tieneHorario(partidoAbierto) && !(esDefinicion(partidoAbierto) && basesPendientes)
    ? partidoAbierto.posicionEnRonda : null;
  const solicitud = JSON.stringify([torneoId, categoriaId, zonaId, revision, posicion]);
  const vigente = resultado?.solicitud === solicitud;
  const fijando = Boolean(abierto?.fijando);

  useEffect(() => { recheckRef.current = onRecheck; }, [onRecheck]);
  useEffect(() => { montado.current = true; return () => { montado.current = false; }; }, []);

  const cargarPagina = useCallback(async (cursor = null) => {
    if (posicion === null || !revision || (cursor && cargaEnCurso.current === solicitud)) return;
    const ticket = {};
    solicitudRef.current = ticket;
    cargaEnCurso.current = solicitud;
    setCargando(true);
    setResultado((prev) => cursor && prev?.solicitud === solicitud ? { ...prev, error: '' }
      : { solicitud, opciones: [], siguienteCursor: null, error: '' });
    try {
      const res = await api.post(`/torneos/${torneoId}/pre-check-inicio/partidos/opciones`, {
        categoriaId, zonaId, posicionEnRonda: posicion, revision, cursor,
      });
      if (ticket !== solicitudRef.current) return;
      setResultado((prev) => {
        const anteriores = cursor && prev?.solicitud === solicitud ? prev.opciones : [];
        const opciones = [...new Map([...anteriores, ...(res.opciones || [])].map((o) => [o.clave, o])).values()];
        return { solicitud, opciones, siguienteCursor: res.siguienteCursor, error: '' };
      });
    } catch (err) {
      if (ticket !== solicitudRef.current) return;
      const mensaje = err.message || 'No pudimos buscar los horarios.';
      setResultado((prev) => ({ ...prev, solicitud, error: mensaje }));
      if (err.status === 409) {
        setErrorFijacion({ posicion, mensaje });
        await recheckRef.current();
      }
    } finally {
      if (ticket === solicitudRef.current) { cargaEnCurso.current = null; setCargando(false); }
    }
  }, [torneoId, categoriaId, zonaId, revision, posicion, solicitud]);

  useEffect(() => {
    setSeleccion(null);
    void cargarPagina();
    return () => { solicitudRef.current = null; cargaEnCurso.current = null; };
  }, [cargarPagina]);

  const abrir = (partido) => {
    if (fijando || bloqueoFijar.current) return;
    setSeleccion(null);
    setErrorFijacion(null);
    onAbiertoChange(posicion === partido.posicionEnRonda ? null : { categoriaId, zonaId, posicionEnRonda: partido.posicionEnRonda });
  };

  const confirmar = async () => {
    if (!seleccion || !vigente || posicion === null || fijando || bloqueoFijar.current) return;
    bloqueoFijar.current = true;
    const esEstePartido = (actual) => actual?.categoriaId === categoriaId && actual.zonaId === zonaId && actual.posicionEnRonda === posicion;
    onAbiertoChange((actual) => esEstePartido(actual) ? { ...actual, fijando: true } : actual);
    setErrorFijacion(null);
    let guardado = false;
    try {
      await api.post(`/torneos/${torneoId}/pre-check-inicio/partidos/fijar`, {
        categoriaId, zonaId, posicionEnRonda: posicion, clave: seleccion.clave, revision,
      });
      guardado = true;
      if (montado.current) await onSaved();
    } catch (err) {
      if (montado.current) {
        setErrorFijacion({ posicion, mensaje: err.message || 'No pudimos fijar el horario.' });
        if (err.status === 409) await recheckRef.current();
      }
    } finally {
      bloqueoFijar.current = false;
      onAbiertoChange((actual) => esEstePartido(actual) ? guardado ? null : { ...actual, fijando: false } : actual);
    }
  };

  const pedido = (opcion) => {
    if (!opcion.parejasAAmpliar.length) return esDefinicion(partidoAbierto)
      ? 'Entra en el horario de las cuatro parejas' : 'Entra en el horario de las dos parejas';
    // La comparación usa la jornada lógica; solo la etiqueta muestra el día civil.
    const dia = opcion.slotId.split('-')[0];
    return `Pedile a ${enumerarParejas(opcion.parejasAAmpliar.map((id) => {
      const pareja = parejasMap.get(id);
      const diaNuevo = pareja?.slotIds && !pareja.slotIds.some((s) => s.startsWith(`${dia}-`));
      return `${pareja?.nombre || 'la pareja'}${diaNuevo ? ' (no cargó ese día)' : ''}`;
    }))}`;
  };

  return (
    <section className="pc-manual-zone" aria-labelledby={`${seccionId}-titulo`}>
      <h4 id={`${seccionId}-titulo`} className="pc-manual-title">Armar a mano</h4>
      <ol className="pc-manual-partidos">
        {ordenados.map((partido) => {
          const fijo = tieneHorario(partido);
          const esperaBases = !fijo && esDefinicion(partido) && basesPendientes;
          const estaAbierto = posicion === partido.posicionEnRonda;
          return (
            <li key={partido.posicionEnRonda} className="pc-manual-partido">
              <FilaPartidoZona partido={partido} nombres={nombres} badge={fijo ? 'fijo' : null} />
              {esperaBases ? (
                <p className="pc-manual-copy">Se habilita cuando los dos primeros partidos tengan horario.</p>
              ) : !fijo && (
                <button type="button" className="pc-manual-button" disabled={fijando || !revision}
                  aria-expanded={estaAbierto} aria-controls={`${seccionId}-partido-${partido.posicionEnRonda}`} onClick={() => abrir(partido)}>
                  {estaAbierto ? 'Ocultar horarios' : 'Elegir horario'}
                </button>
              )}
              {errorFijacion?.posicion === partido.posicionEnRonda && (
                <p className="pc-manual-error" role="alert">{errorFijacion.mensaje}</p>
              )}
              {estaAbierto && (
                <div id={`${seccionId}-partido-${partido.posicionEnRonda}`} className="pc-manual-opciones" aria-busy={cargando}>
                  {vigente && resultado.opciones.map((opcion) => (
                    <button key={opcion.clave} type="button" className={`pc-manual-button pc-manual-opcion${seleccion?.clave === opcion.clave ? ' is-selected' : ''}`}
                      disabled={fijando} aria-pressed={seleccion?.clave === opcion.clave} onClick={() => setSeleccion(opcion)}>
                      <span className="pc-manual-horario">{formatSlotCorto(opcion.slotId)}</span>
                      <span className="pc-manual-pedido">{pedido(opcion)}</span>
                    </button>
                  ))}
                  {(!vigente || cargando) && (
                    <div className="pc-manual-status" role="status"><Loader2 size={16} className="pc-propuesta-spinner" aria-hidden="true" />Buscando horarios…</div>
                  )}
                  {vigente && resultado.error && errorFijacion?.mensaje !== resultado.error && <p className="pc-manual-error" role="alert">{resultado.error}</p>}
                  {vigente && !cargando && !resultado.error && resultado.opciones.length === 0 && (
                    <p className="pc-manual-copy">No hay horarios posibles para este partido con las canchas libres.</p>
                  )}
                  {vigente && (resultado.siguienteCursor || resultado.error) && (
                    <button type="button" className="pc-manual-button" disabled={cargando || fijando} onClick={() => cargarPagina(resultado.siguienteCursor || null)}>
                      {resultado.siguienteCursor ? 'Ver más horarios' : 'Volver a buscar horarios'}
                    </button>
                  )}
                  {vigente && seleccion && (
                    <div className="pc-manual-confirmacion">
                      <p className="pc-manual-copy">
                        {seleccion.parejasAAmpliar.length
                          ? `Se agrega ${formatSlotCorto(seleccion.slotId)} a ${enumerarParejas(seleccion.parejasAAmpliar.map((id) => nombres.get(id) || 'la pareja'))}. Confirmalo solo si ya lo hablaste con ${seleccion.parejasAAmpliar.length === 1 ? 'ella' : 'ellas'}.`
                          : `El partido queda fijo el ${formatSlotCorto(seleccion.slotId)}.`}
                      </p>
                      <div className="pc-manual-actions">
                        <button type="button" className="pc-manual-button" disabled={fijando} onClick={confirmar}>
                          {fijando && <Loader2 size={16} className="pc-propuesta-spinner" aria-hidden="true" />}
                          {fijando ? 'Fijando…' : 'Confirmar'}
                        </button>
                        <button type="button" className="pc-manual-button" disabled={fijando} onClick={() => setSeleccion(null)}>Cancelar</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <button type="button" className="pc-manual-button pc-manual-toggle" aria-expanded={editorAbierto}
        aria-controls={`${seccionId}-parejas`} disabled={fijando} onClick={() => setEditorAbierto((valor) => !valor)}>
        Editar horarios de una pareja
        {editorAbierto ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
      </button>
      <div id={`${seccionId}-parejas`} className="pc-manual-editor" hidden={!editorAbierto}>{children}</div>
    </section>
  );
}
