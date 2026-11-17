import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCircle2, Clock, Loader2, Lock, SearchX, Trophy } from 'lucide-react';
import { api } from '../../api/client';
import DisponibilidadEditor from '../../components/DisponibilidadEditor';
import { agruparSlotsEnRangos } from '../../utils/disponibilidadUtils';
import { formatFechaTorneo } from '../../utils/dateUtils';
import './publico/publico.css';
import Barra from './publico/Barra';

const MAX_NOMBRE = 60;
const MENSAJE_COMPLETA = 'Esta categoría ya está completa. Elegí otra o consultá con la organización.';

// Mismas reglas que el backend (inscripcion.service.js); el backend valida igual
function validarTelefono(valor) {
  if (!/^[\d\s+\-().]+$/.test(valor)) return false;
  const digitos = valor.replace(/\D/g, '');
  return digitos.length >= 8 && digitos.length <= 15;
}

function validar({ categoriaId, jugador1, jugador2, telefono, slotIds, cualquierHorario }) {
  const errores = {};
  if (!categoriaId) errores.categoriaId = 'Elegí la categoría.';
  for (const [campo, etiqueta] of [['jugador1', 'jugador 1'], ['jugador2', 'jugador 2']]) {
    const v = (campo === 'jugador1' ? jugador1 : jugador2).trim();
    if (!v) errores[campo] = `Falta el nombre del ${etiqueta}.`;
    else if (v.length > MAX_NOMBRE) errores[campo] = `Máximo ${MAX_NOMBRE} caracteres.`;
  }
  if (!validarTelefono(telefono)) errores.telefono = 'Ingresá un teléfono con código de área (entre 8 y 15 números).';
  if (!cualquierHorario && slotIds.length === 0) {
    errores.disponibilidad = 'Elegí al menos un horario.';
  }
  return errores;
}

const FORM_VACIO = { categoriaId: '', jugador1: '', jugador2: '', telefono: '', indicaciones: '', slotIds: [], cualquierHorario: false, website: '' };

// Pantallas que se eligen por el `codigo` del backend
const PANTALLA_POR_CODIGO = {
  TORNEO_NO_ENCONTRADO: 'no-encontrado',
  TORNEO_INICIADO: 'iniciado',
  INSCRIPCION_CERRADA: 'cerrada',
};

