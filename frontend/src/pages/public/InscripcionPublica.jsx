import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CalendarDays, CheckCircle2, Clock, Loader2, Lock, SearchX, Trophy } from 'lucide-react';
import { api } from '../../api/client';
import DisponibilidadEditor from '../../components/DisponibilidadEditor';
import { agruparSlotsEnRangos } from '../../utils/disponibilidadUtils';
import { formatFechaTorneo } from '../../utils/dateUtils';
import './InscripcionPublica.css';

const MAX_NOMBRE = 60;

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
    errores.disponibilidad = 'Elegí al menos un horario o marcá "Puedo en cualquier horario".';
  }
  return errores;
}

const FORM_VACIO = { categoriaId: '', jugador1: '', jugador2: '', telefono: '', slotIds: [], cualquierHorario: false, website: '' };

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
  const [confirmada, setConfirmada] = useState(null); // { respuesta, telefono }

  const cargar = useCallback(async () => {
    try {
      const d = await api.get(`/public/${slug}/inscripcion`);
      // La grilla se fija en la primera carga: si cambia la referencia, el editor se reinicia
      // y se pierden los horarios elegidos
      setDatos((prev) => ({ ...d, grilla: prev?.grilla ?? d.grilla }));
      if (d.torneo.estado !== 'BORRADOR') setPantalla('iniciado');
      else if (!d.torneo.inscripcionAbierta || d.categorias.length === 0) setPantalla('cerrada');
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
    if (datos?.categorias?.length === 1) {
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
    setErrores(errs);
    if (Object.keys(errs).length > 0) return;

    setEnviando(true);
    try {
      const respuesta = await api.post(`/public/${slug}/inscripcion`, {
        categoriaId: form.categoriaId,
        jugador1: form.jugador1,
        jugador2: form.jugador2,
        telefono: form.telefono,
        slotIds: form.cualquierHorario ? [] : form.slotIds,
        cualquierHorario: form.cualquierHorario,
        website: form.website,
      });
      setConfirmada({ respuesta: respuesta.inscripcion, telefono: form.telefono.trim() });
      setPantalla('confirmacion');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      if (PANTALLA_POR_CODIGO[err.codigo]) {
        setPantalla(PANTALLA_POR_CODIGO[err.codigo]);
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
    cargar().then((d) => {
      if (d && d.torneo.estado === 'BORRADOR' && d.torneo.inscripcionAbierta && d.categorias.length > 0) setPantalla('abierta');
    });
  };

  const torneo = datos?.torneo;
  const linkPublico = `/torneo/${slug}`;

  if (pantalla === 'cargando') {
    return (
      <div className="insc-page">
        <div className="insc-estado" role="status">
          <Loader2 size={22} className="spin" aria-hidden="true" />
          <p>Cargando inscripción…</p>
        </div>
      </div>
    );
  }

  if (pantalla === 'no-encontrado' || pantalla === 'error') {
    return (
      <div className="insc-page">
        <div className="insc-estado">
          <SearchX size={32} aria-hidden="true" />
          <h1>{pantalla === 'no-encontrado' ? 'No encontramos este torneo' : 'No pudimos cargar la inscripción'}</h1>
          <p>
            {pantalla === 'no-encontrado'
              ? 'Revisá el link que te pasaron o pedile uno nuevo al organizador.'
              : 'Revisá tu conexión y volvé a intentar.'}
          </p>
          {pantalla === 'error' && (
            <button type="button" className="btn-outline insc-btn-secundario" onClick={() => { setPantalla('cargando'); cargar(); }}>
              Reintentar
            </button>
          )}
        </div>
      </div>
    );
  }

  const encabezado = torneo && (
    <header className="insc-header">
      <p className="insc-eyebrow">Inscripción de parejas</p>
      <h1>{torneo.nombre}</h1>
      {torneo.fecha && (
        <p className="insc-fecha">
          <CalendarDays size={15} aria-hidden="true" />
          {formatFechaTorneo(torneo.fecha)}
        </p>
      )}
    </header>
  );

  if (pantalla === 'iniciado' || pantalla === 'cerrada') {
    const iniciado = pantalla === 'iniciado';
    return (
      <div className="insc-page">
        {encabezado}
        <div className="insc-estado">
          {iniciado ? <Trophy size={32} aria-hidden="true" /> : <Lock size={32} aria-hidden="true" />}
          <h2>{iniciado ? 'El torneo ya empezó' : 'La inscripción está cerrada'}</h2>
          <p>
            {iniciado
              ? 'Ya no se aceptan inscripciones. Podés seguir los resultados en vivo.'
              : 'Por ahora no se aceptan inscripciones por link. Consultá con el organizador.'}
          </p>
          <Link to={linkPublico} className="btn-outline insc-btn-secundario">
            {iniciado ? 'Ver el torneo en vivo' : 'Ver el torneo'}
          </Link>
        </div>
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
      <div className="insc-page">
        {encabezado}
        <section className="insc-card insc-confirmacion" aria-live="polite">
          <div className="insc-confirmacion-titulo">
            <CheckCircle2 size={28} aria-hidden="true" />
            <h2>¡Listo, quedaron inscriptos!</h2>
          </div>
          <dl className="insc-resumen">
            <div><dt>Categoría</dt><dd>{r.categoria?.nombre}</dd></div>
            <div><dt>Pareja</dt><dd>{r.jugador1} / {r.jugador2}</dd></div>
            <div><dt>Teléfono</dt><dd>{confirmada.telefono}</dd></div>
            <div>
              <dt>Disponibilidad</dt>
              <dd>
                {r.cualquierHorario ? (
                  'Cualquier horario'
                ) : (
                  <ul className="insc-resumen-dias">
                    {dias.map((d) => {
                      const slotsDia = r.slotIds.filter((s) => s.startsWith(`${d.key}-`));
                      if (slotsDia.length === 0) return null;
                      return <li key={d.key}><strong>{d.nombre}:</strong> {agruparSlotsEnRangos(slotsDia, d.grilla)}</li>;
                    })}
                  </ul>
                )}
              </dd>
            </div>
          </dl>
          <p className="insc-nota">
            La inscripción ya está confirmada. Si necesitan cambiar algo, avisale al organizador.
          </p>
          <div className="insc-acciones">
            <Link to={linkPublico} className="btn-primary insc-btn">Ver el torneo</Link>
            <button type="button" className="btn-ghost insc-btn-secundario" onClick={otraPareja}>
              Inscribir otra pareja
            </button>
          </div>
        </section>
      </div>
    );
  }

  // Inscripción abierta
  return (
    <div className="insc-page">
      {encabezado}
      <form className="insc-card" onSubmit={enviar} noValidate>
        <div className="form-group">
          <label htmlFor="insc-categoria">Categoría</label>
          <select
            id="insc-categoria"
            className="insc-select"
            value={form.categoriaId}
            onChange={set('categoriaId')}
            aria-invalid={Boolean(errores.categoriaId)}
          >
            <option value="">Elegí una categoría</option>
            {datos.categorias.map((c) => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </select>
          {errores.categoriaId && <p className="insc-error-campo">{errores.categoriaId}</p>}
        </div>

        <div className="form-group">
          <label htmlFor="insc-j1">Jugador 1 (nombre y apellido)</label>
          <input id="insc-j1" value={form.jugador1} onChange={set('jugador1')} maxLength={MAX_NOMBRE + 20} autoComplete="name" aria-invalid={Boolean(errores.jugador1)} />
          {errores.jugador1 && <p className="insc-error-campo">{errores.jugador1}</p>}
        </div>

        <div className="form-group">
          <label htmlFor="insc-j2">Jugador 2 (nombre y apellido)</label>
          <input id="insc-j2" value={form.jugador2} onChange={set('jugador2')} maxLength={MAX_NOMBRE + 20} autoComplete="off" aria-invalid={Boolean(errores.jugador2)} />
          {errores.jugador2 && <p className="insc-error-campo">{errores.jugador2}</p>}
        </div>

        <div className="form-group">
          <label htmlFor="insc-tel">Teléfono de contacto</label>
          <input
            id="insc-tel"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="Ej: 351 555 1234"
            value={form.telefono}
            onChange={set('telefono')}
            aria-invalid={Boolean(errores.telefono)}
            aria-describedby="insc-tel-ayuda"
          />
          <p id="insc-tel-ayuda" className="insc-ayuda">Solo lo ve el organizador.</p>
          {errores.telefono && <p className="insc-error-campo">{errores.telefono}</p>}
        </div>

        {/* Honeypot: invisible para las personas; si viene lleno, el backend no guarda nada */}
        <div className="insc-hp" aria-hidden="true">
          <label htmlFor="insc-website">Sitio web</label>
          <input id="insc-website" name="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} />
        </div>

        <fieldset className="insc-disponibilidad">
          <legend>
            <Clock size={15} aria-hidden="true" /> ¿Cuándo pueden jugar la fase de grupos?
          </legend>
          <p className="insc-ayuda">Viernes y sábado. Los domingos son para las eliminatorias.</p>
          <label className="insc-check">
            <input type="checkbox" checked={form.cualquierHorario} onChange={set('cualquierHorario')} />
            Puedo en cualquier horario
          </label>
          <div className={form.cualquierHorario ? 'insc-editor insc-editor-off' : 'insc-editor'}>
            <DisponibilidadEditor
              value={form.slotIds}
              onChange={onSlotsChange}
              grillaProp={datos.grilla}
              disabled={form.cualquierHorario}
            />
          </div>
          {errores.disponibilidad && <p className="insc-error-campo">{errores.disponibilidad}</p>}
        </fieldset>

        {errorEnvio && <div className="error-message" role="alert">{errorEnvio}</div>}

        <button type="submit" className="btn-primary insc-btn" disabled={enviando}>
          {enviando ? (<><Loader2 size={16} className="spin" aria-hidden="true" /> Enviando…</>) : 'Enviar inscripción'}
        </button>
        <p className="insc-nota">Al enviarla, la inscripción queda confirmada. Para cambios, hablá con el organizador.</p>
      </form>
    </div>
  );
}