export default function InscripcionPublica() {
  const { slug } = useParams();
  const [datos, setDatos] = useState(null); // { torneo, categorias, grilla }
  const [pantalla, setPantalla] = useState('cargando');
  const [form, setForm] = useState(FORM_VACIO);
  const [errores, setErrores] = useState({});
  const [errorEnvio, setErrorEnvio] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [confirmada, setConfirmada] = useState(null); // { respuesta, telefono, indicaciones }

  const cargar = useCallback(async () => {
    try {
      const d = await api.get(`/public/${slug}/inscripcion`);
      // La grilla se fija en la primera carga: si cambia la referencia, el editor se reinicia
      // y se pierden los horarios elegidos
      setDatos((prev) => ({ ...d, grilla: prev?.grilla ?? d.grilla }));
      if (d.torneo.estado !== 'BORRADOR') setPantalla('iniciado');
      else if (!d.torneo.inscripcionAbierta || d.categorias.length === 0) setPantalla('cerrada');
      else if (d.categorias.every((c) => c.completa)) setPantalla('completas');
      else setPantalla((p) => (p === 'confirmacion' ? p : 'abierta'));
      return d;
    } catch (err) {
      setPantalla(err.codigo === 'TORNEO_NO_ENCONTRADO' ? 'no-encontrado' : 'error');
      return null;
    }
  }, [slug]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Con una sola categoría, queda elegida
  useEffect(() => {
    if (datos?.categorias?.length === 1 && !datos.categorias[0].completa) {
      setForm((f) => (f.categoriaId ? f : { ...f, categoriaId: datos.categorias[0].id }));
    }
  }, [datos]);

  const set = (campo) => (e) => {
    const valor = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [campo]: valor }));
    setErrores((er) => ({ ...er, [campo]: undefined, ...(campo === 'cualquierHorario' ? { disponibilidad: undefined } : {}) }));
  };

  const onSlotsChange = useCallback((slotIds) => {
    setForm((f) => ({ ...f, slotIds }));
    setErrores((er) => ({ ...er, disponibilidad: undefined }));
  }, []);

  const enviar = async (e) => {
    e.preventDefault();
    if (enviando) return;
    setErrorEnvio('');
    const errs = validar(form);
    if (datos.categorias.find((c) => c.id === form.categoriaId)?.completa) errs.categoriaId = MENSAJE_COMPLETA;
    setErrores(errs);
    if (Object.keys(errs).length > 0) return;

    setEnviando(true);
    try {
      const respuesta = await api.post(`/public/${slug}/inscripcion`, {
        categoriaId: form.categoriaId,
        jugador1: form.jugador1,
        jugador2: form.jugador2,
        telefono: form.telefono,
        indicaciones: form.indicaciones,
        slotIds: form.cualquierHorario ? [] : form.slotIds,
        cualquierHorario: form.cualquierHorario,
        website: form.website,
      });
      setConfirmada({ respuesta: respuesta.inscripcion, telefono: form.telefono.trim(), indicaciones: form.indicaciones.trim() });
      setPantalla('confirmacion');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      if (PANTALLA_POR_CODIGO[err.codigo]) {
        setPantalla(PANTALLA_POR_CODIGO[err.codigo]);
      } else if (err.codigo === 'CATEGORIA_COMPLETA') {
        // Conservamos el formulario, incluso si se acaba de ocupar el último cupo del torneo.
        setDatos((d) => ({ ...d, categorias: d.categorias.map((c) => c.id === form.categoriaId ? { ...c, completa: true } : c) }));
        setErrores((er) => ({ ...er, categoriaId: err.message }));
      } else if (err.codigo === 'REINTENTAR') {
        // 503: la base estuvo ocupada (por ejemplo, mientras se inicia el torneo). No se guardó
        // nada; el formulario queda cargado para volver a enviarlo.
        setErrorEnvio('Hay mucha gente inscribiéndose en este momento y no se guardó la inscripción. Esperá unos segundos y tocá "Enviar inscripción" de nuevo.');
      } else {
        if (err.codigo === 'CATEGORIA_NO_DISPONIBLE') {
          // La categoría pudo haber empezado: se recargan las que siguen abiertas
          await cargar();
          setForm((f) => ({ ...f, categoriaId: '' }));
        }
        setErrorEnvio(err.message || 'No se pudo enviar la inscripción. Probá de nuevo.');
      }
    } finally {
      setEnviando(false);
    }
  };

  const otraPareja = () => {
    setForm(FORM_VACIO);
    setErrores({});
    setErrorEnvio('');
    setConfirmada(null);
    setPantalla('cargando');
    cargar();
  };

  const torneo = datos?.torneo;
  const linkPublico = `/torneo/${slug}`;

  // Encabezado claro de la vista pública, con el estado de la inscripción
  const estadoTexto = {
    abierta: 'Inscripción abierta',
    confirmacion: 'Inscripción abierta',
    cerrada: 'Inscripción cerrada',
    completas: 'Inscripción cerrada',
    iniciado: 'Torneo en curso',
  }[pantalla];
  const encabezado = (
    <header className="pv-cabecera">
      <div className="pv-envolver pv-insc-ancho">
        <h1 className="pv-cascada" style={{ '--i': 1 }}>
          {torneo ? torneo.nombre : 'Inscripción de parejas'}
        </h1>
        {torneo && (
          <div className="pv-cabecera-meta pv-cascada" style={{ '--i': 1 }}>
            {torneo.fecha && (
              <p className="pv-fechas">{formatFechaTorneo(torneo.fecha)}</p>
            )}
            {estadoTexto && <span className="pv-chip-neutro">{estadoTexto}</span>}
          </div>
        )}
      </div>
    </header>
  );

  // Carga: esqueleto con brillo
  if (pantalla === 'cargando') {
    return (
      <div className="publico pv-insc" role="status" aria-busy="true">
        <span className="pv-sr">Cargando inscripción…</span>
        <Barra volver={{ href: linkPublico, texto: 'Torneo' }} />
        <header className="pv-cabecera" aria-hidden="true">
          <div className="pv-envolver pv-insc-ancho">
            <div className="pv-sk" style={{ width: '65%', height: 32, marginTop: 4, marginBottom: 8 }} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
              <div className="pv-sk" style={{ width: 140, height: 18 }} />
              <div className="pv-sk" style={{ width: 120, height: 24, borderRadius: 99 }} />
            </div>
          </div>
        </header>
        <div className="pv-envolver pv-insc-ancho" aria-hidden="true">
          <div className="pv-insc-card">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} style={{ marginBottom: 18 }}>
                <div className="pv-sk" style={{ width: 140, height: 14 }} />
                <div className="pv-sk" style={{ height: 48, marginTop: 8 }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Estados sin formulario: no encontrado, error, cerrada, torneo iniciado
  if (['no-encontrado', 'error', 'iniciado', 'cerrada', 'completas'].includes(pantalla)) {
    const estados = {
      'no-encontrado': {
        icono: <SearchX size={26} aria-hidden="true" />,
        titulo: 'No encontramos este torneo',
        texto: 'Revisá el link que te pasaron o pedile uno nuevo al organizador.',
      },
      error: {
        icono: <SearchX size={26} aria-hidden="true" />,
        titulo: 'No pudimos cargar la inscripción',
        texto: 'Revisá tu conexión y volvé a intentar.',
        accion: (
          <button type="button" className="pv-btn pv-btn-secundario" onClick={() => { setPantalla('cargando'); cargar(); }}>
            Reintentar
          </button>
        ),
      },
      iniciado: {
        icono: <Trophy size={26} aria-hidden="true" />,
        titulo: 'El torneo ya empezó',
        texto: 'Ya no se aceptan inscripciones. Podés seguir los resultados en vivo.',
        accion: <Link to={linkPublico} className="pv-btn pv-btn-secundario">Ver el torneo en vivo</Link>,
      },
      cerrada: {
        icono: <Lock size={26} aria-hidden="true" />,
        titulo: 'La inscripción está cerrada',
        texto: 'Por ahora no se aceptan inscripciones por link. Consultá con el organizador.',
        accion: <Link to={linkPublico} className="pv-btn pv-btn-secundario">Ver el torneo</Link>,
      },
      completas: {
        icono: <Lock size={26} aria-hidden="true" />,
        titulo: 'La inscripción está cerrada',
        texto: 'Todas las categorías están completas.',
        accion: <Link to={linkPublico} className="pv-btn pv-btn-secundario">Ver el torneo</Link>,
      },
    };
    const e = estados[pantalla] || estados.error;
    return (
      <div className="publico pv-insc">
        <Barra volver={{ href: linkPublico, texto: 'Torneo' }} />
        {encabezado}
        <main className="pv-envolver pv-insc-ancho">
          <section className="pv-insc-card pv-insc-estado pv-cascada" style={{ '--i': 2 }}>
            <span className="pv-insc-estado-icono">{e.icono}</span>
            <h2>{e.titulo}</h2>
            <p>{e.texto}</p>
            {e.accion}
          </section>
        </main>
      </div>
    );
  }

  if (pantalla === 'confirmacion' && confirmada) {
    const r = confirmada.respuesta;
    const grilla = datos?.grilla || { viernes: [], sabado: [] };
    const dias = [
      { nombre: 'Viernes', key: 'Viernes', grilla: grilla.viernes },
      { nombre: 'Sábado', key: 'Sabado', grilla: grilla.sabado },
    ];
    return (
      <div className="publico pv-insc">
        <Barra volver={{ href: linkPublico, texto: 'Torneo' }} />
        {encabezado}
        <main className="pv-envolver pv-insc-ancho">
          <section className="pv-insc-card pv-insc-confirmacion pv-cascada" style={{ '--i': 2 }} aria-live="polite">
            <span className="pv-insc-listo" aria-hidden="true">
              <CheckCircle2 size={28} />
            </span>
            <h2>¡Listo, quedaron inscriptos!</h2>
            <dl className="pv-insc-resumen">
              <div><dt>Categoría</dt><dd>{r.categoria?.nombre}</dd></div>
              <div><dt>Pareja</dt><dd translate="no">{r.jugador1} / {r.jugador2}</dd></div>
              <div><dt>Teléfono</dt><dd className="num">{confirmada.telefono}</dd></div>
              {confirmada.indicaciones && (
                <div><dt>Indicaciones</dt><dd className="pv-indicaciones-texto">{confirmada.indicaciones}</dd></div>
              )}
              <div>
                <dt>Disponibilidad</dt>
                <dd>
                  {r.cualquierHorario ? (
                    'Cualquier horario'
                  ) : (
                    <ul>
                      {dias.map((d) => {
                        const slotsDia = r.slotIds.filter((s) => s.startsWith(`${d.key}-`));
                        if (slotsDia.length === 0) return null;
                        return <li key={d.key}><b>{d.nombre}:</b> {agruparSlotsEnRangos(slotsDia, d.grilla)}</li>;
                      })}
                    </ul>
                  )}
                </dd>
              </div>
            </dl>
            <p className="pv-nota">La inscripción ya está confirmada. Si necesitan cambiar algo, avisale al organizador.</p>
            <div className="pv-insc-acciones">
              <Link to={linkPublico} className="pv-btn pv-btn-primario">Ver el torneo</Link>
              <button type="button" className="pv-btn pv-btn-secundario" onClick={otraPareja}>
                Inscribir otra pareja
              </button>
            </div>
          </section>
        </main>
      </div>
    );
  }

  // Inscripción abierta
  return (
    <div className="publico pv-insc">
      <Barra volver={{ href: linkPublico, texto: 'Torneo' }} />
      {encabezado}
      <main className="pv-envolver pv-insc-ancho">
        <form className="pv-insc-card pv-cascada" style={{ '--i': 2 }} onSubmit={enviar} noValidate>
          <h2 className="pv-insc-titulo">Inscribí a tu pareja</h2>

          <div className="pv-campo-form">
            <label htmlFor="insc-categoria">Categoría</label>
            <select
              id="insc-categoria"
              className="pv-input"
              value={form.categoriaId}
              onChange={set('categoriaId')}
              aria-invalid={Boolean(errores.categoriaId)}
              aria-describedby={errores.categoriaId ? 'insc-categoria-error' : undefined}
            >
              <option value="">Elegí una categoría</option>
              {datos.categorias.map((c) => (
                <option key={c.id} value={c.id} disabled={Boolean(c.completa)}>{c.nombre}{c.completa ? ' (completa)' : ''}</option>
              ))}
            </select>
            {errores.categoriaId && <p id="insc-categoria-error" className="pv-error">{errores.categoriaId}</p>}
          </div>

          <div className="pv-campo-form">
            <label htmlFor="insc-j1">Jugador 1 (nombre y apellido)</label>
            <input
              id="insc-j1"
              name="jugador1"
              className="pv-input"
              value={form.jugador1}
              onChange={set('jugador1')}
              maxLength={MAX_NOMBRE + 20}
              autoComplete="name"
              aria-invalid={Boolean(errores.jugador1)}
              aria-describedby={errores.jugador1 ? 'insc-j1-error' : undefined}
            />
            {errores.jugador1 && <p id="insc-j1-error" className="pv-error">{errores.jugador1}</p>}
          </div>

          <div className="pv-campo-form">
            <label htmlFor="insc-j2">Jugador 2 (nombre y apellido)</label>
            <input
              id="insc-j2"
              name="jugador2"
              className="pv-input"
              value={form.jugador2}
              onChange={set('jugador2')}
              maxLength={MAX_NOMBRE + 20}
              autoComplete="off"
              aria-invalid={Boolean(errores.jugador2)}
              aria-describedby={errores.jugador2 ? 'insc-j2-error' : undefined}
            />
            {errores.jugador2 && <p id="insc-j2-error" className="pv-error">{errores.jugador2}</p>}
          </div>

          <div className="pv-campo-form">
            <label htmlFor="insc-tel">Teléfono de contacto</label>
            <input
              id="insc-tel"
              name="telefono"
              className="pv-input num"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={form.telefono}
              onChange={set('telefono')}
              aria-invalid={Boolean(errores.telefono)}
              aria-describedby={errores.telefono ? 'insc-tel-error' : undefined}
            />
            {errores.telefono && <p id="insc-tel-error" className="pv-error">{errores.telefono}</p>}
          </div>

          {/* Honeypot: invisible para las personas; si viene lleno, el backend no guarda nada */}
          <div className="pv-hp" aria-hidden="true">
            <label htmlFor="insc-website">Sitio web</label>
            <input id="insc-website" name="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} />
          </div>

          <fieldset className="pv-insc-disponibilidad">
            <legend>
              <Clock size={16} aria-hidden="true" /> ¿Cuándo pueden jugar los partidos de zona?
            </legend>
            <div className="pv-insc-editor">
              <DisponibilidadEditor
                value={form.slotIds}
                onChange={onSlotsChange}
                grillaProp={datos.grilla}
              />
            </div>
            {errores.disponibilidad && <p className="pv-error">{errores.disponibilidad}</p>}
          </fieldset>

          <div className="pv-campo-form">
            <label htmlFor="insc-indicaciones">Indicaciones para el organizador (opcional)</label>
            <textarea
              id="insc-indicaciones"
              name="indicaciones"
              className="pv-input pv-indicaciones"
              rows={3}
              maxLength={300}
              value={form.indicaciones}
              onChange={set('indicaciones')}
            />
          </div>

          {errorEnvio && <div className="pv-alerta" role="alert">{errorEnvio}</div>}

          <button type="submit" className="pv-btn pv-btn-primario pv-insc-enviar" disabled={enviando}>
            {enviando ? (<><Loader2 size={18} className="spin" aria-hidden="true" /> Enviando…</>) : 'Enviar inscripción'}
          </button>
          <p className="pv-nota">Al enviarla, la inscripción queda confirmada. Para cambios, hablá con el organizador.</p>
        </form>
      </main>
    </div>
  );
}
